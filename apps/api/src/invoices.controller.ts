import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, Res } from "@nestjs/common";
import Decimal from "decimal.js";
import { z } from "zod";
import { INVOICE_STATES, InvoiceState, applyPayment, computeInvoice, formatInvoiceNumber, invoiceWorkflow, timesheetWorkflow, TimesheetState } from "@portage/domain";
import { PrismaService, Tx } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext, RequirePermission } from "./auth.guard";
import { ACCOUNTS, LedgerService } from "./ledger.service";
import { applyAsAnyRole, parisToday, parseZod } from "./workflow";
import { InvoicesService } from "./invoices.service";
import { CrmService } from "./crm.service";
import { PaymentsService } from "./payments.service";
import type { Response } from "express";
import { renderInvoicePdf } from "./invoice-pdf";

const Line = z.object({ description: z.string().min(2).max(300), quantity: z.string().regex(/^\d{1,6}(\.\d{1,2})?$/, "Quantité invalide").refine(v => Number(v) > 0, "Quantité > 0"), unit: z.string().min(1).max(20).default("unité"),
  unitPrice: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "Prix invalide"), vatRate: z.string().regex(/^\d{1,2}(\.\d{1,2})?$|^100$/, "Taux de TVA invalide") });
const Create = z.object({ timesheetId: z.string().uuid() });
const Credit = z.object({ reason: z.string().min(5, "Motif obligatoire (5 caractères min.)").max(500) });
const Pay = z.object({ amount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, "Montant invalide"), receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date AAAA-MM-JJ"), reference: z.string().max(100).optional() });
type R = { ctx: RequestContext };

@Controller("invoices")
export class InvoicesController {
  constructor(private prisma: PrismaService, private audit: AuditService, private ledger: LedgerService, private invoices: InvoicesService, private crm: CrmService, private payments: PaymentsService) {}

  @Get() @RequirePermission("invoice.read")
  list(@Req() { ctx }: R, @Query("status") status?: string) {
    if (status && !(INVOICE_STATES as readonly string[]).includes(status)) throw new BadRequestException("Statut inconnu");
    return this.prisma.forTenant(ctx.tenantId, tx => tx.invoice.findMany({ where: status ? { status } : {}, orderBy: { createdAt: "desc" }, take: 200 }));
  }

  @Get(":id") @RequirePermission("invoice.read")
  async get(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) {
    const i = await this.prisma.forTenant(ctx.tenantId, tx => tx.invoice.findUnique({ where: { id }, include: { payments: { orderBy: { createdAt: "asc" } } } }));
    if (!i) throw new NotFoundException();
    return { ...i, lines: await this.prisma.forTenant(ctx.tenantId, tx => tx.invoiceLine.findMany({ where: { invoiceId: id }, orderBy: { position: "asc" } })) };
  }

  /** Facture préparée à partir d'un CRA validé (logique dans InvoicesService, partagée avec les agents après approbation). */
  @Post() @RequirePermission("invoice.write")
  create(@Req() { ctx }: R, @Body() body: unknown) {
    const { timesheetId } = parseZod(Create, body);
    return this.prisma.forTenant(ctx.tenantId, tx => this.invoices.createDraft(tx, ctx, timesheetId));
  }

  /** PDF de la facture (document de travail, voir invoice-pdf.ts). Téléchargement journalisé. */
  @Get(":id/pdf") @RequirePermission("invoice.read")
  async pdf(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const data = await this.prisma.forTenant(ctx.tenantId, async tx => {
      const inv = await tx.invoice.findUnique({ where: { id } }); if (!inv) throw new NotFoundException();
      const [lines, company, profile, site] = await Promise.all([tx.invoiceLine.findMany({ where: { invoiceId: id }, orderBy: { position: "asc" } }), tx.company.findUniqueOrThrow({ where: { id: inv.companyId } }), tx.tenantProfile.findUnique({ where: { tenantId: ctx.tenantId } }),
        tx.companySite.findFirst({ where: { companyId: inv.companyId, archivedAt: null }, orderBy: { createdAt: "asc" } })]);
      const issue = inv.issueDate ? inv.issueDate.toISOString().slice(0, 10) : null;
      const due = issue && company.paymentTermsDays != null ? new Date(Date.parse(issue) + company.paymentTermsDays * 86400_000).toISOString().slice(0, 10) : null;
      await this.audit.record(tx, ctx, { action: "invoice.pdf_downloaded", entity: "Invoice", entityId: id, after: { status: inv.status } });
      return { inv, buf: await renderInvoicePdf(profile ?? {}, { number: inv.number, status: inv.status, series: inv.series, issueDate: issue, dueDate: due, paymentTermsDays: company.paymentTermsDays,
        buyer: { name: company.name, siren: company.siren, address: site ? `${site.address}, ${site.postalCode} ${site.city}` : null },
        lines: lines.map(l => ({ description: l.description, unit: l.unit, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), vatRate: l.vatRate.toString(), net: l.net.toString() })), net: inv.net.toString(), vat: inv.vat.toString(), gross: inv.gross.toString(), paid: inv.paid.toString() }) };
    });
    res.set({ "content-type": "application/pdf", "content-disposition": `attachment; filename="${(data.inv.number ?? `brouillon-${id.slice(0, 8)}`).replace(/[^\w.-]/g, "_")}.pdf"`, "x-content-type-options": "nosniff", "cache-control": "no-store" });
    res.end(data.buf);
  }

  @Post(":id/lines") @RequirePermission("invoice.write")
  addLine(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parseZod(Line, body);
    return this.prisma.forTenant(ctx.tenantId, tx => this.invoices.addLine(tx, ctx, id, d));
  }
  @Delete(":id/lines/:lineId") @RequirePermission("invoice.write")
  removeLine(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Param("lineId", ParseUUIDPipe) lineId: string) {
    return this.prisma.forTenant(ctx.tenantId, tx => this.invoices.removeLine(tx, ctx, id, lineId));
  }

  /** Émission : numéro séquentiel sans trou (verrou de ligne, annulé avec la transaction) + écriture comptable. */
  @Post(":id/issue") @RequirePermission("invoice.issue")
  issue(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) {
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const inv = await tx.invoice.findUnique({ where: { id } });
      if (!inv) throw new NotFoundException();
      const next = applyAsAnyRole(invoiceWorkflow, inv.status as InvoiceState, "issue", ctx.userId, ctx.roles, { paid: inv.paid.toString() });
      const today = parisToday(); const year = Number(today.slice(0, 4));
      const rows = await tx.$queryRaw<{ last: number }[]>`
        INSERT INTO "InvoiceSequence"("tenantId","series","year","last") VALUES (${ctx.tenantId}, ${inv.series}, ${year}, 1)
        ON CONFLICT ("tenantId","series","year") DO UPDATE SET "last" = "InvoiceSequence"."last" + 1 RETURNING "last"`;
      const number = formatInvoiceNumber(inv.series, year, rows[0]!.last);
      const r = await tx.invoice.updateMany({ where: { id, status: "draft" }, data: { status: next, number, issueDate: new Date(today) } });
      if (r.count !== 1) throw new ConflictException("Facture modifiée entre-temps");
      const mission = await tx.mission.findUniqueOrThrow({ where: { id: inv.missionId } });
      await this.ledger.post(tx, { tenantId: ctx.tenantId, key: `invoice.issue:${id}`, label: `Facture ${number}`, valueDate: today, sourceType: "invoice", sourceId: id, consultantId: mission.consultantId,
        lines: [{ account: ACCOUNTS.clients, debit: inv.gross.toString() }, { account: ACCOUNTS.prestations, credit: inv.net.toString() }, { account: ACCOUNTS.tvaCollectee, credit: inv.vat.toString() }] });
      await this.audit.record(tx, ctx, { action: "invoice.issue", entity: "Invoice", entityId: id, before: { status: "draft" }, after: { status: next, number, gross: inv.gross.toString(), einvoiceStatus: "not_connected" } });
      return tx.invoice.findUniqueOrThrow({ where: { id } });
    });
  }

  @Post(":id/payments") @RequirePermission("payment.write")
  pay(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parseZod(Pay, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      await this.payments.record(tx, ctx, id, d);
      return tx.invoice.findUniqueOrThrow({ where: { id }, include: { payments: true } });
    });
  }

  /** Annulation d'une facture émise non encaissée : contrepassation (jamais de suppression). */
  @Post(":id/cancel") @RequirePermission("invoice.issue")
  cancel(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) {
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const inv = await tx.invoice.findUnique({ where: { id } });
      if (!inv) throw new NotFoundException();
      const next = applyAsAnyRole(invoiceWorkflow, inv.status as InvoiceState, "cancel", ctx.userId, ctx.roles, { paid: inv.paid.toString() });
      const r = await tx.invoice.updateMany({ where: { id, status: inv.status, paid: inv.paid }, data: { status: next } });
      if (r.count !== 1) throw new ConflictException("Facture modifiée entre-temps");
      await this.reverseIssue(tx, ctx, inv.id);
      await this.audit.record(tx, ctx, { action: "invoice.cancel", entity: "Invoice", entityId: id, before: { status: inv.status }, after: { status: next } });
      return tx.invoice.findUniqueOrThrow({ where: { id } });
    });
  }

  /** Avoir total : contrepassation de l'écriture d'émission, numéro AV séquentiel sans trou. Si la facture était encaissée, le trop-perçu reste visible au compte 411 (à rembourser : non automatisé). */
  @Post(":id/credit") @RequirePermission("invoice.issue")
  credit(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { reason } = parseZod(Credit, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const inv = await tx.invoice.findUnique({ where: { id } });
      if (!inv) throw new NotFoundException();
      const next = applyAsAnyRole(invoiceWorkflow, inv.status as InvoiceState, "credit", ctx.userId, ctx.roles, { paid: inv.paid.toString() });
      const today = parisToday(); const year = Number(today.slice(0, 4));
      const rows = await tx.$queryRaw<{ last: number }[]>`
        INSERT INTO "InvoiceSequence"("tenantId","series","year","last") VALUES (${ctx.tenantId}, 'AV', ${year}, 1)
        ON CONFLICT ("tenantId","series","year") DO UPDATE SET "last" = "InvoiceSequence"."last" + 1 RETURNING "last"`;
      const number = formatInvoiceNumber("AV", year, rows[0]!.last);
      const r = await tx.invoice.updateMany({ where: { id, status: inv.status, paid: inv.paid }, data: { status: next } });
      if (r.count !== 1) throw new ConflictException("Facture modifiée entre-temps");
      const cn = await tx.creditNote.create({ data: { tenantId: ctx.tenantId, invoiceId: id, number, issueDate: new Date(today), net: inv.net, vat: inv.vat, gross: inv.gross, reason, createdBy: ctx.userId } });
      const orig = await tx.journalEntry.findUniqueOrThrow({ where: { tenantId_key: { tenantId: ctx.tenantId, key: `invoice.issue:${id}` } }, include: { lines: true } });
      await this.ledger.post(tx, { tenantId: ctx.tenantId, key: `credit_note:${cn.id}`, label: `Avoir ${number} (facture ${inv.number})`, valueDate: today, sourceType: "credit_note", sourceId: cn.id, consultantId: orig.consultantId ?? undefined, reversalOf: orig.id,
        lines: orig.lines.map(l => ({ account: l.account, debit: l.credit.toString(), credit: l.debit.toString() })) });
      await this.audit.record(tx, ctx, { action: "invoice.credit_note", entity: "Invoice", entityId: id, before: { status: inv.status, paid: inv.paid.toString() }, after: { status: next, creditNote: number, gross: inv.gross.toString(), reason } });
      return { invoice: await tx.invoice.findUniqueOrThrow({ where: { id } }), creditNote: cn };
    });
  }

  private async reverseIssue(tx: Tx, ctx: RequestContext, invoiceId: string) {
    const orig = await tx.journalEntry.findUniqueOrThrow({ where: { tenantId_key: { tenantId: ctx.tenantId, key: `invoice.issue:${invoiceId}` } }, include: { lines: true } });
    await this.ledger.post(tx, { tenantId: ctx.tenantId, key: `invoice.cancel:${invoiceId}`, label: `Annulation ${orig.label}`, valueDate: parisToday(), sourceType: "invoice", sourceId: invoiceId,
      consultantId: orig.consultantId ?? undefined, reversalOf: orig.id,
      lines: orig.lines.map(l => ({ account: l.account, debit: l.credit.toString(), credit: l.debit.toString() })) });
  }
}

