import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import Decimal from "decimal.js";
import { TimeUnit, TimesheetState, dateInPeriod, isValidPeriod, isValidQuantity, parseTimesheetCsv, timesheetWorkflow, toCsv } from "@portage/domain";
import { Tx } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext } from "./auth.guard";
import { applyAsAnyRole } from "./workflow";
import { LeavesService } from "./leaves.service";
import { NotificationsService } from "./notifications.service";

export interface Scope { consultantId?: string; companyId?: string }
export interface LineInput { date: string; quantity: string }

@Injectable()
export class TimesheetsService {
  constructor(private audit: AuditService, private leaves: LeavesService, private notif: NotificationsService) {}

  private visible(m: { consultantId: string; companyId: string }, scope: Scope) {
    return (!scope.consultantId || m.consultantId === scope.consultantId) && (!scope.companyId || m.companyId === scope.companyId);
  }

  async putLines(tx: Tx, ctx: RequestContext, missionId: string, period: string, lines: LineInput[], scope: Scope) {
    if (!isValidPeriod(period)) throw new BadRequestException("Période invalide (AAAA-MM)");
    const mission = await tx.mission.findUnique({ where: { id: missionId } });
    if (!mission || !this.visible(mission, scope)) throw new NotFoundException();
    if (mission.status !== "active") throw new BadRequestException("Mission terminée");
    const start = mission.startDate.toISOString().slice(0, 10), end = mission.endDate?.toISOString().slice(0, 10);
    const unit = mission.timeUnit as TimeUnit;
    const seen = new Set<string>();
    for (const l of lines) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(l.date) || !dateInPeriod(l.date, period)) throw new BadRequestException(`Date hors période : ${l.date}`);
      if (l.date < start || (end && l.date > end)) throw new BadRequestException(`Date hors mission : ${l.date}`);
      if (!isValidQuantity(unit, l.quantity)) throw new BadRequestException(unit === "hour" ? "Quantité : heures par pas de 0,25, 24 h au plus" : "Quantité : 0,5 ou 1 jour");
      if (seen.has(l.date)) throw new BadRequestException(`Date en double : ${l.date}`);
      seen.add(l.date);
    }
    // Cohérence avec les absences approuvées : on ne déclare pas d'activité sur un jour (ou demi-jour) d'absence.
    const cover = await this.leaves.coverage(tx, mission.consultantId, lines.map(l => l.date));
    for (const l of lines) {
      const c = cover.get(l.date) ?? 0;
      // Heures : la durée d'une journée n'est pas connue, on refuse seulement une saisie sur un jour d'absence complet.
      if (unit === "hour" ? c >= 1 : c > 0 && Number(l.quantity) > 1 - c) throw new BadRequestException(unit === "hour" ? `Absence approuvée sur la journée du ${l.date}` : `Absence approuvée le ${l.date} : activité déclarable ${1 - c} j au plus`);
    }
    let ts = await tx.timesheet.findUnique({ where: { missionId_period: { missionId, period } } });
    if (ts && ts.status !== "draft") throw new BadRequestException(`CRA non modifiable (statut ${ts.status})`);
    if (!ts) ts = await tx.timesheet.create({ data: { tenantId: ctx.tenantId, missionId, period } });
    await tx.timesheetLine.deleteMany({ where: { timesheetId: ts.id } });
    if (lines.length) await tx.timesheetLine.createMany({ data: lines.map(l => ({ tenantId: ctx.tenantId, timesheetId: ts!.id, date: new Date(l.date), quantity: l.quantity })) });
    await this.audit.record(tx, ctx, { action: "timesheet.lines_saved", entity: "Timesheet", entityId: ts.id, after: { period, unit, total: lines.reduce((s, l) => s.plus(l.quantity), new Decimal(0)).toString() } });
    return this.view(tx, ts.id, !scope.companyId);
  }

  async totalDays(tx: Tx, timesheetId: string): Promise<string> {
    const lines = await tx.timesheetLine.findMany({ where: { timesheetId } });
    return lines.reduce((s, l) => s.plus(l.quantity.toString()), new Decimal(0)).toString();
  }

  /** Jours déclarés dans l'année sur les missions au forfait jours (CRA soumis ou plus avancés). Le plafond est saisi, jamais présumé ; dépassement = alerte, non bloquant. */
  async yearDays(tx: Tx, consultantId: string, year: string, cap: number | null) {
    const rows = await tx.timesheetLine.findMany({ where: { timesheet: { period: { startsWith: `${year}-` }, status: { not: "draft" }, mission: { consultantId, timeUnit: "forfait_jours" } } }, select: { quantity: true } });
    const days = rows.reduce((a, l) => a.plus(l.quantity.toString()), new Decimal(0));
    return { year, days: days.toString(), cap, overCap: cap !== null && days.gt(cap), capNote: "Plafond saisi par l'administrateur, non vérifié par la plateforme ; suivi de charge et repos non gérés." };
  }

  /** Vue sans aucune donnée tarifaire ni salariale (utilisée aussi par le portail client). */
  async view(tx: Tx, id: string, withForfait = false) {
    const t = await tx.timesheet.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { date: "asc" } }, mission: { include: { consultant: true } } } });
    const unit = t.mission.timeUnit as TimeUnit;
    const forfait = withForfait && unit === "forfait_jours" ? await this.yearDays(tx, t.mission.consultantId, t.period.slice(0, 4), t.mission.annualDaysCap) : null;
    return { id: t.id, period: t.period, status: t.status, rejectReason: t.rejectReason, missionId: t.missionId, missionTitle: t.mission.title, unit, forfait,
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
    await this.notifyTransition(tx, ctx, t.mission, event, t.period, reason);
    return this.view(tx, id, !scope.companyId);
  }

  private async notifyTransition(tx: Tx, ctx: RequestContext, mission: { consultantId: string; companyId: string; title: string }, event: string, period: string, reason?: string) {
    const who = `${period} · ${mission.title}`;
    const consultants = await this.notif.consultantUsers(tx, ctx.tenantId, mission.consultantId);
    const staff = await this.notif.usersByRoles(tx, ctx.tenantId, ["operations", "tenant_admin"]);
    if (event === "submit") await this.notif.notify(tx, ctx.tenantId, await this.notif.clientUsers(tx, ctx.tenantId, mission.companyId), { type: "timesheet.submitted", title: `CRA à valider : ${who}`, link: "/client/timesheets" }, ctx.userId);
    if (event === "approve") { await this.notif.notify(tx, ctx.tenantId, staff, { type: "timesheet.client_approved", title: `CRA approuvé par le client, à valider : ${who}`, link: "/timesheets" }, ctx.userId); await this.notif.notify(tx, ctx.tenantId, consultants, { type: "timesheet.client_approved", title: `Votre CRA ${who} a été approuvé par le client`, link: "/me/timesheets" }, ctx.userId); }
    if (event === "reject") await this.notif.notify(tx, ctx.tenantId, [...consultants, ...staff], { type: "timesheet.client_rejected", title: `CRA refusé par le client : ${who}`, body: reason, link: "/me/timesheets" }, ctx.userId);
    if (event === "validate") await this.notif.notify(tx, ctx.tenantId, consultants, { type: "timesheet.validated", title: `Votre CRA ${who} est validé`, link: "/me/timesheets" }, ctx.userId);
  }

  /** Import CSV (date;quantité) dans un brouillon : mêmes contrôles que la saisie manuelle, tout ou rien. */
  async importCsv(tx: Tx, ctx: RequestContext, missionId: string, period: string, csv: string, scope: Scope) {
    if (!isValidPeriod(period)) throw new BadRequestException("Période invalide (AAAA-MM)");
    const mission = await tx.mission.findUnique({ where: { id: missionId } });
    if (!mission || !this.visible(mission, scope)) throw new NotFoundException();
    const parsed = parseTimesheetCsv(csv, mission.timeUnit as TimeUnit, period);
    if (parsed.errors.length) throw new BadRequestException({ message: "Import refusé : aucune ligne enregistrée.", details: parsed.errors });
    if (!parsed.lines.length) throw new BadRequestException("Fichier vide");
    const view = await this.putLines(tx, ctx, missionId, period, parsed.lines, scope);
    await this.audit.record(tx, ctx, { action: "timesheet.csv_imported", entity: "Timesheet", entityId: view.id, after: { period, rows: parsed.lines.length } });
    return view;
  }

  /** Export CSV : cellules neutralisées contre l'injection de formule. Sans tarif ni salaire. */
  async exportCsv(tx: Tx, ctx: RequestContext, filter: { period?: string; status?: string }, scope: Scope) {
    const rows = await tx.timesheet.findMany({ where: { ...(filter.period ? { period: filter.period } : {}), ...(filter.status ? { status: filter.status } : {}) }, orderBy: [{ period: "desc" }, { createdAt: "desc" }], take: 1000, include: { lines: true, mission: { include: { consultant: true, company: true } } } });
    const out: (string | number)[][] = [["periode", "consultant", "client", "mission", "unite", "total", "statut", "jours_saisis"]];
    for (const t of rows.filter(r => this.visible(r.mission, scope))) {
      const total = t.lines.reduce((a, l) => a.plus(l.quantity.toString()), new Decimal(0));
      out.push([t.period, `${t.mission.consultant.firstName} ${t.mission.consultant.lastName}`, t.mission.company.name, t.mission.title, t.mission.timeUnit, total.toString(), t.status, t.lines.length]);
    }
    await this.audit.record(tx, ctx, { action: "timesheet.csv_exported", entity: "Timesheet", entityId: "export", after: { rows: out.length - 1, ...filter } });
    return toCsv(out);
  }

  /** Relance les consultants dont le CRA du mois est absent ou encore en brouillon. Une relance par mission, période et jour (idempotent). */
  async remind(tx: Tx, ctx: RequestContext, period: string) {
    if (!isValidPeriod(period)) throw new BadRequestException("Période invalide (AAAA-MM)");
    const first = `${period}-01`, last = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const missions = await tx.mission.findMany({ where: { status: "active", startDate: { lte: new Date(last) }, OR: [{ endDate: null }, { endDate: { gte: new Date(first) } }] }, include: { timesheets: { where: { period }, select: { status: true } } } });
    const todo = missions.filter(m => m.timesheets.length === 0 || m.timesheets[0]!.status === "draft");
    const day = new Date().toISOString().slice(0, 10);
    let sent = 0, skipped = 0;
    for (const m of todo) {
      const r = await tx.timesheetReminder.createMany({ data: [{ tenantId: ctx.tenantId, missionId: m.id, period, day }], skipDuplicates: true });
      if (r.count === 0) { skipped++; continue; }
      await this.notif.notify(tx, ctx.tenantId, await this.notif.consultantUsers(tx, ctx.tenantId, m.consultantId), { type: "timesheet.reminder", title: `CRA ${period} à saisir et soumettre : ${m.title}`, link: "/me/timesheets" }, ctx.userId);
      sent++;
    }
    await this.audit.record(tx, ctx, { action: "timesheet.reminders_sent", entity: "Timesheet", entityId: period, after: { period, sent, skipped } });
    return { period, concerned: todo.length, sent, alreadyRemindedToday: skipped, channel: "notification interne (e-mail non utilisé pour les relances)" };
  }
}
