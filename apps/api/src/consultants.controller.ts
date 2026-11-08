import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext, RequirePermission } from "./auth.guard";
import { ConsultantsService } from "./consultants.service";
import { parseZod } from "./workflow";

const Create = z.object({ firstName: z.string().min(1).max(100), lastName: z.string().min(1).max(100), email: z.string().email().max(254).optional() });
const Complete = z.object({ done: z.boolean() });
type R = { ctx: RequestContext };

@Controller("consultants")
export class ConsultantsController {
  constructor(private prisma: PrismaService, private audit: AuditService, private svc: ConsultantsService) {}

  @Get() @RequirePermission("consultant.read")
  list(@Req() { ctx }: R) {
    return this.prisma.forTenant(ctx.tenantId, tx => tx.consultant.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { tasks: { select: { required: true, doneAt: true } } } })
      .then(rows => rows.map(({ tasks, ...c }) => ({ ...c, tasksDone: tasks.filter(t => t.doneAt).length, tasksTotal: tasks.length }))));
  }

  @Get(":id") @RequirePermission("consultant.read")
  async get(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) {
    const c = await this.prisma.forTenant(ctx.tenantId, tx => tx.consultant.findUnique({ where: { id }, include: { tasks: { orderBy: { key: "asc" } } } }));
    if (!c) throw new NotFoundException();
    return c;
  }

  @Post() @RequirePermission("consultant.write")
  create(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parseZod(Create, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const c = await this.svc.create(tx, ctx.tenantId, d);
      await this.audit.record(tx, ctx, { action: "consultant.create", entity: "Consultant", entityId: c.id, after: { id: c.id, status: c.status } });
      return c;
    });
  }

  @Post(":id/tasks/:key") @RequirePermission("consultant.write")
  complete(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Param("key") key: string, @Body() body: unknown) {
    const { done } = parseZod(Complete, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const t = await tx.onboardingTask.findUnique({ where: { consultantId_key: { consultantId: id, key } } });
      if (!t) throw new NotFoundException();
      const c = await tx.consultant.findUniqueOrThrow({ where: { id } });
      if (c.status === "archived") throw new BadRequestException("Dossier archivé");
      const after = await tx.onboardingTask.update({ where: { id: t.id }, data: { doneAt: done ? new Date() : null, doneBy: done ? ctx.userId : null } });
      await this.audit.record(tx, ctx, { action: done ? "onboarding.task_done" : "onboarding.task_undone", entity: "OnboardingTask", entityId: t.id, before: { done: !!t.doneAt }, after: { done } });
      return after;
    });
  }

  /** Activation: toutes les tâches requises doivent être cochées (aucune vérification externe n'est faite). */
  @Post(":id/activate") @RequirePermission("consultant.write")
  activate(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) {
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const c = await tx.consultant.findUnique({ where: { id }, include: { tasks: true } });
      if (!c) throw new NotFoundException();
      if (c.status !== "onboarding") throw new ConflictException(`Dossier déjà ${c.status}`);
      const missing = c.tasks.filter(t => t.required && !t.doneAt).map(t => t.label);
      if (missing.length) throw new BadRequestException(`Onboarding incomplet : ${missing.join(", ")}`);
      const r = await tx.consultant.updateMany({ where: { id, status: "onboarding" }, data: { status: "active" } });
      if (r.count !== 1) throw new ConflictException("Dossier modifié entre-temps");
      await this.audit.record(tx, ctx, { action: "consultant.activate", entity: "Consultant", entityId: id, before: { status: "onboarding" }, after: { status: "active" } });
      return tx.consultant.findUniqueOrThrow({ where: { id } });
    });
  }
}
