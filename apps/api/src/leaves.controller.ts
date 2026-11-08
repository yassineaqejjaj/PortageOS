import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import Decimal from "decimal.js";
import { z } from "zod";
import { LEAVE_TYPES, LeaveState, leaveWorkflow, totalDays } from "@portage/domain";
import { PrismaService, Tx } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext, RequirePermission } from "./auth.guard";
import { LeavesService } from "./leaves.service";
import { NotificationsService } from "./notifications.service";
import { applyAsAnyRole, parisToday, parseZod } from "./workflow";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date AAAA-MM-JJ");
const Create = z.object({ type: z.enum(LEAVE_TYPES), startDate: date, endDate: date, halfStart: z.boolean().optional(), halfEnd: z.boolean().optional(), reason: z.string().max(500).optional() });
const Trans = z.object({ event: z.enum(["approve", "reject", "cancel"]), rejectReason: z.string().max(500).optional() });
const Adjust = z.object({ consultantId: z.string().uuid(), days: z.string().regex(/^-?\d{1,3}(\.\d)?$/, "Jours : nombre à 1 décimale"), reason: z.string().min(5, "Motif obligatoire (5 caractères min.)").max(500) });
type R = { ctx: RequestContext };

type Row = { id: string; consultantId: string; type: string; startDate: Date; endDate: Date; halfStart: boolean; halfEnd: boolean; days: unknown; status: string; reason: string | null; rejectReason: string | null; holidaysConfigured: boolean };
const view = (r: Row, name?: string) => ({ id: r.id, consultantId: r.consultantId, consultant: name, type: r.type, startDate: r.startDate.toISOString().slice(0, 10), endDate: r.endDate.toISOString().slice(0, 10), halfStart: r.halfStart, halfEnd: r.halfEnd,
  days: String(r.days), status: r.status, reason: r.reason, rejectReason: r.rejectReason, holidaysConfigured: r.holidaysConfigured });

@Controller()
export class LeavesController {
  constructor(private prisma: PrismaService, private audit: AuditService, private svc: LeavesService, private notif: NotificationsService) {}

  private selfId(ctx: RequestContext) { if (!ctx.consultantId) throw new ForbiddenException("Compte non rattaché à un dossier consultant"); return ctx.consultantId; }

  private async transition(tx: Tx, ctx: RequestContext, id: string, event: string, reason: string | undefined, scopeConsultant?: string) {
    const r = await tx.leaveRequest.findUnique({ where: { id } });
    if (!r || (scopeConsultant && r.consultantId !== scopeConsultant)) throw new NotFoundException();
    const consumes = this.svc.consumes(r.type);
    const balanceAfter = event === "approve" && consumes ? new Decimal(await this.svc.balance(tx, r.consultantId, r.id)).minus(r.days.toString()).toFixed(1) : undefined;
    const next = applyAsAnyRole(leaveWorkflow, r.status as LeaveState, event, ctx.userId, ctx.roles,
      { ownerUserId: r.ownerUserId, actorUserId: ctx.userId, rejectReason: reason, startsInFuture: r.startDate.toISOString().slice(0, 10) > parisToday(), balanceAfter, consumes });
    const data: Record<string, unknown> = { status: next };
    if (["approve", "reject"].includes(event)) { data.decidedBy = ctx.userId; data.decidedAt = new Date(); }
    data.rejectReason = event === "reject" ? reason!.trim() : null;
    const u = await tx.leaveRequest.updateMany({ where: { id, status: r.status }, data });
    if (u.count !== 1) throw new ConflictException("Demande modifiée entre-temps");
    await this.audit.record(tx, ctx, { action: `leave.${event}`, entity: "LeaveRequest", entityId: id, before: { status: r.status }, after: { status: next, days: r.days.toString(), type: r.type, reason: data.rejectReason } });
    if (["approve", "reject"].includes(event)) await this.notif.notify(tx, ctx.tenantId, [r.ownerUserId], { type: "leave.decided", title: `Demande d'absence ${event === "approve" ? "approuvée" : "refusée"} (${r.startDate.toISOString().slice(0, 10)})`, body: data.rejectReason as string | undefined ?? undefined, link: "/me/leaves" }, ctx.userId);
    return view(await tx.leaveRequest.findUniqueOrThrow({ where: { id } }));
  }

  // ----- portail consultant -----
  @Get("me/leaves") @RequirePermission("portal.self")
  mine(@Req() { ctx }: R) { const cid = this.selfId(ctx); return this.prisma.forTenant(ctx.tenantId, async tx => (await tx.leaveRequest.findMany({ where: { consultantId: cid }, orderBy: { startDate: "desc" }, take: 100 })).map(r => view(r))); }

