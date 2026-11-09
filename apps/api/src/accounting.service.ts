import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import Decimal from "decimal.js";
import { accountBalance, fecRows, isValidAccountCode, journalCode, monthRange, toFecText } from "@portage/domain";
import { Tx } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext } from "./auth.guard";
import { LedgerService, ensureChart } from "./ledger.service";
import { parisToday } from "./workflow";

const D = (v: unknown) => new Decimal(String(v ?? 0));
const bounds = (from: string, to: string) => { const months = monthRange(from, to); const start = new Date(`${from}-01`); const endEx = new Date(`${months[months.length - 1]}-01`); endEx.setUTCMonth(endEx.getUTCMonth() + 1); return { months, start, endEx }; };
export interface Check { code: string; message: string; count: number }

@Injectable()
export class AccountingService {
  constructor(private audit: AuditService, private ledger: LedgerService) {}

  // ---------- plan comptable ----------
  async accounts(tx: Tx, tenantId: string) { await ensureChart(tx, tenantId); return tx.account.findMany({ orderBy: { code: "asc" } }); }
  async createAccount(tx: Tx, ctx: RequestContext, d: { code: string; label: string; type: string }) {
    if (!isValidAccountCode(d.code)) throw new BadRequestException("Code de compte invalide (3 à 8 chiffres, ne commence pas par 0)");
    await ensureChart(tx, ctx.tenantId);
    if (await tx.account.findUnique({ where: { tenantId_code: { tenantId: ctx.tenantId, code: d.code } } })) throw new ConflictException("Ce compte existe déjà");
    const a = await tx.account.create({ data: { tenantId: ctx.tenantId, ...d } });
    await this.audit.record(tx, ctx, { action: "accounting.account_create", entity: "Account", entityId: a.id, after: d });
    return a;
  }
  async patchAccount(tx: Tx, ctx: RequestContext, code: string, d: { label?: string; active?: boolean }) {
    const a = await tx.account.findUnique({ where: { tenantId_code: { tenantId: ctx.tenantId, code } } });
    if (!a) throw new NotFoundException();
    if (a.system && d.active === false) throw new ConflictException("Un compte système (utilisé par les flux automatiques) ne peut pas être désactivé");
    const u = await tx.account.update({ where: { id: a.id }, data: d });
    await this.audit.record(tx, ctx, { action: "accounting.account_update", entity: "Account", entityId: a.id, before: { label: a.label, active: a.active }, after: d });
    return u;
  }

  // ---------- rapprochement, balance, TVA, tiers ----------
  async reconcile(tx: Tx) {
    const a = await tx.journalLine.aggregate({ where: { account: "411" }, _sum: { debit: true, credit: true } });
    const ledger411 = D(a._sum.debit).minus(D(a._sum.credit));
    const open = await tx.invoice.findMany({ where: { status: { in: ["issued", "partially_paid", "paid"] } }, select: { gross: true, paid: true } });
    const credited = await tx.invoice.findMany({ where: { status: "credited" }, select: { paid: true } });
    const outstanding = open.reduce((s, i) => s.plus(D(i.gross)).minus(D(i.paid)), D(0)).minus(credited.reduce((s, i) => s.plus(D(i.paid)), D(0)));
    return { ledger411, outstanding, match: ledger411.eq(outstanding) };
  }

  async balance(tx: Tx, tenantId: string, from: string, to: string) {
    const { start, endEx } = this.safeBounds(from, to);
    const accounts = await this.accounts(tx, tenantId);
    const mov = await tx.$queryRaw<{ account: string; d: unknown; c: unknown }[]>`SELECT l.account, SUM(l.debit) d, SUM(l.credit) c FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId" WHERE e."tenantId" = ${tenantId} AND e."valueDate" >= ${start} AND e."valueDate" < ${endEx} GROUP BY l.account`;
    const cum = await tx.$queryRaw<{ account: string; d: unknown; c: unknown }[]>`SELECT l.account, SUM(l.debit) d, SUM(l.credit) c FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId" WHERE e."tenantId" = ${tenantId} AND e."valueDate" < ${endEx} GROUP BY l.account`;
    const codes = [...new Set([...accounts.map(a => a.code), ...mov.map(m => m.account), ...cum.map(m => m.account)])].sort();
    const rows = codes.map(code => {
      const m = mov.find(x => x.account === code), c = cum.find(x => x.account === code), acc = accounts.find(a => a.code === code);
      const end = accountBalance(D(c?.d).toFixed(2), D(c?.c).toFixed(2));
      return { account: code, label: acc?.label ?? "(compte hors plan)", type: acc?.type ?? null, movementDebit: D(m?.d).toFixed(2), movementCredit: D(m?.c).toFixed(2), endDebit: end.debit, endCredit: end.credit };
    }).filter(r => r.movementDebit !== "0.00" || r.movementCredit !== "0.00" || r.endDebit !== "0.00" || r.endCredit !== "0.00");
    const sum = (k: "movementDebit" | "movementCredit" | "endDebit" | "endCredit") => rows.reduce((s, r) => s.plus(r[k]), D(0));
    const totals = { movementDebit: sum("movementDebit").toFixed(2), movementCredit: sum("movementCredit").toFixed(2), endDebit: sum("endDebit").toFixed(2), endCredit: sum("endCredit").toFixed(2) };
    return { from, to, rows, totals, balanced: totals.movementDebit === totals.movementCredit && totals.endDebit === totals.endCredit };
  }