@Controller("ledger")
export class LedgerController {
  constructor(private prisma: PrismaService) {}

  @Get("entries") @RequirePermission("ledger.read")
  entries(@Req() { ctx }: R) {
    return this.prisma.forTenant(ctx.tenantId, tx => tx.journalEntry.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { lines: true } }));
  }

  @Get("trial-balance") @RequirePermission("ledger.read")
  trial(@Req() { ctx }: R) {
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const g = await tx.journalLine.groupBy({ by: ["account"], _sum: { debit: true, credit: true }, orderBy: { account: "asc" } });
      return g.map(r => ({ account: r.account, debit: (r._sum.debit ?? new Decimal(0)).toString(), credit: (r._sum.credit ?? new Decimal(0)).toString() }));
    });
  }

  /** Réconciliation facturation ↔ journal : le solde du compte 411 doit égaler les créances ouvertes. */
  @Get("reconciliation") @RequirePermission("ledger.read")
  reconcile(@Req() { ctx }: R) {
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const a = await tx.journalLine.aggregate({ where: { account: ACCOUNTS.clients }, _sum: { debit: true, credit: true } });
      const ledger411 = new Decimal((a._sum.debit ?? 0).toString()).minus((a._sum.credit ?? 0).toString());
      const open = await tx.invoice.findMany({ where: { status: { in: ["issued", "partially_paid", "paid"] } }, select: { gross: true, paid: true } });
      const credited = await tx.invoice.findMany({ where: { status: "credited" }, select: { paid: true } });
      // Facture avoirée : solde 411 = -encaissé (trop-perçu à rembourser au client).
      const outstanding = open.reduce((s, i) => s.plus(i.gross.toString()).minus(i.paid.toString()), new Decimal(0))
        .minus(credited.reduce((s, i) => s.plus(i.paid.toString()), new Decimal(0)));
      const lines = await tx.journalLine.aggregate({ _sum: { debit: true, credit: true } });
      const totalDebit = new Decimal((lines._sum.debit ?? 0).toString()), totalCredit = new Decimal((lines._sum.credit ?? 0).toString());
      return { ledger411: ledger411.toFixed(2), invoicesOutstanding: outstanding.toFixed(2), receivablesMatch: ledger411.eq(outstanding), totalDebit: totalDebit.toFixed(2), totalCredit: totalCredit.toFixed(2), journalBalanced: totalDebit.eq(totalCredit) };
    });
  }
}
