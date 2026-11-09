import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext, RequirePermission } from "./auth.guard";
import { parseZod } from "./workflow";
import { rateForPeriod } from "@portage/domain";
import Decimal from "decimal.js";

const money = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "Montant invalide (2 décimales max)");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date AAAA-MM-JJ");
const Create = z.object({
  consultantId: z.string().uuid(), companyId: z.string().uuid(), title: z.string().min(1).max(200),
  dailyRate: money.refine(v => Number(v) > 0, "TJM > 0"),
  vatRate: z.string().regex(/^\d{1,2}(\.\d{1,2})?$|^100$/, "Taux de TVA invalide"),
  startDate: date, endDate: date.optional(), agreementId: z.string().uuid().optional(), agreementRateId: z.string().uuid().optional(), purchaseOrderId: z.string().uuid().optional(),
  timeUnit: z.enum(["day", "hour", "forfait_jours"]).default("day"), annualDaysCap: z.number().int().min(1).max(366).optional(),
}).refine(v => v.timeUnit === "forfait_jours" || v.annualDaysCap === undefined, "Le plafond annuel ne concerne que le forfait jours").refine(v => !v.endDate || v.endDate >= v.startDate, "La fin précède le début");
const Amend = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rate"), newRate: money.refine(v => Number(v) > 0, "Tarif > 0"), effectiveMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mois AAAA-MM"), reason: z.string().min(3).max(500) }),
  z.object({ kind: z.literal("extend"), newEndDate: date, reason: z.string().min(3).max(500) }),
  z.object({ kind: z.literal("early_end"), newEndDate: date, reason: z.string().min(3).max(500) }),
  z.object({ kind: z.literal("budget"), budgetAmount: money.refine(v => Number(v) > 0, "Budget > 0"), reason: z.string().min(3).max(500) }),
]) as unknown as z.ZodType<{ kind: "rate" | "extend" | "early_end" | "budget"; newRate?: string; effectiveMonth?: string; newEndDate?: string; budgetAmount?: string; reason: string }>;
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
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const m = await tx.mission.findUnique({ where: { id }, include: { consultant: { select: { firstName: true, lastName: true } }, company: { select: { name: true } }, amendments: { orderBy: { createdAt: "desc" } } } });
      if (!m) throw new NotFoundException();
      const rates = m.amendments.filter(a => a.kind === "rate").map(a => ({ effectiveMonth: a.effective, newRate: (a.after as { rate: string }).rate }));
      const current = rateForPeriod(m.dailyRate.toString(), rates, new Date().toISOString().slice(0, 7));
      // Consommation du budget = HT des factures non annulées de la mission (émises ou brouillons).
      const inv = await tx.invoice.findMany({ where: { missionId: id, status: { not: "cancelled" } }, select: { net: true, status: true } });
      const consumed = inv.reduce((a, i) => a.plus(i.net.toString()), new Decimal(0));
      const budget = m.budgetAmount ? { amount: m.budgetAmount.toString(), consumed: consumed.toFixed(2), remaining: new Decimal(m.budgetAmount.toString()).minus(consumed).toFixed(2), overBudget: consumed.gt(m.budgetAmount.toString()), note: "Suivi informatif : factures HT non annulées, non bloquant." } : null;
      return { ...m, initialRate: m.dailyRate.toString(), currentRate: current, budget };
    });
  }

  /** Avenant : tarif (à compter d'un mois), prolongation, fin anticipée ou budget. Append-only, motif obligatoire, journalisé. */
  @Post(":id/amendments") @RequirePermission("mission.write")
  amend(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parseZod(Amend, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const m = await tx.mission.findUnique({ where: { id } });
      if (!m) throw new NotFoundException();
      if (m.status !== "active") throw new BadRequestException("Mission terminée : avenant impossible");
      const start = m.startDate.toISOString().slice(0, 10), end = m.endDate?.toISOString().slice(0, 10) ?? null;
      let effective: string, before: object, after: object, data: Record<string, unknown> = {};
      if (d.kind === "rate") {
        effective = d.effectiveMonth!;
        if (effective < start.slice(0, 7)) throw new BadRequestException("Le tarif ne peut pas prendre effet avant le début de la mission");
        const invoiced = await tx.timesheet.findFirst({ where: { missionId: id, status: "invoiced", period: { gte: effective } } });
        if (invoiced) throw new ConflictException(`Une période facturée (${invoiced.period}) est postérieure à la date d'effet : avenant rétroactif impossible`);
        if (m.agreementRateId) {
          const r = await tx.frameworkRate.findUnique({ where: { id: m.agreementRateId } });
          if (r && Number(d.newRate) > Number(r.maxDailyRate)) throw new BadRequestException(`Tarif supérieur au plafond de l'accord-cadre (${r.maxDailyRate} €)`);
        }
        const rates = (await tx.missionAmendment.findMany({ where: { missionId: id, kind: "rate" } })).map(a => ({ effectiveMonth: a.effective, newRate: (a.after as { rate: string }).rate }));
        before = { rate: rateForPeriod(m.dailyRate.toString(), rates, effective) }; after = { rate: d.newRate };
      } else if (d.kind === "extend") {
        effective = d.newEndDate!;
        if (!end) throw new BadRequestException("Mission sans date de fin : rien à prolonger");
        if (effective <= end) throw new BadRequestException("La nouvelle fin doit être postérieure à la fin actuelle");
        if (m.agreementId) { const a = await tx.frameworkAgreement.findUnique({ where: { id: m.agreementId } }); if (a && effective > a.endDate.toISOString().slice(0, 10)) throw new BadRequestException("La prolongation dépasse l'accord-cadre"); }
        if (m.purchaseOrderId) { const po = await tx.purchaseOrder.findUnique({ where: { id: m.purchaseOrderId } }); if (po && effective > po.endDate.toISOString().slice(0, 10)) throw new BadRequestException("La prolongation dépasse le bon de commande"); }
        before = { endDate: end }; after = { endDate: effective }; data = { endDate: new Date(effective) };
      } else if (d.kind === "early_end") {
        effective = d.newEndDate!;
        if (effective < start) throw new BadRequestException("La fin précède le début");
        if (end && effective >= end) throw new BadRequestException("Une fin anticipée doit précéder la fin actuelle");
        const last = await tx.timesheetLine.findFirst({ where: { timesheet: { missionId: id } }, orderBy: { date: "desc" } });
        if (last && effective < last.date.toISOString().slice(0, 10)) throw new ConflictException(`Des jours sont déjà déclarés jusqu'au ${last.date.toISOString().slice(0, 10)}`);
        before = { endDate: end }; after = { endDate: effective }; data = { endDate: new Date(effective) };
      } else {
        effective = new Date().toISOString().slice(0, 10);
        before = { budget: m.budgetAmount?.toString() ?? null }; after = { budget: d.budgetAmount }; data = { budgetAmount: d.budgetAmount };
      }
      const row = await tx.missionAmendment.create({ data: { tenantId: ctx.tenantId, missionId: id, kind: d.kind, effective, before, after, reason: d.reason.trim(), createdBy: ctx.userId } });
      if (Object.keys(data).length) await tx.mission.update({ where: { id }, data });
      await this.audit.record(tx, ctx, { action: `mission.amend_${d.kind}`, entity: "Mission", entityId: id, before, after: { ...after, effective, reason: d.reason.trim() } });
      return row;
    });
  }

  @Post() @RequirePermission("mission.write")
  create(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parseZod(Create, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const [c, co] = await Promise.all([tx.consultant.findUnique({ where: { id: d.consultantId } }), tx.company.findUnique({ where: { id: d.companyId } })]);
      if (!c || !co) throw new BadRequestException("Consultant ou entreprise introuvable");
      if (c.status !== "active") throw new BadRequestException("Le consultant doit avoir terminé son onboarding (statut actif)");
      if (d.agreementId && d.timeUnit === "hour") throw new BadRequestException("Accord-cadre exprimé en tarif journalier : non applicable à une mission en heures");
      if (d.agreementId) {
        const a = await tx.frameworkAgreement.findUnique({ where: { id: d.agreementId }, include: { rates: true } });
        if (!a || a.companyId !== d.companyId) throw new BadRequestException("Accord-cadre introuvable pour ce client");
        if (a.status !== "active") throw new BadRequestException("L'accord-cadre n'est pas actif");
        const end = d.endDate ?? d.startDate;
        if (d.startDate < a.startDate.toISOString().slice(0, 10) || end > a.endDate.toISOString().slice(0, 10)) throw new BadRequestException("La mission dépasse la période de l'accord-cadre");
        const rate = a.rates.find(r => r.id === d.agreementRateId); if (!rate) throw new BadRequestException("Tarif de l'accord-cadre requis (agreementRateId)");
        if (Number(d.dailyRate) > Number(rate.maxDailyRate)) throw new BadRequestException(`TJM supérieur au plafond de l'accord-cadre (${rate.maxDailyRate} €)`);
      } else if (d.agreementRateId) throw new BadRequestException("agreementRateId sans agreementId");
      if (d.purchaseOrderId) {
        const po = await tx.purchaseOrder.findUnique({ where: { id: d.purchaseOrderId } });
        if (!po || po.companyId !== d.companyId) throw new BadRequestException("Bon de commande introuvable pour ce client");
        if (po.status !== "open") throw new BadRequestException("Le bon de commande n'est pas ouvert");
        if (d.startDate < po.startDate.toISOString().slice(0, 10) || (d.endDate ?? d.startDate) > po.endDate.toISOString().slice(0, 10)) throw new BadRequestException("La mission dépasse la période du bon de commande");
      }
      const m = await tx.mission.create({ data: { timeUnit: d.timeUnit, annualDaysCap: d.annualDaysCap, purchaseOrderId: d.purchaseOrderId, agreementId: d.agreementId, agreementRateId: d.agreementRateId, tenantId: ctx.tenantId, consultantId: d.consultantId, companyId: d.companyId, title: d.title,
        dailyRate: d.dailyRate, vatRate: d.vatRate, startDate: new Date(d.startDate), endDate: d.endDate ? new Date(d.endDate) : null } });
      await this.audit.record(tx, ctx, { action: "mission.create", entity: "Mission", entityId: m.id, after: { consultantId: m.consultantId, companyId: m.companyId, dailyRate: d.dailyRate, vatRate: d.vatRate, timeUnit: d.timeUnit, annualDaysCap: d.annualDaysCap } });
      return m;
    });
  }
}
