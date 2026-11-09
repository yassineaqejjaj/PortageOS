import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req } from "@nestjs/common";
import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import { BankMapping, OpenInvoice, parseBankCsv, suggestMatches } from "@portage/domain";
import { PrismaService, Tx } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext, RequirePermission } from "./auth.guard";
import { PaymentsService } from "./payments.service";
import { parseZod } from "./workflow";

const MAX_CSV = 1_000_000;
const Preview = z.object({ csv: z.string().min(1), fileName: z.string().max(120).optional(),
  mapping: z.object({ date: z.string().optional(), label: z.string().optional(), amount: z.string().optional(), debit: z.string().optional(), credit: z.string().optional(), reference: z.string().optional() }).optional() });
const Match = z.object({ invoiceId: z.string().uuid() });
const Ignore = z.object({ reason: z.string().min(3).max(300) });
type R = { ctx: RequestContext };
const fp = (r: { date: string; amount: string; label: string; reference?: string }) => createHash("sha256").update([r.date, r.amount, r.label.toLowerCase().replace(/\s+/g, " "), r.reference ?? ""].join("|")).digest("hex");

/**
 * Rapprochement bancaire SANS connexion bancaire : import de relevés CSV fournis par l'utilisateur.
 * Les propositions ne sont jamais appliquées automatiquement ; chaque rapprochement est une décision humaine qui passe par le même chemin que la saisie manuelle.
 */
@Controller("bank")
export class BankController {
  constructor(private prisma: PrismaService, private audit: AuditService, private payments: PaymentsService) {}