  private safeBounds(from: string, to: string) { try { return bounds(from, to); } catch (e) { throw new BadRequestException((e as Error).message); } }

  async vat(tx: Tx, tenantId: string, from: string, to: string) {
    const { months, start, endEx } = this.safeBounds(from, to);
    const rows = await tx.$queryRaw<{ m: string; account: string; d: unknown; c: unknown }[]>`SELECT to_char(e."valueDate", 'YYYY-MM') m, l.account, SUM(l.debit) d, SUM(l.credit) c FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId" WHERE e."tenantId" = ${tenantId} AND l.account IN ('44571', '706') AND e."valueDate" >= ${start} AND e."valueDate" < ${endEx} GROUP BY 1, 2`;
    const out = months.map(m => { const net = (a: string) => { const r = rows.find(x => x.m === m && x.account === a); return D(r?.c).minus(D(r?.d)); }; return { month: m, baseHt: net("706").toFixed(2), vatCollected: net("44571").toFixed(2) }; });
    return { rows: out, totals: { baseHt: out.reduce((s, r) => s.plus(r.baseHt), D(0)).toFixed(2), vatCollected: out.reduce((s, r) => s.plus(r.vatCollected), D(0)).toFixed(2) },
      note: "Aide à la préparation de la déclaration : TVA COLLECTÉE issue du journal (factures émises, avoirs déduits). La TVA déductible n'est pas gérée (aucune facture fournisseur) et la déclaration reste à établir et valider par l'expert-comptable." };
  }

  async thirdParties(tx: Tx) {
    const inv = await tx.invoice.findMany({ where: { status: { in: ["issued", "partially_paid", "paid", "credited"] } }, select: { companyId: true, status: true, gross: true, paid: true } });
    const by = new Map<string, Decimal>();
    for (const i of inv) { const due = i.status === "credited" ? D(i.paid).neg() : D(i.gross).minus(D(i.paid)); by.set(i.companyId, (by.get(i.companyId) ?? D(0)).plus(due)); }
    const cos = await tx.company.findMany({ where: { id: { in: [...by.keys()] } }, select: { id: true, name: true } });
    const rows = [...by.entries()].map(([id, v]) => ({ companyId: id, name: cos.find(c => c.id === id)?.name ?? id, balance: v.toFixed(2) })).sort((a, b) => a.name.localeCompare(b.name));
    const r = await this.reconcile(tx);
    return { rows, total: rows.reduce((s, x) => s.plus(x.balance), D(0)).toFixed(2), ledger411: r.ledger411.toFixed(2), match: r.match };
  }

