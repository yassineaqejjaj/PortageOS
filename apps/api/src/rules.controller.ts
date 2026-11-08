import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext, RequirePermission } from "./auth.guard";
import { ParametersService } from "./parameters.service";
import { parseZod } from "./workflow";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date AAAA-MM-JJ");
const Create = z.object({
  key: z.string().regex(/^[a-z0-9_.]{3,80}$/, "Clé : a-z 0-9 _ ."), value: z.string().min(1).max(100), unit: z.string().min(1).max(30),
  validFrom: date, validTo: date.optional(), source: z.string().min(10, "Source officielle obligatoire (référence ou URL)").max(500), justification: z.string().max(1000).optional(),
}).refine(v => !v.validTo || v.validTo >= v.validFrom, "Fin avant début");
type R = { ctx: RequestContext };

@Controller("rules/parameters")
export class RulesController {
  constructor(private prisma: PrismaService, private audit: AuditService, private params: ParametersService) {}

  @Get() @RequirePermission("rules.read")
  list(@Req() { ctx }: R) { return this.prisma.forTenant(ctx.tenantId, tx => tx.ruleParameter.findMany({ orderBy: [{ key: "asc" }, { validFrom: "desc" }], take: 500 })); }

  @Get("at") @RequirePermission("rules.read")
  async at(@Req() { ctx }: R, @Query("key") key: string, @Query("date") d: string) {
    if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(d ?? "")) throw new BadRequestException("key et date (AAAA-MM-JJ) requis");
    const p = await this.prisma.forTenant(ctx.tenantId, tx => this.params.at(tx, key, d));
    if (!p) throw new NotFoundException("Aucun paramètre approuvé à cette date");
    return p;
  }

  @Post() @RequirePermission("rules.write")
  create(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parseZod(Create, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const p = await tx.ruleParameter.create({ data: { tenantId: ctx.tenantId, key: d.key, value: d.value, unit: d.unit, validFrom: new Date(d.validFrom), validTo: d.validTo ? new Date(d.validTo) : null, source: d.source, justification: d.justification, createdBy: ctx.userId } });
      await this.audit.record(tx, ctx, { action: "rules.parameter_draft", entity: "RuleParameter", entityId: p.id, after: { key: d.key, value: d.value, validFrom: d.validFrom, source: d.source } });
      return p;
    });
  }

  /** Approbation à quatre yeux : l'approbateur doit être différent de l'auteur; aucun chevauchement de périodes approuvées. */
  @Post(":id/approve") @RequirePermission("rules.approve")
  approve(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) {
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const p = await tx.ruleParameter.findUnique({ where: { id } });
      if (!p) throw new NotFoundException();
      if (p.status !== "draft") throw new ConflictException("Déjà approuvé");
      if (p.createdBy === ctx.userId) throw new ForbiddenException("Approbation à quatre yeux : l'auteur ne peut pas approuver sa propre version");
      const others = await tx.ruleParameter.findMany({ where: { key: p.key, status: "approved" } });
      const s1 = p.validFrom.toISOString().slice(0, 10), e1 = p.validTo?.toISOString().slice(0, 10) ?? "9999-12-31";
      if (others.some(o => o.validFrom.toISOString().slice(0, 10) <= e1 && s1 <= (o.validTo?.toISOString().slice(0, 10) ?? "9999-12-31"))) throw new ConflictException("Chevauchement avec une version approuvée");
      const r = await tx.ruleParameter.updateMany({ where: { id, status: "draft" }, data: { status: "approved", approvedBy: ctx.userId, approvedAt: new Date() } });
      if (r.count !== 1) throw new ConflictException("Modifié entre-temps");
      await this.audit.record(tx, ctx, { action: "rules.parameter_approved", entity: "RuleParameter", entityId: id, before: { status: "draft" }, after: { status: "approved", key: p.key, value: p.value } });
      return tx.ruleParameter.findUniqueOrThrow({ where: { id } });
    });
  }
}
