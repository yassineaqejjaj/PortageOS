import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from "@nestjs/common";
import Decimal from "decimal.js";
import { z } from "zod";
import { BAND_THRESHOLDS, CAMPAIGN_STATES, CampaignState, CommissionState, DEFAULT_SCORING_WEIGHTS, SCORING_DISCLAIMER, SCORING_KEYS, campaignWorkflow, commissionWorkflow, validateRule, validateWeights } from "@portage/domain";
import { PrismaService, Tx } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext, RequirePermission } from "./auth.guard";
import { CrmService } from "./crm.service";
import { LedgerService, ACCOUNTS } from "./ledger.service";
import { NotificationsService } from "./notifications.service";
import { can } from "./permissions";
import { applyAsAnyRole, parisToday, parseZod } from "./workflow";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date AAAA-MM-JJ");
const money = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "Montant invalide");
const Campaign = z.object({ name: z.string().min(2).max(120), kind: z.enum(["consultants", "companies"]), channel: z.enum(["email", "phone", "event", "other"]), startDate: date.optional(), endDate: date.optional(), budget: money.optional() }).refine(v => !v.startDate || !v.endDate || v.endDate >= v.startDate, "La fin précède le début");
const Interaction = z.object({ type: z.enum(["call", "email", "meeting", "note"]), summary: z.string().min(3).max(2000), occurredAt: z.string().datetime().optional() });
const Task = z.object({ prospectId: z.string().uuid().optional(), title: z.string().min(3).max(200), dueDate: date, assigneeUserId: z.string().uuid().optional() });
const Referrer = z.object({ kind: z.enum(["introducer", "sponsor"]), name: z.string().min(2).max(120), email: z.string().email().max(254).optional(), consultantId: z.string().uuid().optional() });
const Referral = z.object({ prospectId: z.string().uuid(), referrerId: z.string().uuid(), ruleType: z.enum(["percent_of_collected_net", "fixed_per_conversion"]), ruleValue: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/), durationMonths: z.number().int().min(0).max(60).default(0) });
const Agreement = z.object({ companyId: z.string().uuid(), name: z.string().min(2).max(160), startDate: date, endDate: date, paymentTermsDays: z.number().int().min(0).max(180).optional(), notes: z.string().max(2000).optional(),
  rates: z.array(z.object({ label: z.string().min(1).max(80), maxDailyRate: money.refine(v => Number(v) > 0, "TJM > 0") })).min(1).max(30) }).refine(v => v.endDate >= v.startDate, "La fin précède le début");
const Import = z.object({ csv: z.string().min(1), fileName: z.string().max(120).optional(), defaultKind: z.enum(["consultant", "company"]).default("consultant"), campaignId: z.string().uuid().optional(),
  mapping: z.object({ name: z.string().optional(), email: z.string().optional(), phone: z.string().optional(), kind: z.string().optional(), source: z.string().optional() }).optional() });
const Sim = z.object({ prospectId: z.string().uuid().optional(), feeRatePercent: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).optional(),
  scenarios: z.array(z.object({ label: z.string().min(1).max(60), dailyRate: money, daysPerMonth: z.string().regex(/^\d{1,2}(\.5)?$/), vatRate: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/), monthlyExpenses: money.optional() })).min(1).max(5) });
type R = { ctx: RequestContext };

@Controller("crm")
export class CrmController {
  constructor(private prisma: PrismaService, private audit: AuditService, private crm: CrmService, private ledger: LedgerService, private notif: NotificationsService) {}

  // ---------- scoring ----------
  @Get("scoring") @RequirePermission("prospect.read")
  scoring(@Req() { ctx }: R) { return this.prisma.forTenant(ctx.tenantId, async tx => ({ weights: await this.crm.weights(tx), defaults: DEFAULT_SCORING_WEIGHTS, criteria: SCORING_KEYS, thresholds: BAND_THRESHOLDS, disclaimer: SCORING_DISCLAIMER })); }

