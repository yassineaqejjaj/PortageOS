import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import Decimal from "decimal.js";
import { TimesheetState, computeInvoice, timesheetWorkflow } from "@portage/domain";
import { Tx } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext } from "./auth.guard";
import { applyAsAnyRole } from "./workflow";

@Injectable()
export class InvoicesService {
  constructor(private audit: AuditService) {}

  /** Montants calculés ici uniquement (jamais fournis par le client ni par un agent). */
  async preview(tx: Tx, timesheetId: string) {
    const ts = await tx.timesheet.findUnique({ where: { id: timesheetId }, include: { mission: true, lines: true } });
    if (!ts) throw new NotFoundException();
    const days = ts.lines.reduce((s, l) => s.plus(l.quantity.toString()), new Decimal(0));
    const t = computeInvoice({ days: days.toString(), unitPrice: ts.mission.dailyRate.toString(), vatRate: ts.mission.vatRate.toString() });
    return { ts, days, totals: t };
  }

  /** Facture préparée à partir d'un CRA validé; le CRA passe « facturé » (verrouillé). */
  async createDraft(tx: Tx, ctx: RequestContext, timesheetId: string) {
    const { ts, days, totals: t } = await this.preview(tx, timesheetId);
    if (ts.status !== "validated") throw new BadRequestException(`Le CRA doit être validé (statut actuel : ${ts.status})`);
    if (await tx.invoice.findUnique({ where: { timesheetId } })) throw new ConflictException("Ce CRA est déjà facturé");
    const inv = await tx.invoice.create({ data: { tenantId: ctx.tenantId, companyId: ts.mission.companyId, missionId: ts.missionId, timesheetId,
      days: days.toString(), unitPrice: ts.mission.dailyRate, vatRate: ts.mission.vatRate, net: t.net.amount.toFixed(2), vat: t.vat.amount.toFixed(2), gross: t.gross.amount.toFixed(2) } });
    await tx.invoiceLine.create({ data: { tenantId: ctx.tenantId, invoiceId: inv.id, position: 1, kind: "activity", description: ts.mission.title, unit: ts.mission.timeUnit === "hour" ? "heure" : "jour", quantity: days.toString(), unitPrice: ts.mission.dailyRate, vatRate: ts.mission.vatRate, net: t.net.amount.toFixed(2), vat: t.vat.amount.toFixed(2), gross: t.gross.amount.toFixed(2) } });
    const next = applyAsAnyRole(timesheetWorkflow, ts.status as TimesheetState, "mark_invoiced", ctx.userId, ctx.roles, { totalDays: days.toString(), invoiceId: inv.id });
    const r = await tx.timesheet.updateMany({ where: { id: timesheetId, status: "validated" }, data: { status: next } });
    if (r.count !== 1) throw new ConflictException("CRA modifié entre-temps");
    await this.audit.record(tx, ctx, { action: "invoice.create", entity: "Invoice", entityId: inv.id, after: { timesheetId, net: inv.net, vat: inv.vat, gross: inv.gross } });
    return inv;
  }

  /** Ligne ajoutée à un brouillon : montants calculés ici (TVA par ligne), totaux de la facture recalculés depuis les lignes. */
  async addLine(tx: Tx, ctx: RequestContext, invoiceId: string, d: { description: string; quantity: string; unit: string; unitPrice: string; vatRate: string }) {
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } }); if (!inv) throw new NotFoundException();
    if (inv.status !== "draft") throw new BadRequestException("Seul un brouillon peut être modifié");
    const last = await tx.invoiceLine.aggregate({ where: { invoiceId }, _max: { position: true } });
    const t = computeInvoice({ days: d.quantity, unitPrice: d.unitPrice, vatRate: d.vatRate });
    const line = await tx.invoiceLine.create({ data: { tenantId: ctx.tenantId, invoiceId, position: (last._max.position ?? 0) + 1, kind: "extra", description: d.description, unit: d.unit, quantity: d.quantity, unitPrice: d.unitPrice, vatRate: d.vatRate, net: t.net.amount.toFixed(2), vat: t.vat.amount.toFixed(2), gross: t.gross.amount.toFixed(2) } });
    await this.recompute(tx, invoiceId);
    await this.audit.record(tx, ctx, { action: "invoice.line_added", entity: "Invoice", entityId: invoiceId, after: { lineId: line.id, net: line.net.toString(), vatRate: d.vatRate } });
    return line;
  }
  async removeLine(tx: Tx, ctx: RequestContext, invoiceId: string, lineId: string) {
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } }); if (!inv) throw new NotFoundException();
    if (inv.status !== "draft") throw new BadRequestException("Seul un brouillon peut être modifié");
    const line = await tx.invoiceLine.findFirst({ where: { id: lineId, invoiceId } }); if (!line) throw new NotFoundException();
    if (line.kind === "activity") throw new BadRequestException("La ligne d'activité issue du CRA ne peut pas être supprimée");
    await tx.invoiceLine.delete({ where: { id: lineId } }); await this.recompute(tx, invoiceId);
    await this.audit.record(tx, ctx, { action: "invoice.line_removed", entity: "Invoice", entityId: invoiceId, before: { lineId, net: line.net.toString() } });
    return { id: lineId, removed: true };
  }
  /** Les totaux de la facture sont TOUJOURS la somme des lignes (jamais saisis). */
  async recompute(tx: Tx, invoiceId: string) {
    const lines = await tx.invoiceLine.findMany({ where: { invoiceId } });
    const sum = (k: "net" | "vat" | "gross") => lines.reduce((a, l) => a.plus(l[k].toString()), new Decimal(0)).toFixed(2);
    await tx.invoice.update({ where: { id: invoiceId }, data: { net: sum("net"), vat: sum("vat"), gross: sum("gross") } });
  }
}
