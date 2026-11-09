import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext, RequirePermission } from "./auth.guard";
import { parseZod } from "./workflow";

const money = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "Montant invalide (2 décimales max)");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date AAAA-MM-JJ");
const Create = z.object({
  consultantId: z.string().uuid(), companyId: z.string().uuid(), title: z.string().min(1).max(200),
  dailyRate: money.refine(v => Number(v) > 0, "TJM > 0"),
  vatRate: z.string().regex(/^\d{1,2}(\.\d{1,2})?$|^100$/, "Taux de TVA invalide"),
  startDate: date, endDate: date.optional(), agreementId: z.string().uuid().optional(), agreementRateId: z.string().uuid().optional(),
}).refine(v => !v.endDate || v.endDate >= v.startDate, "La fin précède le début");
type R = { ctx: RequestContext };

@Controller("missions")
export class MissionsController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get() @RequirePermission("mission.read")
  list(@Req() { ctx }: R) {
    return this.prisma.forTenant(ctx.tenantId, tx => tx.mission.findMany({ orderBy: { createdAt: "desc" }, take: 200,
      include: { consultant: { select: { firstName: true, lastName: true } }, company: { select: { name: true } } } }));
  }

  @Get(":id") @RequirePermission("mission.read")
  async get(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) {
    const m = await this.prisma.forTenant(ctx.tenantId, tx => tx.mission.findUnique({ where: { id } }));
    if (!m) throw new NotFoundException();
    return m;
  }

  @Post() @RequirePermission("mission.write")
  create(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parseZod(Create, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const [c, co] = await Promise.all([tx.consultant.findUnique({ where: { id: d.consultantId } }), tx.company.findUnique({ where: { id: d.companyId } })]);
      if (!c || !co) throw new BadRequestException("Consultant ou entreprise introuvable");
      if (c.status !== "active") throw new BadRequestException("Le consultant doit avoir terminé son onboarding (statut actif)");
      if (d.agreementId) {
        const a = await tx.frameworkAgreement.findUnique({ where: { id: d.agreementId }, include: { rates: true } });
        if (!a || a.companyId !== d.companyId) throw new BadRequestException("Accord-cadre introuvable pour ce client");
        if (a.status !== "active") throw new BadRequestException("L'accord-cadre n'est pas actif");
        const end = d.endDate ?? d.startDate;
        if (d.startDate < a.startDate.toISOString().slice(0, 10) || end > a.endDate.toISOString().slice(0, 10)) throw new BadRequestException("La mission dépasse la période de l'accord-cadre");
        const rate = a.rates.find(r => r.id === d.agreementRateId); if (!rate) throw new BadRequestException("Tarif de l'accord-cadre requis (agreementRateId)");
        if (Number(d.dailyRate) > Number(rate.maxDailyRate)) throw new BadRequestException(`TJM supérieur au plafond de l'accord-cadre (${rate.maxDailyRate} €)`);
      } else if (d.agreementRateId) throw new BadRequestException("agreementRateId sans agreementId");
      const m = await tx.mission.create({ data: { agreementId: d.agreementId, agreementRateId: d.agreementRateId, tenantId: ctx.tenantId, consultantId: d.consultantId, companyId: d.companyId, title: d.title,
        dailyRate: d.dailyRate, vatRate: d.vatRate, startDate: new Date(d.startDate), endDate: d.endDate ? new Date(d.endDate) : null } });
      await this.audit.record(tx, ctx, { action: "mission.create", entity: "Mission", entityId: m.id, after: { consultantId: m.consultantId, companyId: m.companyId, dailyRate: d.dailyRate, vatRate: d.vatRate } });
      return m;
    });
  }
}