  // ---------- périodes et clôture ----------
  async periods(tx: Tx, tenantId: string) {
    const now = parisToday().slice(0, 7); const [y, m] = now.split("-").map(Number) as [number, number];
    const list: string[] = []; for (let i = 0; i < 24; i++) { const t = y * 12 + (m - 1) - i; list.push(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`); }
    const rows = await tx.closingPeriod.findMany({ where: { period: { in: list } } });
    const counts = await tx.$queryRaw<{ m: string; n: bigint }[]>`SELECT to_char("valueDate", 'YYYY-MM') m, COUNT(*) n FROM "JournalEntry" WHERE "tenantId" = ${tenantId} GROUP BY 1`;
    return list.map(p => { const r = rows.find(x => x.period === p); return { period: p, status: r?.status === "closed" ? "closed" : "open", closedAt: r?.status === "closed" ? r.closedAt : null, entries: Number(counts.find(c => c.m === p)?.n ?? 0) }; });
  }

  async checks(tx: Tx, tenantId: string, period: string) {
    const { start } = this.safeBounds(period, period);
    const blockers: Check[] = [], warnings: Check[] = [];
    const drafts = await tx.invoice.count({ where: { status: "draft", timesheet: { period: { lte: period } } } });
    if (drafts) blockers.push({ code: "draft_invoices", message: "Factures brouillon non émises concernant cette période ou une période antérieure", count: drafts });
    const earlier = await tx.$queryRaw<{ m: string }[]>`SELECT DISTINCT to_char("valueDate", 'YYYY-MM') m FROM "JournalEntry" WHERE "tenantId" = ${tenantId} AND "valueDate" < ${start}`;
    const closed = new Set((await tx.closingPeriod.findMany({ where: { status: "closed" }, select: { period: true } })).map(c => c.period));
    const openEarlier = earlier.map(e => e.m).filter(m => !closed.has(m));
    if (openEarlier.length) blockers.push({ code: "earlier_open", message: `Périodes antérieures avec écritures non closes : ${openEarlier.sort().join(", ")} (clôture séquentielle)`, count: openEarlier.length });
    const rec = await this.reconcile(tx);
    if (!rec.match) warnings.push({ code: "reconciliation", message: `Écart de rapprochement : compte 411 = ${rec.ledger411.toFixed(2)} € ; créances selon les factures = ${rec.outstanding.toFixed(2)} € (justifier l'écart)`, count: 1 });
    const exp = await tx.expenseClaim.count({ where: { status: "approved" } }); if (exp) warnings.push({ code: "expenses_unpaid", message: "Notes de frais approuvées non remboursées", count: exp });
    const val = await tx.timesheet.count({ where: { status: "validated", period: { lte: period }, invoice: null } }); if (val) warnings.push({ code: "timesheets_uninvoiced", message: "CRA validés non facturés (chiffre d'affaires non constaté)", count: val });
    const pend = (await tx.expenseClaim.count({ where: { status: "submitted" } })) + (await tx.leaveRequest.count({ where: { status: "submitted" } })); if (pend) warnings.push({ code: "pending_requests", message: "Notes de frais ou absences en attente de décision", count: pend });
    const row = await tx.closingPeriod.findUnique({ where: { tenantId_period: { tenantId, period } } });
    return { period, status: row?.status === "closed" ? "closed" : "open", blockers, warnings };
  }

  async close(tx: Tx, ctx: RequestContext, period: string, acknowledgeWarnings: boolean, comment?: string) {
    if (period > parisToday().slice(0, 7)) throw new BadRequestException("On ne peut pas clore une période future");
    const c = await this.checks(tx, ctx.tenantId, period);
    if (c.status === "closed") throw new ConflictException("Période déjà close");
    if (c.blockers.length) throw new ConflictException(`Clôture impossible : ${c.blockers.map(b => `${b.message} (${b.count})`).join(" ; ")}`);
    if (c.warnings.length && !acknowledgeWarnings) throw new ConflictException(`Points à accuser réception avant clôture : ${c.warnings.map(w => `${w.message} (${w.count})`).join(" ; ")}`);
    await tx.closingPeriod.upsert({ where: { tenantId_period: { tenantId: ctx.tenantId, period } }, create: { tenantId: ctx.tenantId, period, status: "closed", closedBy: ctx.userId }, update: { status: "closed", closedBy: ctx.userId, closedAt: new Date(), reopenedBy: null, reopenedAt: null, reopenReason: null } });
    await this.audit.record(tx, ctx, { action: "accounting.period_closed", entity: "ClosingPeriod", entityId: period, after: { warningsAcknowledged: c.warnings, comment } });
    return this.checks(tx, ctx.tenantId, period);
  }

  async reopen(tx: Tx, ctx: RequestContext, period: string, reason: string) {
    this.safeBounds(period, period);
    const row = await tx.closingPeriod.findUnique({ where: { tenantId_period: { tenantId: ctx.tenantId, period } } });
    if (!row || row.status !== "closed") throw new ConflictException("Période non close");
    const later = await tx.closingPeriod.findFirst({ where: { status: "closed", period: { gt: period } }, orderBy: { period: "asc" } });
    if (later) throw new ConflictException(`Rouvrez d'abord la période ${later.period} (réouverture dans l'ordre inverse)`);
    await tx.closingPeriod.update({ where: { id: row.id }, data: { status: "open", reopenedBy: ctx.userId, reopenedAt: new Date(), reopenReason: reason } });
    await this.audit.record(tx, ctx, { action: "accounting.period_reopened", entity: "ClosingPeriod", entityId: period, after: { reason } });
    return this.checks(tx, ctx.tenantId, period);
  }

  // ---------- écritures ----------
  async entries(tx: Tx, from: string, to: string, account?: string) {
    const { start, endEx } = this.safeBounds(from, to);
    const rows = await tx.journalEntry.findMany({ where: { valueDate: { gte: start, lt: endEx }, ...(account ? { lines: { some: { account } } } : {}) }, orderBy: [{ valueDate: "asc" }, { createdAt: "asc" }], take: 500, include: { lines: true } });
    return rows.map(e => ({ id: e.id, valueDate: e.valueDate.toISOString().slice(0, 10), label: e.label, journal: journalCode(e.sourceType), sourceType: e.sourceType, reversalOf: e.reversalOf, reason: e.reason, lines: e.lines.map(l => ({ account: l.account, debit: D(l.debit).toFixed(2), credit: D(l.credit).toFixed(2) })) }));
  }

  async manualEntry(tx: Tx, ctx: RequestContext, d: { valueDate: string; label: string; reason: string; lines: { account: string; debit?: string; credit?: string }[] }) {
    for (const l of d.lines) { const dr = D(l.debit), cr = D(l.credit); if ((dr.gt(0) && cr.gt(0)) || (dr.isZero() && cr.isZero())) throw new BadRequestException(`Ligne ${l.account} : un seul des deux montants (débit ou crédit), strictement positif`); }
    const td = d.lines.reduce((s, l) => s.plus(D(l.debit)), D(0)), tc = d.lines.reduce((s, l) => s.plus(D(l.credit)), D(0));
    if (!td.eq(tc)) throw new BadRequestException(`Écriture déséquilibrée : débit ${td.toFixed(2)} ≠ crédit ${tc.toFixed(2)}`);
    const key = `manual:${crypto.randomUUID()}`;
    const e = await this.ledger.post(tx, { tenantId: ctx.tenantId, key, label: d.label, valueDate: d.valueDate, sourceType: "manual", sourceId: key, reason: d.reason, lines: d.lines });
    await this.audit.record(tx, ctx, { action: "accounting.manual_entry", entity: "JournalEntry", entityId: e.id, after: { label: d.label, valueDate: d.valueDate, reason: d.reason, debit: td.toFixed(2) } });
    return e;
  }

  /** Contrepassation d'une écriture MANUELLE uniquement : les écritures automatiques se corrigent par leurs flux (annulation, avoir). */
  async reverse(tx: Tx, ctx: RequestContext, id: string, reason: string, valueDate?: string) {
    const orig = await tx.journalEntry.findUnique({ where: { id }, include: { lines: true } });
    if (!orig) throw new NotFoundException();
    if (orig.sourceType !== "manual") throw new ForbiddenException("Seules les écritures manuelles se contrepassent ici ; corrigez une écriture automatique par son flux (annulation de facture, avoir…)");
    if (orig.reversalOf) throw new ConflictException("Une contrepassation ne se contrepasse pas");
    if (await tx.journalEntry.findFirst({ where: { reversalOf: id } })) throw new ConflictException("Écriture déjà contrepassée");
    const key = `manual:${crypto.randomUUID()}`;
    const e = await this.ledger.post(tx, { tenantId: ctx.tenantId, key, label: `Contrepassation : ${orig.label}`, valueDate: valueDate ?? parisToday(), sourceType: "manual", sourceId: key, reason, reversalOf: id,
      lines: orig.lines.map(l => ({ account: l.account, debit: D(l.credit).toFixed(2), credit: D(l.debit).toFixed(2) })) });
    await this.audit.record(tx, ctx, { action: "accounting.reversal", entity: "JournalEntry", entityId: e.id, after: { reverses: id, reason } });
    return e;
  }

  // ---------- exports ----------
  async fec(tx: Tx, ctx: RequestContext, from: string, to: string) {
    const { start, endEx, months } = this.safeBounds(from, to);
    await ensureChart(tx, ctx.tenantId);
    const [accounts, entries, periods] = await Promise.all([tx.account.findMany(), tx.journalEntry.findMany({ where: { valueDate: { gte: start, lt: endEx } }, orderBy: [{ valueDate: "asc" }, { createdAt: "asc" }], include: { lines: true } }), tx.closingPeriod.findMany({ where: { status: "closed" } })]);
    const closed = new Map(periods.map(p => [p.period, p.closedAt.toISOString().slice(0, 10)]));
    const rows = fecRows(entries.map(e => ({ id: e.id, valueDate: e.valueDate.toISOString().slice(0, 10), createdDate: e.createdAt.toISOString().slice(0, 10), sourceType: e.sourceType, sourceId: e.sourceId, label: e.label, validDate: closed.get(e.valueDate.toISOString().slice(0, 7)),
      lines: e.lines.map(l => ({ account: l.account, debit: D(l.debit).toFixed(2), credit: D(l.credit).toFixed(2) })) })), Object.fromEntries(accounts.map(a => [a.code, a.label])));
    const provisional = months.some(m => !closed.has(m));
    await this.audit.record(tx, ctx, { action: "accounting.export_fec", entity: "Report", after: { from, to, entries: entries.length, lines: rows.length, provisional } });
    return { text: toFecText(rows), provisional, entries: entries.length };
  }
}
