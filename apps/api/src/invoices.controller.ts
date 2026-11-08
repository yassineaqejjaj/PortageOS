import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req } from "@nestjs/common";
import Decimal from "decimal.js";
import { z } from "zod";
import { INVOICE_STATES, InvoiceState, applyPayment, computeInvoice, formatInvoiceNumber, invoiceWorkflow, timesheetWorkflow, TimesheetState } from "@portage/domain";
import { PrismaService, Tx } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext, RequirePermission } from "./auth.guard";
import { ACCOUNTS, LedgerService } from "./ledger.service";
import { applyAsAnyRole, parisToday, parseZod } from "./workflow";

const Create = z.object({ timesheetId: z.string().uuid() });
const Pay = z.object({ amount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, "Montant invalide"), receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date AAAA-MM-JJ"), reference: z.string().max(100).optional() });
type R = { ctx: RequestContext };

@Controller("invoices")
export class InvoicesController {
  constructor(private prisma: PrismaService, private audit: AuditService, private ledger: LedgerService) {}

  @Get() @RequirePermission("invoice.read")
  list(@Req() { ctx }: R, @Query("status") status?: string) {
    if (status && !(INVOICE_STATES as readonly string[]).includes(status)) throw new BadRequestException("Statut inconnu");
    return this.prisma.forTenant(ctx.tenantId, tx => tx.invoice.findMany({ where: status ? { status } : {}, orderBy: { createdAt: "desc" }, take: 200 }));
  }

  @Get(":id") @RequirePermission("invoice.read")
  async get(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) {
    const i = await this.prisma.forTenant(ctx.tenantId, tx => tx.invoice.findUnique({ where: { id }, include: { payments: { orderBy: { createdAt: "asc" } } } }));
    if (!i) throw new NotFoundException();
    return i;
  }

  /** Facture préparée à partir d'un CRA validé; le CRA passe « facturé » (verrouillé). Montants calculés côté serveur uniquement. */
  @Post() @RequirePermission("invoice.write")
  create(@Req() { ctx }: R, @Body() body: unknown) {
    const { timesheetId } = parseZod(Create, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const ts = await tx.timesheet.findUnique({ where: { id: timesheetId }, include: { mission: true, lines: true } });
      if (!ts) throw new NotFoundException();
      if (ts.status !== "validated") throw new BadRequestException(`Le CRA doit être validé (statut actuel : ${ts.status})`);
      if (await tx.invoice.findUnique({ where: { timesheetId } })) throw new ConflictException("Ce CRA est déjà facturé");
      const days = ts.lines.reduce((s, l) => s.plus(l.quantity.toString()), new Decimal(0));
      const t = computeInvoice({ days: days.toString(), unitPrice: ts.mission.dailyRate.toString(), vatRate: ts.mission.vatRate.toString() });
      const inv = await tx.invoice.create({ data: { tenantId: ctx.tenantId, companyId: ts.mission.companyId, missionId: ts.missionId, timesheetId,
        days: days.toString(), unitPrice: ts.mission.dailyRate, vatRate: ts.mission.vatRate, net: t.net.amount.toFixed(2), vat: t.vat.amount.toFixed(2), gross: t.gross.amount.toFixed(2) } });
      const next = applyAsAnyRole(timesheetWorkflow, ts.status as TimesheetState, "mark_invoiced", ctx.userId, ctx.roles, { totalDays: days.toString(), invoiceId: inv.id });
      const r = await tx.timesheet.updateMany({ where: { id: timesheetId, status: "validated" }, data: { status: next } });
      if (r.count !== 1) throw new ConflictException("CRA modifié entre-temps");
      await this.audit.record(tx, ctx, { action: "invoice.create", entity: "Invoice", entityId: inv.id, after: { timesheetId, net: inv.net, vat: inv.vat, gross: inv.gross } });
      return inv;
    });
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
      const inv = await tx.invoice.findUnique({ where: { id } });
      if (!inv) throw new NotFoundException();
      let res; try { res = applyPayment(inv.status as InvoiceState, inv.gross.toString(), inv.paid.toString(), d.amount); } catch (e) { throw new BadRequestException((e as Error).message); }
      const p = await tx.payment.create({ data: { tenantId: ctx.tenantId, invoiceId: id, amount: d.amount, receivedOn: new Date(d.receivedOn), reference: d.reference } });
      const r = await tx.invoice.updateMany({ where: { id, paid: inv.paid, status: inv.status }, data: { paid: res.paid, status: res.state } });
      if (r.count !== 1) throw new ConflictException("Facture modifiée entre-temps (encaissement concurrent), rechargez.");
      const mission = await tx.mission.findUniqueOrThrow({ where: { id: inv.missionId } });
      await this.ledger.post(tx, { tenantId: ctx.tenantId, key: `payment:${p.id}`, label: `Encaissement ${inv.number}`, valueDate: d.receivedOn, sourceType: "payment", sourceId: p.id, consultantId: mission.consultantId,
        lines: [{ account: ACCOUNTS.banque, debit: d.amount }, { account: ACCOUNTS.clients, credit: d.amount }] });
      await this.audit.record(tx, ctx, { action: "payment.record", entity: "Invoice", entityId: id, before: { paid: inv.paid.toString(), status: inv.status }, after: { paid: res.paid, status: res.state, amount: d.amount } });
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
      const outstanding = open.reduce((s, i) => s.plus(i.gross.toString()).minus(i.paid.toString()), new Decimal(0));
      const lines = await tx.journalLine.aggregate({ _sum: { debit: true, credit: true } });
      const totalDebit = new Decimal((lines._sum.debit ?? 0).toString()), totalCredit = new Decimal((lines._sum.credit ?? 0).toString());
      return { ledger411: ledger411.toFixed(2), invoicesOutstanding: outstanding.toFixed(2), receivablesMatch: ledger411.eq(outstanding), totalDebit: totalDebit.toFixed(2), totalCredit: totalCredit.toFixed(2), journalBalanced: totalDebit.eq(totalCredit) };
    });
  }
}
