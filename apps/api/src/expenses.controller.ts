import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put, Req, UnprocessableEntityException } from "@nestjs/common";
import Decimal from "decimal.js";
import { z } from "zod";
import { ExpenseState, expenseFingerprint, expenseWorkflow, mileageAmount } from "@portage/domain";
import { PrismaService, Tx } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext, RequirePermission } from "./auth.guard";
import { ACCOUNTS, LedgerService } from "./ledger.service";
import { ParametersService } from "./parameters.service";
import { can } from "./permissions";
import { NotificationsService } from "./notifications.service";
import { applyAsAnyRole, parisToday, parseZod } from "./workflow";

const Line = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), category: z.enum(["meal", "transport", "hotel", "mileage", "other"]), description: z.string().min(1).max(200),
  amount: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/).optional(), km: z.string().regex(/^\d{1,6}(\.\d)?$/).optional(), receiptRef: z.string().max(200).optional(), rebillable: z.boolean().optional(),
});
const Lines = z.object({ lines: z.array(Line).max(100) });
const Trans = z.object({ event: z.string().min(1).max(30), rejectReason: z.string().max(500).optional() });
const SELF_EVENTS = ["submit", "recall", "reopen"];
type R = { ctx: RequestContext };
const MILEAGE_KEY = "expense.mileage_rate_eur_per_km", MEAL_MAX_KEY = "expense.meal_max_eur";

const view = (c: { id: string; title: string; status: string; total: unknown; rejectReason: string | null; consultantId: string; createdAt: Date; lines: { id: string; date: Date; category: string; description: string; amount: unknown; km: unknown; receiptRef: string | null; rebillable: boolean; policyFlag: string | null }[] }) => ({
  id: c.id, title: c.title, status: c.status, total: String(c.total), rejectReason: c.rejectReason, consultantId: c.consultantId, createdAt: c.createdAt,
  lines: c.lines.map(l => ({ id: l.id, date: l.date.toISOString().slice(0, 10), category: l.category, description: l.description, amount: String(l.amount), km: l.km === null ? null : String(l.km), receiptRef: l.receiptRef, rebillable: l.rebillable, policyFlag: l.policyFlag })),
});

@Controller()
export class ExpensesController {
  constructor(private prisma: PrismaService, private audit: AuditService, private ledger: LedgerService, private params: ParametersService, private notif: NotificationsService) {}

  private async load(tx: Tx, id: string, scopeConsultant?: string) {
    const c = await tx.expenseClaim.findUnique({ where: { id }, include: { lines: { orderBy: { date: "asc" } } } });
    if (!c || (scopeConsultant && c.consultantId !== scopeConsultant)) throw new NotFoundException();
    return c;
  }

  private async putLines(tx: Tx, ctx: RequestContext, claimId: string, scopeConsultant: string, input: z.infer<typeof Lines>["lines"]) {
    const claim = await this.load(tx, claimId, scopeConsultant);
    if (claim.status !== "draft") throw new BadRequestException(`Note non modifiable (statut ${claim.status})`);
    const prepared: { date: string; category: string; description: string; amount: string; km?: string; receiptRef?: string; rebillable: boolean; policyFlag?: string; fingerprint: string }[] = [];
    const seen = new Set<string>();
    for (const l of input) {
      let amount: string; let km: string | undefined;
      if (l.category === "mileage") {
        if (!l.km) throw new BadRequestException("Kilométrage requis");
        const rate = await this.params.at(tx, MILEAGE_KEY, l.date);
        if (!rate) throw new UnprocessableEntityException(`Barème kilométrique non paramétré au ${l.date} (paramètre ${MILEAGE_KEY} approuvé requis)`);
        amount = mileageAmount(l.km, rate.value).amount.toFixed(2); km = l.km; // le montant client est ignoré
      } else {
        if (!l.amount || new Decimal(l.amount).lte(0)) throw new BadRequestException("Montant requis (> 0)");
        amount = new Decimal(l.amount).toFixed(2);
      }
      let policyFlag: string | undefined;
      if (l.category === "meal") {
        const max = await this.params.at(tx, MEAL_MAX_KEY, l.date);
        if (max && new Decimal(amount).gt(max.value)) policyFlag = `Dépasse le plafond repas paramétré (${max.value} ${max.unit})`;
      }
      const fingerprint = expenseFingerprint(claim.consultantId, l.date, l.category, amount);
      if (seen.has(fingerprint)) throw new ConflictException(`Doublon dans la note : ${l.date} ${l.category} ${amount}`);
      seen.add(fingerprint);
      const dup = await tx.expenseLine.findFirst({ where: { fingerprint, claimId: { not: claimId }, claim: { status: { not: "rejected" } } } });
      if (dup) throw new ConflictException(`Doublon probable avec une note existante (${l.date}, ${l.category}, ${amount} €)`);
      prepared.push({ date: l.date, category: l.category, description: l.description, amount, km, receiptRef: l.receiptRef, rebillable: l.rebillable ?? false, policyFlag, fingerprint });
    }
    await tx.expenseLine.deleteMany({ where: { claimId } });
    if (prepared.length) await tx.expenseLine.createMany({ data: prepared.map(p => ({ tenantId: ctx.tenantId, claimId, date: new Date(p.date), category: p.category, description: p.description, amount: p.amount, km: p.km, receiptRef: p.receiptRef, rebillable: p.rebillable, policyFlag: p.policyFlag, fingerprint: p.fingerprint })) });
    const total = prepared.reduce((s, p) => s.plus(p.amount), new Decimal(0)).toFixed(2);
    await tx.expenseClaim.update({ where: { id: claimId }, data: { total } });
    await this.audit.record(tx, ctx, { action: "expense.lines_saved", entity: "ExpenseClaim", entityId: claimId, after: { total, lines: prepared.length } });
    return view(await this.load(tx, claimId));
  }

