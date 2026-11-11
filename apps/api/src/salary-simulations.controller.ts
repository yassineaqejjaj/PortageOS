import { BadRequestException, Body, ConflictException, Controller, Get, Header, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, Res, UnprocessableEntityException } from "@nestjs/common";
import { OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { SalaryParams, SalarySimulation, normalizePhone, simulateSalary } from "@portage/domain";
import { PrismaService, Tx } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext, RequirePermission } from "./auth.guard";
import { ParametersService } from "./parameters.service";
import { WhatsappService } from "./whatsapp.service";
import { renderSalaryPdf } from "./salary-pdf";
import { parisToday, parseZod } from "./workflow";

type R = { ctx: RequestContext };
const money = z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, "Montant invalide (2 décimales max)");
const Create = z.object({
  prospectId: z.string().uuid().optional(),
  tjm: money, daysPerMonth: z.string().regex(/^\d{1,2}(\.5)?$/, "Jours : multiple de 0,5"), mutualMonthly: money,
  /** Chaque scénario arbitre salaire et frais : plus de brut = moins de frais forfaitaires (cf. feuilles de référence). */
  scenarios: z.array(z.object({ grossAnnual: money, dailyExpenses: money })).min(1).max(3),
  contact: z.object({ name: z.string().min(2).max(80), phone: z.string().max(30).optional(), email: z.string().email().max(254).optional() }).optional(),
});
const Send = z.object({ prospectId: z.string().uuid() });

/** Paramètres APPROUVÉS requis par la simulation : tout manque est signalé, jamais remplacé par une valeur par défaut. */
const KEYS = { fee: "management_fee_rate_percent", days: "sim.working_days_per_year", net: "sim.net_to_gross_percent", leave: "sim.paid_leave_days", div: "sim.leave_day_divisor", pasTop: "sim.pas_rate.max" } as const;

@Controller("crm/salary-simulations")
export class SalarySimulationsController implements OnModuleInit {
  constructor(private prisma: PrismaService, private audit: AuditService, private params: ParametersService, private wa: WhatsappService) {}

  onModuleInit() {
    this.wa.attachmentResolver = (tenantId, id) => this.prisma.forTenant(tenantId, async tx => {
      const row = await tx.simulation.findUnique({ where: { id } }); if (!row) throw new Error("Simulation introuvable");
      return this.pdf(tx, tenantId, row.results as unknown as Stored, row.createdAt.toISOString().slice(0, 10));
    });
  }

  private async loadParams(tx: Tx, date: string): Promise<{ p: SalaryParams; used: Record<string, { value: string; source: string; validFrom: string }> }> {
    const sim = await this.params.atPrefix(tx, "sim.", date); const fee = await this.params.at(tx, KEYS.fee, date); if (fee) sim.set(KEYS.fee, fee);
    const missing = Object.values(KEYS).filter(k => !sim.has(k)); const grid = [...sim.keys()].filter(k => k.startsWith("sim.pas_rate.") && k !== KEYS.pasTop);
    if (!grid.length) missing.push("sim.pas_rate.<seuil>" as never);
    if (missing.length) throw new UnprocessableEntityException(`Paramètres approuvés manquants : ${missing.join(", ")}. Saisissez-les puis faites-les approuver (Conformité > Règles).`);
    const g = (k: string) => sim.get(k)!.value;
    const p: SalaryParams = { workingDaysPerYear: g(KEYS.days), managementFeePercent: g(KEYS.fee), netToGrossPercent: g(KEYS.net), paidLeaveDays: g(KEYS.leave), leaveDayDivisor: g(KEYS.div), pasTopRatePercent: g(KEYS.pasTop), ...(sim.has("sim.employer_charges_percent") ? { employerChargesPercent: g("sim.employer_charges_percent") } : {}),
      pasGrid: grid.map(k => ({ upTo: k.slice("sim.pas_rate.".length), ratePercent: g(k) })) };
    return { p, used: Object.fromEntries([...sim].map(([k, v]) => [k, { value: v.value, source: v.source, validFrom: v.validFrom }])) };
  }

