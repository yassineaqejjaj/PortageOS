import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { ContractState, contractWorkflow, declaredVariables, renderTemplate } from "@portage/domain";
import { PrismaService } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext, RequirePermission } from "./auth.guard";
import { applyAsAnyRole, parseZod } from "./workflow";

const KINDS = ["employment_cdi", "employment_cdd", "service", "framework"] as const;
const TemplateDto = z.object({ kind: z.enum(KINDS), name: z.string().min(2).max(120), body: z.string().min(10).max(20000) });
const ContractDto = z.object({ templateId: z.string().uuid(), consultantId: z.string().uuid().optional(), companyId: z.string().uuid().optional(), variables: z.record(z.string().max(500)).default({}) });
const Trans = z.object({ event: z.enum(["send", "sign", "cancel"]), signatureDeclaration: z.string().max(500).optional() });
type R = { ctx: RequestContext };

@Controller()
export class ContractsController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get("contract-templates") @RequirePermission("contract.read")
  templates(@Req() { ctx }: R) { return this.prisma.forTenant(ctx.tenantId, tx => tx.contractTemplate.findMany({ orderBy: [{ name: "asc" }, { version: "desc" }], take: 200 })); }

  /** Nouvelle version d'un modèle (même nom => version + 1). Le texte juridique est fourni par le cabinet : aucun contenu légal n'est généré par la plateforme. */
  @Post("contract-templates") @RequirePermission("contract.write")
  createTemplate(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parseZod(TemplateDto, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const last = await tx.contractTemplate.findFirst({ where: { name: d.name }, orderBy: { version: "desc" } });
      const t = await tx.contractTemplate.create({ data: { tenantId: ctx.tenantId, kind: d.kind, name: d.name, version: (last?.version ?? 0) + 1, body: d.body, variables: declaredVariables(d.body), createdBy: ctx.userId } });
      await this.audit.record(tx, ctx, { action: "contract.template_create", entity: "ContractTemplate", entityId: t.id, after: { name: t.name, version: t.version, kind: t.kind } });
      return t;
    });
  }

  @Post("contract-templates/:id/publish") @RequirePermission("contract.write")
  publish(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) {
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const t = await tx.contractTemplate.findUnique({ where: { id } });
      if (!t) throw new NotFoundException();
      if (t.status !== "draft") throw new ConflictException("Déjà publié (immuable)");
      const r = await tx.contractTemplate.updateMany({ where: { id, status: "draft" }, data: { status: "published" } });
      if (r.count !== 1) throw new ConflictException("Modifié entre-temps");
      await this.audit.record(tx, ctx, { action: "contract.template_publish", entity: "ContractTemplate", entityId: id, after: { name: t.name, version: t.version } });
      return tx.contractTemplate.findUniqueOrThrow({ where: { id } });
    });
  }

  @Get("contracts") @RequirePermission("contract.read")
  list(@Req() { ctx }: R) { return this.prisma.forTenant(ctx.tenantId, tx => tx.contract.findMany({ orderBy: { createdAt: "desc" }, take: 200, select: { id: true, kind: true, status: true, consultantId: true, companyId: true, signedAt: true, signatureProvider: true, createdAt: true, template: { select: { name: true, version: true } } } })); }

  @Get("contracts/:id") @RequirePermission("contract.read")
  async get(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) {
    const c = await this.prisma.forTenant(ctx.tenantId, tx => tx.contract.findUnique({ where: { id }, include: { template: { select: { name: true, version: true } } } }));
    if (!c) throw new NotFoundException();
    return c;
  }

  @Post("contracts") @RequirePermission("contract.write")
  create(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parseZod(ContractDto, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const t = await tx.contractTemplate.findUnique({ where: { id: d.templateId } });
      if (!t) throw new BadRequestException("Modèle introuvable");
      if (t.status !== "published") throw new BadRequestException("Le modèle doit être publié");
      const employment = t.kind.startsWith("employment");
      if (employment && !d.consultantId) throw new BadRequestException("Un contrat de travail exige un consultant");
      if (!employment && !d.companyId) throw new BadRequestException("Ce contrat exige une entreprise cliente");
      if (d.consultantId && !(await tx.consultant.findUnique({ where: { id: d.consultantId } }))) throw new BadRequestException("Consultant introuvable");
      if (d.companyId && !(await tx.company.findUnique({ where: { id: d.companyId } }))) throw new BadRequestException("Entreprise introuvable");
      let rendered: string;
      try { rendered = renderTemplate(t.body, d.variables); } catch (e) { throw new BadRequestException((e as Error).message); }
      const c = await tx.contract.create({ data: { tenantId: ctx.tenantId, templateId: t.id, kind: t.kind, consultantId: d.consultantId, companyId: d.companyId, renderedBody: rendered, variableValues: d.variables, createdBy: ctx.userId } });
      await this.audit.record(tx, ctx, { action: "contract.create", entity: "Contract", entityId: c.id, after: { template: `${t.name} v${t.version}`, kind: t.kind } });
      return c;
    });
  }

  /** La signature est une DÉCLARATION interne tracée (provider « none ») : aucune signature électronique qualifiée n'est connectée. */
  @Post("contracts/:id/transition") @RequirePermission("contract.write")
  transition(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parseZod(Trans, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const c = await tx.contract.findUnique({ where: { id } });
      if (!c) throw new NotFoundException();
      const next = applyAsAnyRole(contractWorkflow, c.status as ContractState, d.event, ctx.userId, ctx.roles, { signatureDeclaration: d.signatureDeclaration });
      const data: Record<string, unknown> = { status: next };
      if (d.event === "send") data.sentAt = new Date();
      if (d.event === "sign") { data.signedAt = new Date(); data.signatureEvidence = `declared_by:${ctx.userId}|${d.signatureDeclaration!.trim()}`; }
      const r = await tx.contract.updateMany({ where: { id, status: c.status }, data });
      if (r.count !== 1) throw new ConflictException("Contrat modifié entre-temps");
      if (d.event === "sign" && c.kind.startsWith("employment") && c.consultantId) {
        await tx.onboardingTask.updateMany({ where: { consultantId: c.consultantId, key: "employment_contract_signed", doneAt: null }, data: { doneAt: new Date(), doneBy: ctx.userId } });
      }
      await this.audit.record(tx, ctx, { action: `contract.${d.event}`, entity: "Contract", entityId: id, before: { status: c.status }, after: { status: next, provider: "none" } });
      return tx.contract.findUniqueOrThrow({ where: { id } });
    });
  }
}
