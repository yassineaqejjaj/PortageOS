import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import Decimal from "decimal.js";
import { TimesheetState, dateInPeriod, isValidDayQuantity, isValidPeriod, timesheetWorkflow } from "@portage/domain";
import { Tx } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext } from "./auth.guard";
import { applyAsAnyRole } from "./workflow";

export interface Scope { consultantId?: string; companyId?: string }
export interface LineInput { date: string; quantity: string }

@Injectable()
export class TimesheetsService {
  constructor(private audit: AuditService) {}

  private visible(m: { consultantId: string; companyId: string }, scope: Scope) {
    return (!scope.consultantId || m.consultantId === scope.consultantId) && (!scope.companyId || m.companyId === scope.companyId);
  }

  async putLines(tx: Tx, ctx: RequestContext, missionId: string, period: string, lines: LineInput[], scope: Scope) {
    if (!isValidPeriod(period)) throw new BadRequestException("Période invalide (AAAA-MM)");
    const mission = await tx.mission.findUnique({ where: { id: missionId } });
    if (!mission || !this.visible(mission, scope)) throw new NotFoundException();
    if (mission.status !== "active") throw new BadRequestException("Mission terminée");
    const start = mission.startDate.toISOString().slice(0, 10), end = mission.endDate?.toISOString().slice(0, 10);
    const seen = new Set<string>();
    for (const l of lines) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(l.date) || !dateInPeriod(l.date, period)) throw new BadRequestException(`Date hors période : ${l.date}`);
      if (l.date < start || (end && l.date > end)) throw new BadRequestException(`Date hors mission : ${l.date}`);
      if (!isValidDayQuantity(l.quantity)) throw new BadRequestException("Quantité : 0,5 ou 1 jour");
      if (seen.has(l.date)) throw new BadRequestException(`Date en double : ${l.date}`);
      seen.add(l.date);
    }
    let ts = await tx.timesheet.findUnique({ where: { missionId_period: { missionId, period } } });
    if (ts && ts.status !== "draft") throw new BadRequestException(`CRA non modifiable (statut ${ts.status})`);
    if (!ts) ts = await tx.timesheet.create({ data: { tenantId: ctx.tenantId, missionId, period } });
    await tx.timesheetLine.deleteMany({ where: { timesheetId: ts.id } });
    if (lines.length) await tx.timesheetLine.createMany({ data: lines.map(l => ({ tenantId: ctx.tenantId, timesheetId: ts!.id, date: new Date(l.date), quantity: l.quantity })) });
    await this.audit.record(tx, ctx, { action: "timesheet.lines_saved", entity: "Timesheet", entityId: ts.id, after: { period, days: lines.reduce((s, l) => s.plus(l.quantity), new Decimal(0)).toString() } });
    return this.view(tx, ts.id);
  }

  async totalDays(tx: Tx, timesheetId: string): Promise<string> {
    const lines = await tx.timesheetLine.findMany({ where: { timesheetId } });
    return lines.reduce((s, l) => s.plus(l.quantity.toString()), new Decimal(0)).toString();
  }

  /** Vue sans aucune donnée tarifaire ni salariale (utilisée aussi par le portail client). */
  async view(tx: Tx, id: string) {
    const t = await tx.timesheet.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { date: "asc" } }, mission: { include: { consultant: true } } } });
    return { id: t.id, period: t.period, status: t.status, rejectReason: t.rejectReason, missionId: t.missionId, missionTitle: t.mission.title,
      consultantName: `${t.mission.consultant.firstName} ${t.mission.consultant.lastName}`, totalDays: await this.totalDays(tx, id),
      lines: t.lines.map(l => ({ date: l.date.toISOString().slice(0, 10), quantity: l.quantity.toString() })) };
  }

  async transition(tx: Tx, ctx: RequestContext, id: string, event: string, reason: string | undefined, allowed: string[], scope: Scope) {
    if (!allowed.includes(event)) throw new ForbiddenException("Action non disponible depuis ce portail");
    const t = await tx.timesheet.findUnique({ where: { id }, include: { mission: true } });
    if (!t || !this.visible(t.mission, scope)) throw new NotFoundException();
    const total = await this.totalDays(tx, id);
    const next = applyAsAnyRole(timesheetWorkflow, t.status as TimesheetState, event, ctx.userId, ctx.roles, { totalDays: total, rejectReason: reason });
    const now = new Date();
    const data: Record<string, unknown> = { status: next };
    if (event === "submit") data.submittedAt = now;
    if (["approve", "reject", "validate"].includes(event)) { data.decidedAt = now; data.decidedBy = ctx.userId; }
    data.rejectReason = event === "reject" ? reason!.trim() : null;
    const r = await tx.timesheet.updateMany({ where: { id, status: t.status }, data });
    if (r.count !== 1) throw new ConflictException("CRA modifié entre-temps, rechargez.");
    // Preuve de validation : acteur, rôle, horodatage et étape sont tracés dans l'audit append-only.
    await this.audit.record(tx, ctx, { action: `timesheet.${event}`, entity: "Timesheet", entityId: id, before: { status: t.status }, after: { status: next, totalDays: total, reason: data.rejectReason, roles: ctx.roles } });
    return this.view(tx, id);
  }
}
