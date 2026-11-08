import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATES, TicketState, ticketWorkflow } from "@portage/domain";
import { PrismaService, Tx } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext, RequirePermission } from "./auth.guard";
import { NotificationsService } from "./notifications.service";
import { can, rolesWith } from "./permissions";
import { applyAsAnyRole, parseZod } from "./workflow";

const Create = z.object({ subject: z.string().min(3).max(200), category: z.enum(TICKET_CATEGORIES), priority: z.enum(TICKET_PRIORITIES).optional(), body: z.string().min(1).max(5000) });
const Msg = z.object({ body: z.string().min(1).max(5000), internal: z.boolean().optional() });
const Trans = z.object({ event: z.enum(["resolve", "close"]) });
const Assign = z.object({ userId: z.string().uuid().nullable() });
const Tpl = z.object({ name: z.string().min(2).max(80), body: z.string().min(1).max(5000) });
type R = { ctx: RequestContext };

@Controller("support")
export class SupportController {
  constructor(private prisma: PrismaService, private audit: AuditService, private notif: NotificationsService) {}

  private staff(ctx: RequestContext) { return can(ctx.roles, "support.manage"); }
  private pseudoRoles(ctx: RequestContext, requester: string) { const r: string[] = []; if (ctx.userId === requester) r.push("requester"); if (this.staff(ctx)) r.push("staff"); return r; }

  /** Visibilité : le demandeur voit ses tickets, le personnel du support voit ceux du tenant ; sinon 404 (pas de fuite d'existence). */
  private async load(tx: Tx, ctx: RequestContext, id: string) {
    const t = await tx.supportTicket.findUnique({ where: { id } });
    if (!t || (t.requesterUserId !== ctx.userId && !this.staff(ctx))) throw new NotFoundException();
    return t;
  }
  private async view(tx: Tx, ctx: RequestContext, id: string) {
    const t = await this.load(tx, ctx, id);
    const msgs = await tx.supportMessage.findMany({ where: { ticketId: id, ...(this.staff(ctx) ? {} : { internal: false }) }, orderBy: { createdAt: "asc" } });
    const users = await tx.user.findMany({ where: { id: { in: [...new Set([...msgs.map(m => m.authorUserId), t.requesterUserId])] } }, select: { id: true, email: true } });
    const mail = new Map(users.map(u => [u.id, u.email]));
    return { id: t.id, subject: t.subject, category: t.category, priority: t.priority, status: t.status, assigneeUserId: this.staff(ctx) ? t.assigneeUserId : undefined, requester: mail.get(t.requesterUserId), createdAt: t.createdAt, updatedAt: t.updatedAt,
      messages: msgs.map(m => ({ id: m.id, author: mail.get(m.authorUserId), mine: m.authorUserId === ctx.userId, body: m.body, internal: m.internal, createdAt: m.createdAt })) };
  }
  private staffIds(tx: Tx, tenantId: string) { return this.notif.usersByRoles(tx, tenantId, rolesWith("support.manage")); }

