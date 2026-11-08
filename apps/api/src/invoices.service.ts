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
    const next = applyAsAnyRole(timesheetWorkflow, ts.status as TimesheetState, "mark_invoiced", ctx.userId, ctx.roles, { totalDays: days.toString(), invoiceId: inv.id });
    const r = await tx.timesheet.updateMany({ where: { id: timesheetId, status: "validated" }, data: { status: next } });
    if (r.count !== 1) throw new ConflictException("CRA modifié entre-temps");
    await this.audit.record(tx, ctx, { action: "invoice.create", entity: "Invoice", entityId: inv.id, after: { timesheetId, net: inv.net, vat: inv.vat, gross: inv.gross } });
    return inv;
  }
}