  @Put("scoring") @RequirePermission("crm.scoring")
  setScoring(@Req() { ctx }: R, @Body() body: unknown) {
    const w = (body as { weights?: Record<string, unknown> })?.weights; if (!w || typeof w !== "object") throw new BadRequestException("weights requis");
    const errs = validateWeights(w); if (errs.length) throw new BadRequestException(errs.join("; "));
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const before = await this.crm.weights(tx);
      await tx.scoringConfig.upsert({ where: { tenantId: ctx.tenantId }, update: { weights: w as object, updatedBy: ctx.userId, updatedAt: new Date() }, create: { tenantId: ctx.tenantId, weights: w as object, updatedBy: ctx.userId } });
      await this.audit.record(tx, ctx, { action: "crm.scoring_updated", entity: "ScoringConfig", entityId: ctx.tenantId, before, after: w });
      return { weights: w };
    });
  }

  // ---------- prospects enrichis ----------
  @Get("prospects") @RequirePermission("prospect.read")
  list(@Req() { ctx }: R, @Query("stage") stage?: string, @Query("campaignId") campaignId?: string, @Query("q") q?: string) {
    if (campaignId && !/^[0-9a-f-]{36}$/.test(campaignId)) throw new BadRequestException("Campagne invalide");
    if (q && q.length > 100) throw new BadRequestException("Recherche trop longue");
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const rows = await tx.prospect.findMany({ where: { archivedAt: null, ...(stage ? { stage } : {}), ...(campaignId ? { campaignId } : {}), ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) }, orderBy: { createdAt: "desc" }, take: 300 });
      const sc = await this.crm.scores(tx, rows);
      const camps = await tx.campaign.findMany({ where: { id: { in: rows.map(r => r.campaignId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
      return rows.map(p => ({ id: p.id, kind: p.kind, name: p.name, email: p.email, phone: p.phone, stage: p.stage, source: p.source, lostReason: p.lostReason, createdAt: p.createdAt, campaign: camps.find(c => c.id === p.campaignId) ?? null, score: sc.get(p.id)!.score, band: sc.get(p.id)!.band }));
    });
  }

  @Get("prospects/:id") @RequirePermission("prospect.read")
  detail(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) {
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const p = await tx.prospect.findUnique({ where: { id } }); if (!p || p.archivedAt) throw new NotFoundException();
      const sc = (await this.crm.scores(tx, [p])).get(id)!;
      const [interactions, tasks, referral, sims, campaign] = await Promise.all([
        tx.interaction.findMany({ where: { prospectId: id }, orderBy: { occurredAt: "desc" }, take: 100 }), tx.crmTask.findMany({ where: { prospectId: id }, orderBy: { dueDate: "asc" }, take: 50 }),
        tx.referral.findUnique({ where: { prospectId: id }, include: { referrer: { select: { name: true, kind: true } }, commissions: { select: { id: true, amount: true, status: true, sourceType: true } } } }),
        tx.simulation.findMany({ where: { prospectId: id }, orderBy: { createdAt: "desc" }, take: 5 }), p.campaignId ? tx.campaign.findUnique({ where: { id: p.campaignId }, select: { id: true, name: true } }) : null]);
      const today = parisToday();
      return { prospect: { id: p.id, kind: p.kind, name: p.name, email: p.email, phone: p.phone, stage: p.stage, source: p.source, lostReason: p.lostReason, createdAt: p.createdAt }, campaign, score: sc,
        interactions: interactions.map(i => ({ id: i.id, type: i.type, summary: i.summary, occurredAt: i.occurredAt, createdBy: i.createdBy })),
        tasks: tasks.map(t => ({ id: t.id, title: t.title, dueDate: t.dueDate.toISOString().slice(0, 10), status: t.status, overdue: t.status === "open" && t.dueDate.toISOString().slice(0, 10) < today, assigneeUserId: t.assigneeUserId })),
        referral: referral && { id: referral.id, referrer: referral.referrer, ruleType: referral.ruleType, ruleValue: referral.ruleValue.toString(), durationMonths: referral.durationMonths, convertedAt: referral.convertedAt, commissions: referral.commissions.map(c => ({ ...c, amount: c.amount.toString() })) },
        simulations: sims.map(s => ({ id: s.id, createdAt: s.createdAt, results: s.results })) };
    });
  }

  @Post("prospects/:id/interactions") @RequirePermission("prospect.write")
  interact(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parseZod(Interaction, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      if (!(await tx.prospect.findFirst({ where: { id, archivedAt: null } }))) throw new NotFoundException();
      const occurredAt = d.occurredAt ? new Date(d.occurredAt) : new Date(); if (occurredAt.getTime() > Date.now() + 60_000) throw new BadRequestException("Une interaction ne peut pas être datée dans le futur");
      const i = await tx.interaction.create({ data: { tenantId: ctx.tenantId, prospectId: id, type: d.type, summary: d.summary, occurredAt, createdBy: ctx.userId } });
      await this.audit.record(tx, ctx, { action: "crm.interaction", entity: "Interaction", entityId: i.id, after: { prospectId: id, type: d.type } });
      return i;
    });
  }

  // ---------- tâches ----------
  @Get("tasks") @RequirePermission("prospect.read")
  tasks(@Req() { ctx }: R, @Query("mine") mine?: string, @Query("status") status?: string) {
    if (status && !["open", "done", "cancelled"].includes(status)) throw new BadRequestException("Statut inconnu");
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const rows = await tx.crmTask.findMany({ where: { ...(mine === "1" ? { assigneeUserId: ctx.userId } : {}), status: status ?? "open" }, orderBy: { dueDate: "asc" }, take: 200 });
      const ps = await tx.prospect.findMany({ where: { id: { in: rows.map(r => r.prospectId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }); const today = parisToday();
      return rows.map(t => ({ id: t.id, title: t.title, dueDate: t.dueDate.toISOString().slice(0, 10), status: t.status, overdue: t.status === "open" && t.dueDate.toISOString().slice(0, 10) < today, assigneeUserId: t.assigneeUserId, prospect: ps.find(p => p.id === t.prospectId) ?? null }));
    });
  }

  @Post("tasks") @RequirePermission("prospect.write")
  createTask(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parseZod(Task, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      if (d.prospectId && !(await tx.prospect.findFirst({ where: { id: d.prospectId, archivedAt: null } }))) throw new NotFoundException();
      const assignee = d.assigneeUserId ?? ctx.userId;
      const m = await tx.membership.findUnique({ where: { userId_tenantId: { userId: assignee, tenantId: ctx.tenantId } } });
      if (!m || !(["tenant_admin", "commerce", "direction"] as string[]).some(r => m.roles.includes(r))) throw new BadRequestException("L'assigné doit être un membre de l'équipe commerciale");
      const t = await tx.crmTask.create({ data: { tenantId: ctx.tenantId, prospectId: d.prospectId, title: d.title, dueDate: new Date(d.dueDate), assigneeUserId: assignee, createdBy: ctx.userId } });
      if (assignee !== ctx.userId) await this.notif.notify(tx, ctx.tenantId, [assignee], { type: "crm.task_assigned", title: `Tâche assignée : ${d.title}`, body: `Échéance ${d.dueDate}`, link: "/crm/tasks" }, ctx.userId);
      await this.audit.record(tx, ctx, { action: "crm.task_created", entity: "CrmTask", entityId: t.id, after: { assignee, dueDate: d.dueDate } });
      return t;
    });
  }

  @Post("tasks/:id/:event") @RequirePermission("prospect.write")
  taskEvent(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Param("event") event: string) {
    if (!["done", "cancel"].includes(event)) throw new NotFoundException();
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const t = await tx.crmTask.findUnique({ where: { id } }); if (!t) throw new NotFoundException();
      if (t.assigneeUserId !== ctx.userId && t.createdBy !== ctx.userId && !can(ctx.roles, "member.manage")) throw new ForbiddenException("Seuls l'assigné, le créateur ou un administrateur peuvent clore cette tâche");
      const r = await tx.crmTask.updateMany({ where: { id, status: "open" }, data: event === "done" ? { status: "done", doneAt: new Date() } : { status: "cancelled" } });
      if (r.count !== 1) throw new ConflictException("Tâche déjà clôturée");
      await this.audit.record(tx, ctx, { action: `crm.task_${event}`, entity: "CrmTask", entityId: id });
      return tx.crmTask.findUniqueOrThrow({ where: { id } });
    });
  }

  // ---------- campagnes ----------
  @Get("campaigns") @RequirePermission("prospect.read")
  campaigns(@Req() { ctx }: R) { return this.prisma.forTenant(ctx.tenantId, tx => tx.campaign.findMany({ orderBy: { createdAt: "desc" }, take: 100 })); }

  @Post("campaigns") @RequirePermission("prospect.write")
  createCampaign(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parseZod(Campaign, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      if (await tx.campaign.findUnique({ where: { tenantId_name: { tenantId: ctx.tenantId, name: d.name } } })) throw new ConflictException("Une campagne porte déjà ce nom");
      const c = await tx.campaign.create({ data: { tenantId: ctx.tenantId, name: d.name, kind: d.kind, channel: d.channel, startDate: d.startDate ? new Date(d.startDate) : null, endDate: d.endDate ? new Date(d.endDate) : null, budget: d.budget, createdBy: ctx.userId } });
      await this.audit.record(tx, ctx, { action: "crm.campaign_created", entity: "Campaign", entityId: c.id, after: { name: d.name, kind: d.kind, channel: d.channel } });
      return c;
    });
  }

  @Post("campaigns/:id/transition") @RequirePermission("prospect.write")
  campaignEvent(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { event } = parseZod(z.object({ event: z.enum(["launch", "end"]) }), body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const c = await tx.campaign.findUnique({ where: { id } }); if (!c) throw new NotFoundException();
      const next = applyAsAnyRole(campaignWorkflow, c.status as CampaignState, event, ctx.userId, ctx.roles, {} as Record<string, never>);
      const r = await tx.campaign.updateMany({ where: { id, status: c.status }, data: { status: next } }); if (r.count !== 1) throw new ConflictException("Campagne modifiée entre-temps");
      await this.audit.record(tx, ctx, { action: `crm.campaign_${event}`, entity: "Campaign", entityId: id, before: { status: c.status }, after: { status: next } });
      return tx.campaign.findUniqueOrThrow({ where: { id } });
    });
  }

  @Post("campaigns/:id/prospects") @RequirePermission("prospect.write")
  assignToCampaign(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { prospectIds } = parseZod(z.object({ prospectIds: z.array(z.string().uuid()).min(1).max(500) }), body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const c = await tx.campaign.findUnique({ where: { id } }); if (!c) throw new NotFoundException();
      if (c.status === "ended") throw new ConflictException("Campagne terminée");
      const r = await tx.prospect.updateMany({ where: { id: { in: prospectIds }, campaignId: null, archivedAt: null }, data: { campaignId: id } });
      await this.audit.record(tx, ctx, { action: "crm.campaign_assigned", entity: "Campaign", entityId: id, after: { requested: prospectIds.length, assigned: r.count } });
      return { assigned: r.count, skipped: prospectIds.length - r.count };
    });
  }

  @Get("campaigns/:id/stats") @RequirePermission("prospect.read")
  campaignStats(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) {
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const c = await tx.campaign.findUnique({ where: { id } }); if (!c) throw new NotFoundException();
      const g = await tx.prospect.groupBy({ by: ["stage"], where: { campaignId: id, archivedAt: null }, _count: true });
      const stages = Object.fromEntries(["new", "contacted", "qualified", "converted", "lost"].map(s => [s, g.find(x => x.stage === s)?._count ?? 0]));
      const total = Object.values(stages).reduce((a, b) => a + b, 0), conv = stages.converted!;
      return { campaign: { id: c.id, name: c.name, status: c.status, budget: c.budget?.toString() ?? null }, prospects: total, stages, conversionRatePercent: total ? new Decimal(conv).div(total).times(100).toDecimalPlaces(1).toFixed(1) : null,
        costPerConversion: c.budget && conv ? new Decimal(c.budget.toString()).div(conv).toDecimalPlaces(2).toFixed(2) : null, note: "Coût par conversion = budget de la campagne / prospects convertis (hors coûts internes)." };
    });
  }

  // ---------- apporteurs, parrainages, commissions ----------
  @Get("referrers") @RequirePermission("prospect.read")
  referrers(@Req() { ctx }: R) {
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const rows = await tx.referrer.findMany({ orderBy: { name: "asc" }, take: 200, include: { referrals: { include: { commissions: { select: { amount: true, status: true } } } } } });
      return rows.map(r => { const cs = r.referrals.flatMap(x => x.commissions); const sum = (s: string) => cs.filter(c => c.status === s).reduce((t, c) => t.plus(c.amount.toString()), new Decimal(0)).toFixed(2);
        return { id: r.id, kind: r.kind, name: r.name, email: r.email, status: r.status, referrals: r.referrals.length, conversions: r.referrals.filter(x => x.convertedAt).length, commissions: { accrued: sum("accrued"), approved: sum("approved"), paid: sum("paid") } }; });
    });
  }

  @Post("referrers") @RequirePermission("prospect.write")
  createReferrer(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parseZod(Referrer, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      if (d.kind === "sponsor" && !d.consultantId) throw new BadRequestException("Un parrain est un consultant : consultantId requis");
      if (d.consultantId && !(await tx.consultant.findUnique({ where: { id: d.consultantId } }))) throw new BadRequestException("Consultant introuvable");
      if (await tx.referrer.findUnique({ where: { tenantId_name: { tenantId: ctx.tenantId, name: d.name } } })) throw new ConflictException("Un apporteur porte déjà ce nom");
      const r = await tx.referrer.create({ data: { tenantId: ctx.tenantId, ...d, createdBy: ctx.userId } });
      await this.audit.record(tx, ctx, { action: "crm.referrer_created", entity: "Referrer", entityId: r.id, after: { kind: d.kind, name: d.name } });
      return r;
    });
  }

  @Patch("referrers/:id") @RequirePermission("prospect.write")
  setReferrerStatus(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { status } = parseZod(z.object({ status: z.enum(["active", "suspended"]) }), body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const r = await tx.referrer.findUnique({ where: { id } }); if (!r) throw new NotFoundException();
      await tx.referrer.update({ where: { id }, data: { status } });
      await this.audit.record(tx, ctx, { action: "crm.referrer_status", entity: "Referrer", entityId: id, before: { status: r.status }, after: { status } });
      return { id, status };
    });
  }

  @Post("referrals") @RequirePermission("prospect.write")
  createReferral(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parseZod(Referral, body);
    const err = validateRule({ type: d.ruleType, value: d.ruleValue }); if (err) throw new BadRequestException(`Règle de commission : ${err}`);
    if (d.ruleType === "percent_of_collected_net" && d.durationMonths < 1) throw new BadRequestException("Une commission proportionnelle exige une durée en mois (1 à 60)");
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const [p, r] = await Promise.all([tx.prospect.findFirst({ where: { id: d.prospectId, archivedAt: null } }), tx.referrer.findUnique({ where: { id: d.referrerId } })]);
      if (!p || !r) throw new NotFoundException();
      if (r.status !== "active") throw new ConflictException("Apporteur suspendu");
      if (p.stage === "converted" || p.stage === "lost") throw new ConflictException(`Parrainage impossible sur un prospect « ${p.stage} »`);
      if (await tx.referral.findUnique({ where: { prospectId: d.prospectId } })) throw new ConflictException("Ce prospect a déjà un parrainage");
      const ref = await tx.referral.create({ data: { tenantId: ctx.tenantId, referrerId: d.referrerId, prospectId: d.prospectId, ruleType: d.ruleType, ruleValue: d.ruleValue, durationMonths: d.ruleType === "fixed_per_conversion" ? 0 : d.durationMonths, createdBy: ctx.userId } });
      await this.audit.record(tx, ctx, { action: "crm.referral_created", entity: "Referral", entityId: ref.id, after: { referrer: r.name, prospect: p.name, rule: d.ruleType, value: d.ruleValue, durationMonths: ref.durationMonths } });
      return { ...ref, ruleValue: ref.ruleValue.toString() };
    });
  }

  @Get("commissions") @RequirePermission("commission.read")
  commissions(@Req() { ctx }: R, @Query("status") status?: string) {
    if (status && !["accrued", "approved", "paid", "cancelled"].includes(status)) throw new BadRequestException("Statut inconnu");
    return this.prisma.forTenant(ctx.tenantId, async tx => (await tx.commission.findMany({ where: status ? { status } : {}, orderBy: { createdAt: "desc" }, take: 200, include: { referral: { include: { referrer: { select: { name: true } } } } } }))
      .map(c => ({ id: c.id, referrer: c.referral.referrer.name, referralId: c.referralId, sourceType: c.sourceType, amount: c.amount.toString(), status: c.status, createdAt: c.createdAt, paidAt: c.paidAt, paidReference: c.paidReference, rule: `${c.referral.ruleType === "percent_of_collected_net" ? `${c.referral.ruleValue} % du HT encaissé pendant ${c.referral.durationMonths} mois` : `forfait ${c.referral.ruleValue} €`}` })));
  }

  @Post("commissions/:id/transition") @RequirePermission("commission.read")
  commissionEvent(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parseZod(z.object({ event: z.enum(["approve", "pay", "cancel"]), reference: z.string().min(3).max(100).optional() }), body);
    if (d.event === "pay" ? !can(ctx.roles, "commission.pay") : !can(ctx.roles, "commission.approve")) throw new ForbiddenException("Action non autorisée pour votre rôle");
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const c = await tx.commission.findUnique({ where: { id }, include: { referral: true } }); if (!c) throw new NotFoundException();
      if (d.event === "pay" && !d.reference) throw new BadRequestException("Référence du paiement obligatoire");
      const next = applyAsAnyRole(commissionWorkflow, c.status as CommissionState, d.event, ctx.userId, ctx.roles, { actorUserId: ctx.userId, referralCreatedBy: c.referral.createdBy });
      const r = await tx.commission.updateMany({ where: { id, status: c.status }, data: { status: next, ...(d.event === "approve" ? { approvedBy: ctx.userId, approvedAt: new Date() } : {}), ...(d.event === "pay" ? { paidAt: new Date(), paidReference: d.reference } : {}) } });
      if (r.count !== 1) throw new ConflictException("Commission modifiée entre-temps");
      if (d.event === "pay") await this.ledger.post(tx, { tenantId: ctx.tenantId, key: `commission.pay:${id}`, label: `Commission apporteur (${d.reference})`, valueDate: parisToday(), sourceType: "commission", sourceId: id, lines: [{ account: ACCOUNTS.commissions, debit: c.amount.toString() }, { account: ACCOUNTS.banque, credit: c.amount.toString() }] });
      await this.audit.record(tx, ctx, { action: `crm.commission_${d.event}`, entity: "Commission", entityId: id, before: { status: c.status }, after: { status: next, amount: c.amount.toString(), reference: d.reference } });
      return tx.commission.findUniqueOrThrow({ where: { id } }).then(x => ({ ...x, amount: x.amount.toString() }));
    });
  }

  // ---------- accords-cadres ----------
  @Get("agreements") @RequirePermission("prospect.read")
  agreements(@Req() { ctx }: R, @Query("expiringWithin") within?: string) {
    const days = within === undefined ? 60 : Number(within); if (!Number.isInteger(days) || days < 0 || days > 730) throw new BadRequestException("expiringWithin : entier de 0 à 730");
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const rows = await tx.frameworkAgreement.findMany({ orderBy: { endDate: "asc" }, take: 200, include: { rates: true } });
      const cos = await tx.company.findMany({ where: { id: { in: rows.map(r => r.companyId) } }, select: { id: true, name: true } }); const today = parisToday();
      return rows.map(a => { const end = a.endDate.toISOString().slice(0, 10), left = Math.round((Date.parse(end) - Date.parse(today)) / 86400000); const effective = a.status === "active" && left < 0 ? "expired" : a.status;
        return { id: a.id, company: cos.find(c => c.id === a.companyId)?.name, companyId: a.companyId, name: a.name, startDate: a.startDate.toISOString().slice(0, 10), endDate: end, status: a.status, effectiveStatus: effective, daysLeft: left, expiringSoon: effective === "active" && left <= days, paymentTermsDays: a.paymentTermsDays, rates: a.rates.map(r => ({ id: r.id, label: r.label, maxDailyRate: r.maxDailyRate.toString() })) }; });
    });
  }

  @Post("agreements") @RequirePermission("prospect.write")
  createAgreement(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parseZod(Agreement, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      if (!(await tx.company.findUnique({ where: { id: d.companyId } }))) throw new BadRequestException("Entreprise introuvable");
      if (new Set(d.rates.map(r => r.label.toLowerCase())).size !== d.rates.length) throw new BadRequestException("Libellés de tarifs en double");
      const a = await tx.frameworkAgreement.create({ data: { tenantId: ctx.tenantId, companyId: d.companyId, name: d.name, startDate: new Date(d.startDate), endDate: new Date(d.endDate), paymentTermsDays: d.paymentTermsDays, notes: d.notes, createdBy: ctx.userId, rates: { create: d.rates.map(r => ({ tenantId: ctx.tenantId, label: r.label, maxDailyRate: r.maxDailyRate })) } }, include: { rates: true } });
      await this.audit.record(tx, ctx, { action: "crm.agreement_created", entity: "FrameworkAgreement", entityId: a.id, after: { name: d.name, rates: d.rates.length } });
      return a;
    });
  }

  @Post("agreements/:id/transition") @RequirePermission("prospect.write")
  agreementEvent(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { event } = parseZod(z.object({ event: z.enum(["activate", "terminate"]) }), body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const a = await tx.frameworkAgreement.findUnique({ where: { id } }); if (!a) throw new NotFoundException();
      const ok = (event === "activate" && a.status === "draft") || (event === "terminate" && a.status === "active"); if (!ok) throw new BadRequestException(`Transition impossible depuis « ${a.status} »`);
      const next = event === "activate" ? "active" : "terminated";
      const r = await tx.frameworkAgreement.updateMany({ where: { id, status: a.status }, data: { status: next } }); if (r.count !== 1) throw new ConflictException("Accord modifié entre-temps");
      await this.audit.record(tx, ctx, { action: `crm.agreement_${event}`, entity: "FrameworkAgreement", entityId: id, before: { status: a.status }, after: { status: next } });
      return { id, status: next };
    });
  }

  // ---------- imports ----------
  @Post("imports/preview") @RequirePermission("prospect.write")
  preview(@Req() { ctx }: R, @Body() body: unknown) { const d = parseZod(Import, body); return this.prisma.forTenant(ctx.tenantId, tx => this.crm.previewImport(tx, ctx, d)); }

  @Get("imports") @RequirePermission("prospect.read")
  imports(@Req() { ctx }: R) { return this.prisma.forTenant(ctx.tenantId, async tx => (await tx.importJob.findMany({ orderBy: { createdAt: "desc" }, take: 50 })).map(j => this.crm.importView(j))); }

  @Get("imports/:id") @RequirePermission("prospect.read")
  importOne(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) { return this.prisma.forTenant(ctx.tenantId, async tx => { const j = await tx.importJob.findUnique({ where: { id } }); if (!j) throw new NotFoundException(); return this.crm.importView(j, true); }); }

  @Post("imports/:id/commit") @RequirePermission("prospect.write")
  commit(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) { return this.prisma.forTenant(ctx.tenantId, tx => this.crm.commitImport(tx, ctx, id)); }

  @Post("imports/:id/cancel") @RequirePermission("prospect.write")
  cancelImport(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) {
    return this.prisma.forTenant(ctx.tenantId, async tx => { const r = await tx.importJob.updateMany({ where: { id, status: "previewed" }, data: { status: "cancelled" } }); if (r.count !== 1) throw new ConflictException("Seul un aperçu non validé peut être abandonné"); await this.audit.record(tx, ctx, { action: "crm.import_cancelled", entity: "ImportJob", entityId: id }); return { id, status: "cancelled" }; });
  }

  @Post("imports/:id/rollback") @RequirePermission("prospect.write")
  rollback(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) { return this.prisma.forTenant(ctx.tenantId, tx => this.crm.rollbackImport(tx, ctx, id)); }

  // ---------- simulation ----------
  @Post("simulations") @RequirePermission("prospect.write")
  simulate(@Req() { ctx }: R, @Body() body: unknown) { const d = parseZod(Sim, body); return this.prisma.forTenant(ctx.tenantId, tx => this.crm.simulate(tx, ctx, d)); }
}
void CAMPAIGN_STATES; void ({} as Tx);