  @Get("tickets")
  list(@Req() { ctx }: R, @Query("status") status?: string, @Query("q") q?: string, @Query("mine") mine?: string) {
    if (status && !(TICKET_STATES as readonly string[]).includes(status)) throw new BadRequestException("Statut inconnu");
    if (q && q.length > 100) throw new BadRequestException("Recherche trop longue");
    const onlyMine = mine === "1" || !this.staff(ctx);
    return this.prisma.forTenant(ctx.tenantId, tx => tx.supportTicket.findMany({
      where: { ...(onlyMine ? { requesterUserId: ctx.userId } : {}), ...(status ? { status } : {}), ...(q ? { subject: { contains: q, mode: "insensitive" } } : {}) },
      orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, subject: true, category: true, priority: true, status: true, requesterUserId: true, assigneeUserId: true, updatedAt: true } }));
  }

  @Post("tickets")
  create(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parseZod(Create, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const t = await tx.supportTicket.create({ data: { tenantId: ctx.tenantId, requesterUserId: ctx.userId, subject: d.subject.trim(), category: d.category, priority: d.priority ?? "normal" } });
      await tx.supportMessage.create({ data: { tenantId: ctx.tenantId, ticketId: t.id, authorUserId: ctx.userId, body: d.body } });
      await this.notif.notify(tx, ctx.tenantId, await this.staffIds(tx, ctx.tenantId), { type: "support.ticket_created", title: `Nouvelle demande : ${t.subject}`, link: `/support/${t.id}` }, ctx.userId);
      await this.audit.record(tx, ctx, { action: "support.ticket_create", entity: "SupportTicket", entityId: t.id, after: { category: d.category, priority: t.priority } });
      return this.view(tx, ctx, t.id);
    });
  }

  @Get("tickets/:id")
  get(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) { return this.prisma.forTenant(ctx.tenantId, tx => this.view(tx, ctx, id)); }

  @Post("tickets/:id/messages")
  reply(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parseZod(Msg, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const t = await this.load(tx, ctx, id);
      const staff = this.staff(ctx), isRequester = ctx.userId === t.requesterUserId;
      if (d.internal && !staff) throw new ForbiddenException("Les notes internes sont réservées au personnel du support");
      if (t.status === "closed") throw new ConflictException("Ticket clos : ouvrez une nouvelle demande");
      let next = t.status as TicketState;
      if (!d.internal) next = applyAsAnyRole(ticketWorkflow, t.status as TicketState, staff ? "staff_reply" : "requester_reply", ctx.userId, staff ? ["staff"] : isRequester ? ["requester"] : [], {} as Record<string, never>);
      await tx.supportMessage.create({ data: { tenantId: ctx.tenantId, ticketId: id, authorUserId: ctx.userId, body: d.body, internal: !!d.internal } });
      const r = await tx.supportTicket.updateMany({ where: { id, status: t.status }, data: { status: next } });
      if (r.count !== 1) throw new ConflictException("Ticket modifié entre-temps");
      if (!d.internal) {
        const to = staff && !isRequester ? [t.requesterUserId] : t.assigneeUserId ? [t.assigneeUserId] : await this.staffIds(tx, ctx.tenantId);
        await this.notif.notify(tx, ctx.tenantId, to, { type: "support.reply", title: `Réponse sur : ${t.subject}`, link: `/support/${id}` }, ctx.userId);
      }
      await this.audit.record(tx, ctx, { action: d.internal ? "support.internal_note" : "support.reply", entity: "SupportTicket", entityId: id, before: { status: t.status }, after: { status: next } });
      return this.view(tx, ctx, id);
    });
  }

  @Post("tickets/:id/transition")
  transition(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parseZod(Trans, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const t = await this.load(tx, ctx, id);
      const next = applyAsAnyRole(ticketWorkflow, t.status as TicketState, d.event, ctx.userId, this.pseudoRoles(ctx, t.requesterUserId), {} as Record<string, never>);
      const r = await tx.supportTicket.updateMany({ where: { id, status: t.status }, data: { status: next, ...(next === "closed" ? { closedAt: new Date() } : {}) } });
      if (r.count !== 1) throw new ConflictException("Ticket modifié entre-temps");
      if (ctx.userId !== t.requesterUserId) await this.notif.notify(tx, ctx.tenantId, [t.requesterUserId], { type: "support.reply", title: `Votre demande est ${next === "resolved" ? "résolue" : "close"} : ${t.subject}`, link: `/support/${id}` });
      await this.audit.record(tx, ctx, { action: `support.${d.event}`, entity: "SupportTicket", entityId: id, before: { status: t.status }, after: { status: next } });
      return this.view(tx, ctx, id);
    });
  }

  @Post("tickets/:id/assign") @RequirePermission("support.manage")
  assign(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parseZod(Assign, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const t = await this.load(tx, ctx, id);
      if (d.userId && !(await this.staffIds(tx, ctx.tenantId)).includes(d.userId)) throw new BadRequestException("L'assigné doit être membre du support");
      await tx.supportTicket.update({ where: { id }, data: { assigneeUserId: d.userId } });
      await this.audit.record(tx, ctx, { action: "support.assign", entity: "SupportTicket", entityId: id, before: { assignee: t.assigneeUserId }, after: { assignee: d.userId } });
      return this.view(tx, ctx, id);
    });
  }

  @Get("staff") @RequirePermission("support.manage")
  staffList(@Req() { ctx }: R) {
    return this.prisma.forTenant(ctx.tenantId, async tx => { const ids = await this.staffIds(tx, ctx.tenantId); return tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }); });
  }

  @Get("templates") @RequirePermission("support.manage")
  templates(@Req() { ctx }: R) { return this.prisma.forTenant(ctx.tenantId, tx => tx.messageTemplate.findMany({ orderBy: { name: "asc" } })); }

  @Post("templates") @RequirePermission("support.manage")
  createTemplate(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parseZod(Tpl, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      if (await tx.messageTemplate.findUnique({ where: { tenantId_name: { tenantId: ctx.tenantId, name: d.name } } })) throw new ConflictException("Nom de modèle déjà utilisé");
      const m = await tx.messageTemplate.create({ data: { tenantId: ctx.tenantId, name: d.name, body: d.body, createdBy: ctx.userId } });
      await this.audit.record(tx, ctx, { action: "support.template_create", entity: "MessageTemplate", entityId: m.id, after: { name: d.name } });
      return m;
    });
  }
}