  private async transition(tx: Tx, ctx: RequestContext, id: string, event: string, reason: string | undefined, scopeConsultant?: string) {
    const c = await this.load(tx, id, scopeConsultant);
    if (event === "reimburse" && !can(ctx.roles, "expense.reimburse")) throw new ForbiddenException("Remboursement réservé à la finance");
    if (["approve", "reject"].includes(event) && !can(ctx.roles, "expense.write")) throw new ForbiddenException("Décision réservée aux rôles internes");
    const next = applyAsAnyRole(expenseWorkflow, c.status as ExpenseState, event, ctx.userId, ctx.roles,
      { lineCount: c.lines.length, missingReceipts: c.lines.filter(l => l.category !== "mileage" && !l.receiptRef).length, ownerUserId: c.ownerUserId, actorUserId: ctx.userId, rejectReason: reason });
    const now = new Date(); const data: Record<string, unknown> = { status: next };
    if (event === "submit") data.submittedAt = now;
    if (["approve", "reject"].includes(event)) { data.decidedAt = now; data.decidedBy = ctx.userId; }
    if (event === "reimburse") data.reimbursedAt = now;
    data.rejectReason = event === "reject" ? reason!.trim() : null;
    const r = await tx.expenseClaim.updateMany({ where: { id, status: c.status }, data });
    if (r.count !== 1) throw new ConflictException("Note modifiée entre-temps");
    if (event === "reimburse") {
      await this.ledger.post(tx, { tenantId: ctx.tenantId, key: `expense.reimburse:${id}`, label: `Remboursement frais : ${c.title}`, valueDate: parisToday(), sourceType: "expense", sourceId: id, consultantId: c.consultantId,
        lines: [{ account: ACCOUNTS.fraisDeplacement, debit: String(c.total) }, { account: ACCOUNTS.banque, credit: String(c.total) }] });
    }
    if (event === "submit") await this.notif.notify(tx, ctx.tenantId, await this.notif.usersByRoles(tx, ctx.tenantId, ["operations", "tenant_admin"]), { type: "expense.submitted", title: `Note de frais à approuver : ${c.title}`, link: "/expenses" }, ctx.userId);
    if (["approve", "reject", "reimburse"].includes(event)) await this.notif.notify(tx, ctx.tenantId, [c.ownerUserId], { type: "expense.decided", title: `Note de frais « ${c.title} » : ${event === "approve" ? "approuvée" : event === "reject" ? "refusée" : "remboursée"}`, body: data.rejectReason as string | undefined ?? undefined, link: "/me/expenses" }, ctx.userId);
    await this.audit.record(tx, ctx, { action: `expense.${event}`, entity: "ExpenseClaim", entityId: id, before: { status: c.status }, after: { status: next, total: String(c.total), reason: data.rejectReason } });
    return view(await this.load(tx, id));
  }

  // ----- portail consultant -----
  private selfId(ctx: RequestContext) { if (!ctx.consultantId) throw new ForbiddenException("Compte non rattaché à un dossier consultant"); return ctx.consultantId; }

  @Get("me/expenses") @RequirePermission("portal.self")
  mine(@Req() { ctx }: R) { const cid = this.selfId(ctx); return this.prisma.forTenant(ctx.tenantId, async tx => (await tx.expenseClaim.findMany({ where: { consultantId: cid }, orderBy: { createdAt: "desc" }, take: 100, include: { lines: true } })).map(view)); }

  @Post("me/expenses") @RequirePermission("portal.self")
  createMine(@Req() { ctx }: R, @Body() body: unknown) {
    const { title } = parseZod(z.object({ title: z.string().min(1).max(150) }), body); const cid = this.selfId(ctx);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const c = await tx.expenseClaim.create({ data: { tenantId: ctx.tenantId, consultantId: cid, ownerUserId: ctx.userId, title }, include: { lines: true } });
      await this.audit.record(tx, ctx, { action: "expense.create", entity: "ExpenseClaim", entityId: c.id, after: { title } });
      return view(c);
    });
  }

  @Put("me/expenses/:id/lines") @RequirePermission("portal.self")
  putMine(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parseZod(Lines, body); const cid = this.selfId(ctx);
    return this.prisma.forTenant(ctx.tenantId, tx => this.putLines(tx, ctx, id, cid, d.lines));
  }

  @Post("me/expenses/:id/transition") @RequirePermission("portal.self")
  moveMine(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parseZod(Trans, body); const cid = this.selfId(ctx);
    if (!SELF_EVENTS.includes(d.event)) throw new ForbiddenException("Action non disponible depuis ce portail");
    return this.prisma.forTenant(ctx.tenantId, tx => this.transition(tx, ctx, id, d.event, d.rejectReason, cid));
  }

  // ----- gestion interne -----
  @Get("expenses") @RequirePermission("expense.read")
  list(@Req() { ctx }: R) { return this.prisma.forTenant(ctx.tenantId, async tx => (await tx.expenseClaim.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { lines: true } })).map(view)); }

  @Post("expenses/:id/transition") @RequirePermission("expense.read")
  move(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parseZod(Trans, body);
    if (!["approve", "reject", "reimburse", "recall", "reopen"].includes(d.event)) throw new BadRequestException("Événement inconnu");
    return this.prisma.forTenant(ctx.tenantId, tx => this.transition(tx, ctx, id, d.event, d.rejectReason));
  }
}