  @Get("me/leave-balance") @RequirePermission("portal.self")
  myBalance(@Req() { ctx }: R) { const cid = this.selfId(ctx); return this.prisma.forTenant(ctx.tenantId, async tx => ({ paidLeaveDays: await this.svc.balance(tx, cid) })); }

  @Post("me/leaves") @RequirePermission("portal.self")
  create(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parseZod(Create, body); const cid = this.selfId(ctx);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      let calc; try { calc = await this.svc.compute(tx, { start: d.startDate, end: d.endDate, halfStart: d.halfStart, halfEnd: d.halfEnd }); } catch (e) { throw new BadRequestException((e as Error).message); }
      const days = totalDays(calc.days);
      if (days.lte(0)) throw new BadRequestException("Aucun jour ouvré sur cette période");
      const overlap = await tx.leaveRequest.findFirst({ where: { consultantId: cid, status: { in: ["submitted", "approved"] }, startDate: { lte: new Date(d.endDate) }, endDate: { gte: new Date(d.startDate) } } });
      if (overlap) throw new ConflictException("Une demande en cours ou approuvée couvre déjà tout ou partie de cette période");
      const r = await tx.leaveRequest.create({ data: { tenantId: ctx.tenantId, consultantId: cid, ownerUserId: ctx.userId, type: d.type, startDate: new Date(d.startDate), endDate: new Date(d.endDate), halfStart: d.halfStart ?? false, halfEnd: d.halfEnd ?? false, days: days.toFixed(1), holidaysConfigured: calc.configured, reason: d.reason } });
      await this.audit.record(tx, ctx, { action: "leave.submit", entity: "LeaveRequest", entityId: r.id, after: { type: d.type, start: d.startDate, end: d.endDate, days: days.toFixed(1), holidaysConfigured: calc.configured } });
      await this.notif.notify(tx, ctx.tenantId, await this.notif.usersByRoles(tx, ctx.tenantId, ["hr", "operations", "tenant_admin"]), { type: "leave.submitted", title: `Demande d'absence à traiter (${d.startDate} → ${d.endDate})`, link: "/leaves" }, ctx.userId);
      return view(r);
    });
  }

  @Post("me/leaves/:id/cancel") @RequirePermission("portal.self")
  cancelMine(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) { const cid = this.selfId(ctx); return this.prisma.forTenant(ctx.tenantId, tx => this.transition(tx, ctx, id, "cancel", undefined, cid)); }

  // ----- gestion interne -----
  @Get("leaves") @RequirePermission("leave.read")
  list(@Req() { ctx }: R) {
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const rows = await tx.leaveRequest.findMany({ orderBy: { startDate: "desc" }, take: 200 });
      const cons = await tx.consultant.findMany({ where: { id: { in: [...new Set(rows.map(r => r.consultantId))] } } });
      const name = new Map(cons.map(c => [c.id, `${c.firstName} ${c.lastName}`]));
      return rows.map(r => view(r, name.get(r.consultantId)));
    });
  }

  @Post("leaves/:id/transition") @RequirePermission("leave.write")
  move(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parseZod(Trans, body);
    return this.prisma.forTenant(ctx.tenantId, tx => this.transition(tx, ctx, id, d.event, d.rejectReason));
  }

  @Get("leave-balances/:consultantId") @RequirePermission("leave.read")
  balance(@Req() { ctx }: R, @Param("consultantId", ParseUUIDPipe) cid: string) {
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      if (!(await tx.consultant.findUnique({ where: { id: cid } }))) throw new NotFoundException();
      return { consultantId: cid, paidLeaveDays: await this.svc.balance(tx, cid), adjustments: (await tx.leaveAdjustment.findMany({ where: { consultantId: cid }, orderBy: { createdAt: "desc" } })).map(a => ({ days: a.days.toString(), reason: a.reason, createdAt: a.createdAt })) };
    });
  }

  @Post("leave-adjustments") @RequirePermission("leave.adjust")
  adjust(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parseZod(Adjust, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      if (!(await tx.consultant.findUnique({ where: { id: d.consultantId } }))) throw new BadRequestException("Consultant introuvable");
      const a = await tx.leaveAdjustment.create({ data: { tenantId: ctx.tenantId, consultantId: d.consultantId, days: d.days, reason: d.reason, createdBy: ctx.userId } });
      await this.audit.record(tx, ctx, { action: "leave.adjust", entity: "LeaveAdjustment", entityId: a.id, after: { consultantId: d.consultantId, days: d.days, reason: d.reason } });
      return { id: a.id, paidLeaveDays: await this.svc.balance(tx, d.consultantId) };
    });
  }
}