  @Post("imports/preview") @RequirePermission("payment.write")
  preview(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parseZod(Preview, body);
    if (d.csv.length > MAX_CSV) throw new BadRequestException("Fichier trop volumineux (1 Mo maximum)");
    let p; try { p = parseBankCsv(d.csv, d.mapping as BankMapping | undefined); } catch (e) { throw new BadRequestException((e as Error).message); }
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const seen = new Set<string>(); const dups: { line: number; errors: string[] }[] = []; const valid = [];
      const known = new Set((await tx.bankTransaction.findMany({ where: { fingerprint: { in: p.rows.map(fp) } }, select: { fingerprint: true } })).map(x => x.fingerprint));
      for (const r of p.rows) { const f = fp(r); if (known.has(f) || seen.has(f)) dups.push({ line: r.line, errors: [known.has(f) ? "déjà importé" : "doublon dans le fichier"] }); else { seen.add(f); valid.push(r); } }
      const report = [...p.errors, ...dups].sort((a, b) => a.line - b.line);
      const job = await tx.bankImport.create({ data: { tenantId: ctx.tenantId, fileName: d.fileName, rowsTotal: p.rowsTotal, rowsValid: valid.length, rowsInvalid: report.length, report, rows: valid as unknown as object, mapping: p.mapping as object, createdBy: ctx.userId } });
      return { id: job.id, status: job.status, fileName: job.fileName, rowsTotal: job.rowsTotal, rowsValid: job.rowsValid, rowsInvalid: job.rowsInvalid, errors: report.slice(0, 200), mapping: p.mapping,
        credits: valid.filter(r => Number(r.amount) > 0).length, debits: valid.filter(r => Number(r.amount) < 0).length };
    });
  }

  @Get("imports") @RequirePermission("payment.write")
  imports(@Req() { ctx }: R) { return this.prisma.forTenant(ctx.tenantId, async tx => (await tx.bankImport.findMany({ orderBy: { createdAt: "desc" }, take: 50 })).map(j => ({ id: j.id, fileName: j.fileName, status: j.status, rowsTotal: j.rowsTotal, rowsValid: j.rowsValid, rowsInvalid: j.rowsInvalid, createdAt: j.createdAt, committedAt: j.committedAt }))); }

  @Post("imports/:id/commit") @RequirePermission("payment.write")
  commit(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) {
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const j = await tx.bankImport.findUnique({ where: { id } }); if (!j) throw new NotFoundException();
      const claim = await tx.bankImport.updateMany({ where: { id, status: "previewed" }, data: { status: "committed", committedAt: new Date() } });
      if (claim.count !== 1) throw new ConflictException(`Import déjà ${j.status === "committed" ? "validé" : "abandonné"}`);
      const rows = j.rows as { date: string; label: string; amount: string; reference?: string }[]; let created = 0;
      const res = await tx.bankTransaction.createMany({ skipDuplicates: true, data: rows.map(r => ({ tenantId: ctx.tenantId, importId: id, date: new Date(r.date), label: r.label, reference: r.reference, amount: r.amount, fingerprint: fp(r), status: Number(r.amount) > 0 ? "unmatched" : "ignored", note: Number(r.amount) > 0 ? null : "Débit : hors rapprochement des encaissements", decidedBy: Number(r.amount) > 0 ? null : ctx.userId, decidedAt: Number(r.amount) > 0 ? null : new Date() })) });
      created = res.count;
      await this.audit.record(tx, ctx, { action: "bank.import_committed", entity: "BankImport", entityId: id, after: { rows: rows.length, created, skippedDuplicates: rows.length - created } });
      return { id, created, skippedDuplicates: rows.length - created };
    });
  }

  @Post("imports/:id/cancel") @RequirePermission("payment.write")
  cancel(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) {
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const r = await tx.bankImport.updateMany({ where: { id, status: "previewed" }, data: { status: "cancelled" } });
      if (r.count !== 1) { if (!(await tx.bankImport.findUnique({ where: { id } }))) throw new NotFoundException(); throw new ConflictException("Seul un aperçu peut être abandonné"); }
      return { id, status: "cancelled" };
    });
  }

  private async openInvoices(tx: Tx): Promise<OpenInvoice[]> {
    const inv = await tx.invoice.findMany({ where: { status: { in: ["issued", "partially_paid"] } }, select: { id: true, number: true, gross: true, paid: true }, take: 1000 });
    return inv.filter(i => i.number).map(i => ({ id: i.id, number: i.number!, remaining: new Decimal(i.gross.toString()).minus(i.paid.toString()).toFixed(2) })).filter(i => new Decimal(i.remaining).gt(0));
  }

  @Get("transactions") @RequirePermission("payment.write")
  transactions(@Req() { ctx }: R, @Query("status") status = "unmatched") {
    if (!["unmatched", "matched", "ignored"].includes(status)) throw new BadRequestException("Statut inconnu");
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const rows = await tx.bankTransaction.findMany({ where: { status }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 200 });
      const open = status === "unmatched" ? await this.openInvoices(tx) : [];
      return rows.map(t => ({ id: t.id, date: t.date.toISOString().slice(0, 10), label: t.label, reference: t.reference, amount: t.amount.toString(), status: t.status, note: t.note, paymentId: t.paymentId,
        suggestions: status === "unmatched" ? suggestMatches({ amount: t.amount.toString(), label: t.label, reference: t.reference }, open) : [] }));
    });
  }

  @Post("transactions/:id/match") @RequirePermission("payment.write")
  match(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parseZod(Match, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      await tx.$queryRaw`SELECT id FROM "BankTransaction" WHERE id = ${id} FOR UPDATE`; // verrou de ligne : deux rapprochements simultanés ne peuvent pas encaisser deux fois
      const t = await tx.bankTransaction.findUnique({ where: { id } }); if (!t) throw new NotFoundException();
      if (t.status !== "unmatched") throw new ConflictException("Mouvement déjà traité");
      if (new Decimal(t.amount.toString()).lte(0)) throw new BadRequestException("Seuls les crédits se rapprochent d'une facture");
      const { payment } = await this.payments.record(tx, ctx, d.invoiceId, { amount: new Decimal(t.amount.toString()).toFixed(2), receivedOn: t.date.toISOString().slice(0, 10), reference: `banque:${t.id.slice(0, 8)}` }, "bank");
      await tx.bankTransaction.update({ where: { id }, data: { status: "matched", paymentId: payment.id, decidedBy: ctx.userId, decidedAt: new Date() } });
      await this.audit.record(tx, ctx, { action: "bank.matched", entity: "BankTransaction", entityId: id, after: { invoiceId: d.invoiceId, paymentId: payment.id, amount: t.amount.toString() } });
      return { id, status: "matched", paymentId: payment.id };
    });
  }

  @Post("transactions/:id/ignore") @RequirePermission("payment.write")
  ignore(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parseZod(Ignore, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const r = await tx.bankTransaction.updateMany({ where: { id, status: "unmatched" }, data: { status: "ignored", note: d.reason, decidedBy: ctx.userId, decidedAt: new Date() } });
      if (r.count !== 1) { if (!(await tx.bankTransaction.findUnique({ where: { id } }))) throw new NotFoundException(); throw new ConflictException("Mouvement déjà traité"); }
      await this.audit.record(tx, ctx, { action: "bank.ignored", entity: "BankTransaction", entityId: id, after: { reason: d.reason } });
      return { id, status: "ignored" };
    });
  }
}