  private async brand(tx: Tx, tenantId: string) {
    const prof = await tx.tenantProfile.findUnique({ where: { tenantId } }); if (prof?.legalName) return prof.legalName;
    return (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } })).name;
  }
  private async pdf(tx: Tx, tenantId: string, st: Stored, date: string) {
    return renderSalaryPdf({ brand: await this.brand(tx, tenantId), date, contact: st.contact }, st.scenarios);
  }
  private filename = (st: Stored, date: string) => `simulation_${(st.recipient ?? "prospect").normalize("NFD").replace(/[^\w]+/g, "_").replace(/_+/g, "_").slice(0, 40)}_${st.scenarios[0]!.variables.tjm.split(".")[0]}_${date}.pdf`;

  /** Calcul commun (aperçu et enregistrement). */
  private async compute(tx: Tx, ctx: RequestContext, d: z.infer<typeof Create>) {
    const prospect = d.prospectId ? await tx.prospect.findFirst({ where: { id: d.prospectId, archivedAt: null } }) : null;
    if (d.prospectId && !prospect) throw new NotFoundException("Prospect introuvable");
    const today = parisToday(); const { p, used } = await this.loadParams(tx, today);
    let scenarios: SalarySimulation[];
    try { scenarios = d.scenarios.map(sc => simulateSalary({ tjm: d.tjm, daysPerMonth: d.daysPerMonth, dailyExpenses: sc.dailyExpenses, mutualMonthly: d.mutualMonthly, grossAnnual: sc.grossAnnual }, p)); }
    catch (e) { throw new BadRequestException((e as Error).message); }
    const email = (await tx.user.findUnique({ where: { id: ctx.userId }, select: { email: true } }))?.email;
    const contact = { name: d.contact?.name ?? (email ?? "Conseiller"), phone: d.contact?.phone ?? null, email: d.contact?.email ?? email ?? null };
    const stored: Stored = { kind: "salary", recipient: prospect?.name ?? null, contact, scenarios, parameters: used,
      disclaimer: "Simulation non contractuelle : estimation, ni bulletin de paie ni engagement. Taux issus des paramètres approuvés listés." };
    return { stored, today };
  }

  /** Aperçu immédiat (rien n'est enregistré ni audité) : permet un résultat en direct pendant la saisie. */
  @Post("preview") @RequirePermission("prospect.write")
  preview(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parseZod(Create, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => (await this.compute(tx, ctx, d)).stored);
  }

  @Post() @RequirePermission("prospect.write")
  create(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parseZod(Create, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const { stored, today } = await this.compute(tx, ctx, d);
      const row = await tx.simulation.create({ data: { tenantId: ctx.tenantId, prospectId: d.prospectId, inputs: { kind: "salary", ...d } as object, results: stored as unknown as object, createdBy: ctx.userId } });
      await this.audit.record(tx, ctx, { action: "crm.salary_simulation", entity: "Simulation", entityId: row.id, after: { prospectId: d.prospectId, scenarios: stored.scenarios.length, tjm: d.tjm } });
      return { id: row.id, createdAt: row.createdAt, ...stored, filename: this.filename(stored, today) };
    });
  }

  @Get() @RequirePermission("prospect.read")
  list(@Req() { ctx }: R, @Query("prospectId") prospectId?: string) {
    return this.prisma.forTenant(ctx.tenantId, async tx => (await tx.simulation.findMany({ where: { ...(prospectId ? { prospectId } : {}), inputs: { path: ["kind"], equals: "salary" } }, orderBy: { createdAt: "desc" }, take: 50 }))
      .map(r => ({ id: r.id, createdAt: r.createdAt, prospectId: r.prospectId, ...(r.results as object) })));
  }

  @Get(":id/pdf") @RequirePermission("prospect.read") @Header("content-type", "application/pdf")
  async download(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Res() res: { setHeader(k: string, v: string): void; send(b: Buffer): void }) {
    const { buf, name } = await this.prisma.forTenant(ctx.tenantId, async tx => {
      const row = await tx.simulation.findUnique({ where: { id } }); if (!row || (row.inputs as { kind?: string })?.kind !== "salary") throw new NotFoundException();
      const date = row.createdAt.toISOString().slice(0, 10); const st = row.results as unknown as Stored;
      await this.audit.record(tx, ctx, { action: "crm.salary_simulation_pdf", entity: "Simulation", entityId: id });
      return { buf: await this.pdf(tx, ctx.tenantId, st, date), name: this.filename(st, date) };
    });
    res.setHeader("content-disposition", `attachment; filename="${name}"`); res.send(buf);
  }

  /** Envoi du PDF au prospect par WhatsApp : consentement requis ; hors fenêtre de 24 h, modèle approuvé à en-tête document. */
  @Post(":id/whatsapp") @RequirePermission("whatsapp.write")
  async send(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parseZod(Send, body);
    const r = await this.prisma.forTenant(ctx.tenantId, async tx => {
      const [row, prospect] = await Promise.all([tx.simulation.findUnique({ where: { id } }), tx.prospect.findFirst({ where: { id: d.prospectId, archivedAt: null } })]);
      if (!row || (row.inputs as { kind?: string })?.kind !== "salary" || !prospect) throw new NotFoundException();
      const st = row.results as unknown as Stored; const brand = await this.brand(tx, ctx.tenantId);
      const first = prospect.name.trim().split(/\s+/)[0] ?? prospect.name;
      return this.wa.queueSimulation(tx, ctx, { prospectId: prospect.id, simulationId: id, filename: this.filename(st, row.createdAt.toISOString().slice(0, 10)), firstName: first, brand });
    });
    if (!r.queued) throw new ConflictException({ message: r.reason === "no_consent" ? "Aucun consentement WhatsApp enregistré pour ce prospect : recueillez-le (avec preuve) avant l'envoi." : "Modèle « Envoi d'une simulation » non déclaré/activé : renseignez son nom approuvé par Meta (WhatsApp > Paramètres).", code: r.reason });
    await this.wa.flush(ctx.tenantId);
    return this.prisma.forTenant(ctx.tenantId, tx => tx.whatsappMessage.findUnique({ where: { id: r.messageId } }));
  }
}

interface Stored { kind: "salary"; recipient: string | null; contact: { name: string; phone: string | null; email: string | null }; scenarios: SalarySimulation[]; parameters: Record<string, unknown>; disclaimer: string }
void normalizePhone;
