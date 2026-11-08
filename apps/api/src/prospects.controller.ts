import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { PROSPECT_STAGES, ProspectStage, prospectPipeline } from "@portage/domain";
import { PrismaService } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext, RequirePermission } from "./auth.guard";
import { ROLES } from "./permissions";

const Create = z.object({
  kind: z.enum(["consultant", "company"]), name: z.string().min(1).max(200),
  email: z.string().email().max(254).optional(), phone: z.string().min(5).max(30).optional(), source: z.string().max(100).optional(),
});
const Update = Create.omit({ kind: true }).partial().refine(v => Object.keys(v).length > 0, "Aucun champ");
const Transition = z.object({ event: z.enum(["contact", "qualify", "convert", "lose", "reopen"]), lostReason: z.string().min(3).max(500).optional() });
type R = { ctx: RequestContext };
function parse<T>(s: z.ZodType<T>, b: unknown): T {
  const r = s.safeParse(b);
  if (!r.success) throw new BadRequestException(r.error.issues.map(i => i.message).join("; "));
  return r.data;
}

@Controller("prospects")
export class ProspectsController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get() @RequirePermission("prospect.read")
  list(@Req() { ctx }: R, @Query("stage") stage?: string) {
    if (stage && !(PROSPECT_STAGES as readonly string[]).includes(stage)) throw new BadRequestException("Étape inconnue");
    return this.prisma.forTenant(ctx.tenantId, tx => tx.prospect.findMany({ where: stage ? { stage } : {}, orderBy: { createdAt: "desc" }, take: 200 }));
  }

  @Post() @RequirePermission("prospect.write")
  create(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parse(Create, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const p = await tx.prospect.create({ data: { ...d, tenantId: ctx.tenantId } });
      await this.audit.record(tx, ctx, { action: "prospect.create", entity: "Prospect", entityId: p.id, after: p });
      return p;
    });
  }

  @Patch(":id") @RequirePermission("prospect.write")
  update(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parse(Update, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const before = await tx.prospect.findUnique({ where: { id } });
      if (!before) throw new NotFoundException();
      const after = await tx.prospect.update({ where: { id }, data: d });
      await this.audit.record(tx, ctx, { action: "prospect.update", entity: "Prospect", entityId: id, before, after });
      return after;
    });
  }

  /** Transition d'étape: acteur, préconditions et audit imposés par la machine d'état du domaine. */
  @Post(":id/transition") @RequirePermission("prospect.write")
  transition(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parse(Transition, body);
    // Un utilisateur multi-rôles: on retient un rôle autorisé par la machine, sinon on refuse.
    const role = ctx.roles.find(r => (ROLES as readonly string[]).includes(r) && ["tenant_admin", "commerce"].includes(r));
    if (!role) throw new ForbiddenException("Rôle non autorisé pour cette transition");
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const before = await tx.prospect.findUnique({ where: { id } });
      if (!before) throw new NotFoundException();
      let next: ProspectStage;
      try {
        next = prospectPipeline.apply(before.stage as ProspectStage, d.event, { id: ctx.userId, role },
          { kind: before.kind as "consultant" | "company", hasContact: !!(before.email || before.phone), lostReason: d.lostReason }).state;
      } catch (e) { throw new BadRequestException((e as Error).message); }
      // Concurrence optimiste: la mise à jour n'a lieu que si l'étape n'a pas changé entre-temps.
      const r = await tx.prospect.updateMany({ where: { id, stage: before.stage }, data: { stage: next, lostReason: next === "lost" ? d.lostReason : null } });
      if (r.count !== 1) throw new ConflictException("Le prospect a été modifié entre-temps, rechargez.");
      const after = await tx.prospect.findUniqueOrThrow({ where: { id } });
      await this.audit.record(tx, ctx, { action: `prospect.${d.event}`, entity: "Prospect", entityId: id, before: { stage: before.stage }, after: { stage: next } });
      return after;
    });
  }
}
