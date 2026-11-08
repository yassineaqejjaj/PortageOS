import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException } from "@nestjs/common";
import Decimal from "decimal.js";
import { leaveBalance } from "@portage/domain";
import { PrismaService, Tx } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext } from "./auth.guard";
import { ParametersService } from "./parameters.service";
import { InvoicesService } from "./invoices.service";
import { TimesheetsService } from "./timesheets.service";
import { LeavesService } from "./leaves.service";
import { can } from "./permissions";
import { parisToday } from "./workflow";
import { AGENTS, AgentDef, PlaybookDef, assertToolAllowed, TOOLS } from "./agents.registry";

export class BudgetError extends Error {}
export class ToolDenied extends Error {}
type Source = { entity: string; id: string; label?: string };
type Finding = { severity: "info" | "warning" | "blocker"; text: string; sources: Source[]; uncertain?: boolean };
const SECOND_APPROVAL_KEY = "ai.second_approval_threshold_eur";

interface Env { call(tool: string, input: unknown): Promise<any>; propose(tool: string, input: { timesheetId: string }): Promise<boolean>; findings: Finding[]; }

@Injectable()
export class AgentsService {
  constructor(private prisma: PrismaService, private audit: AuditService, private params: ParametersService, private invoices: InvoicesService, private timesheets: TimesheetsService, private leaves: LeavesService) {}

  async config(tx: Tx, tenantId: string, agentKey: string) {
    const c = await tx.agentConfig.findUnique({ where: { tenantId_agentKey: { tenantId, agentKey } } });
    return { enabled: c?.enabled ?? true, maxToolCallsPerRun: c?.maxToolCallsPerRun ?? 50, maxRunsPerDay: c?.maxRunsPerDay ?? 20 };
  }

  // ---------- outils de lecture (exécutés avec les droits de l'utilisateur qui lance l'agent) ----------
  private async readTool(tx: Tx, ctx: RequestContext, name: string, input: any): Promise<unknown> {
    switch (name) {
      case "read_timesheets_status": {
        const rows = await tx.timesheet.findMany({ where: input.period ? { period: input.period } : { status: { in: ["submitted", "client_approved", "client_rejected"] } }, include: { mission: { include: { consultant: true } }, lines: true }, take: 200 });
        return rows.map(t => ({ id: t.id, period: t.period, status: t.status, consultant: `${t.mission.consultant.firstName} ${t.mission.consultant.lastName}`, days: t.lines.reduce((s, l) => s.plus(l.quantity.toString()), new Decimal(0)).toString() }));
      }
      case "read_expenses_pending": return (await tx.expenseClaim.findMany({ where: { status: "submitted" }, take: 200 })).map(c => ({ id: c.id, title: c.title, total: c.total.toString() }));
      case "read_leaves_pending": return (await tx.leaveRequest.findMany({ where: { status: "submitted" }, take: 200 })).map(l => ({ id: l.id, type: l.type, start: l.startDate.toISOString().slice(0, 10), end: l.endDate.toISOString().slice(0, 10), days: l.days.toString() }));
      case "read_validated_timesheets_uninvoiced": {
        const rows = await tx.timesheet.findMany({ where: { status: "validated", invoice: null }, include: { mission: { include: { consultant: true } } }, take: 100 });
        const out = [];
        for (const t of rows) { const p = await this.invoices.preview(tx, t.id); out.push({ id: t.id, period: t.period, consultant: `${t.mission.consultant.firstName} ${t.mission.consultant.lastName}`, days: p.days.toString(), gross: p.totals.gross.amount.toFixed(2) }); }
        return out;
      }
      case "read_consultants_onboarding": return (await tx.consultant.findMany({ where: { status: "onboarding" }, include: { tasks: true }, take: 200 })).map(c => ({ id: c.id, name: `${c.firstName} ${c.lastName}`, missing: c.tasks.filter(t => t.required && !t.doneAt).map(t => t.label) }));
      case "read_contracts_pending": {
        const before = new Date(Date.now() - input.olderThanDays * 86400_000);
        return (await tx.contract.findMany({ where: { status: { in: ["draft", "sent"] }, createdAt: { lte: before } }, select: { id: true, kind: true, status: true, createdAt: true }, take: 200 })).map(c => ({ id: c.id, kind: c.kind, status: c.status, createdAt: c.createdAt.toISOString().slice(0, 10) }));
      }
      case "read_my_summary": {
        if (!ctx.consultantId) throw new ToolDenied("Compte non rattaché à un dossier consultant");
        const adj = await tx.leaveAdjustment.findMany({ where: { consultantId: ctx.consultantId }, select: { days: true } });
        const used = await tx.leaveRequest.findMany({ where: { consultantId: ctx.consultantId, type: "paid_leave", status: "approved" }, select: { days: true } });
        const ts = await tx.timesheet.groupBy({ by: ["status"], where: { mission: { consultantId: ctx.consultantId } }, _count: true });
        const ex = await tx.expenseClaim.groupBy({ by: ["status"], where: { consultantId: ctx.consultantId }, _count: true });
        return { leaveBalance: leaveBalance(adj.map(a => a.days.toString()), used.map(u => u.days.toString())), timesheets: Object.fromEntries(ts.map(r => [r.status, r._count])), expenses: Object.fromEntries(ex.map(r => [r.status, r._count])) };
      }
    }
    throw new Error(`Outil de lecture inconnu : ${name}`);
  }

  // ---------- exécution d'un playbook ----------
  async start(ctx: RequestContext, agent: AgentDef, pb: PlaybookDef, rawParams: unknown) {
    const parsed = pb.params.safeParse(rawParams ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i: { message: string }) => i.message).join("; "));
    const params = parsed.data as Record<string, unknown>;
    if (!agent.available) throw new ConflictException(agent.unavailableReason ?? "Agent indisponible");
    if (!pb.permissions.every(p => can(ctx.roles, p))) throw new ForbiddenException("Permissions insuffisantes pour ce playbook");
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const cfg = await this.config(tx, ctx.tenantId, agent.key);
      if (!cfg.enabled) throw new ForbiddenException("Agent désactivé par l'administrateur (coupe-circuit)");
      const startOfDay = new Date(`${parisToday()}T00:00:00Z`);
      if ((await tx.agentRun.count({ where: { agentKey: agent.key, startedAt: { gte: startOfDay } } })) >= cfg.maxRunsPerDay) throw new HttpException("Budget quotidien d'exécutions atteint pour cet agent", 429);
      const run = await tx.agentRun.create({ data: { tenantId: ctx.tenantId, agentKey: agent.key, playbook: pb.key, params: params as object, createdBy: ctx.userId, usage: { provider: "none", model: null, inputTokens: 0, outputTokens: 0, costEur: 0 } } });
      let calls = 0, proposals = 0, skipped = 0; const findings: Finding[] = [];
      const env: Env = {
        findings,
        call: async (tool, input) => {
          const def = assertToolAllowed(agent.key, tool);
          if (def.kind !== "read") throw new Error("call() est réservé aux outils de lecture");
          if (!can(ctx.roles, def.permission)) { await tx.agentToolCall.create({ data: { tenantId: ctx.tenantId, runId: run.id, tool, kind: "read", input: (input ?? {}) as object, status: "denied" } }); throw new ToolDenied(`Permission manquante pour ${tool}`); }
          if (calls >= cfg.maxToolCallsPerRun) throw new BudgetError(`Budget d'appels d'outils dépassé (${cfg.maxToolCallsPerRun})`);
          const v = def.input.safeParse(input ?? {}); if (!v.success) throw new Error(`Arguments invalides pour ${tool}`);
          calls++;
          const out = await this.readTool(tx, ctx, tool, v.data);
          await tx.agentToolCall.create({ data: { tenantId: ctx.tenantId, runId: run.id, tool, kind: "read", input: v.data as object, output: { count: Array.isArray(out) ? out.length : undefined, data: out } as object, status: "ok" } });
          return out;
        },
        propose: async (tool, input) => {
          const def = assertToolAllowed(agent.key, tool);
          if (def.kind !== "write") throw new Error("propose() est réservé aux outils d'écriture");
          if (calls >= cfg.maxToolCallsPerRun) throw new BudgetError(`Budget d'appels d'outils dépassé (${cfg.maxToolCallsPerRun})`);
          const v = def.input.safeParse(input); if (!v.success) throw new Error(`Arguments invalides pour ${tool}`);
          const { timesheetId } = v.data as { timesheetId: string };
          const dup = (await tx.agentProposal.findMany({ where: { tool, status: { in: ["pending", "approved"] } } })).some(p => (p.input as { timesheetId?: string }).timesheetId === timesheetId);
          if (dup) { skipped++; return false; }
          calls++;
          let summary: string, risk: Decimal | null = null;
          if (tool === "propose_invoice") { const p = await this.invoices.preview(tx, timesheetId); risk = p.totals.gross.amount; summary = `Créer une facture brouillon de ${risk.toFixed(2)} € TTC pour ${p.days.toString()} jour(s)`; }
          else { const t = await tx.timesheet.findUniqueOrThrow({ where: { id: timesheetId }, include: { mission: { include: { consultant: true } } } }); summary = `Valider en interne le CRA ${t.period} de ${t.mission.consultant.firstName} ${t.mission.consultant.lastName}`; }
          const threshold = await this.params.at(tx, SECOND_APPROVAL_KEY, parisToday());
          const required = risk && threshold && risk.gte(threshold.value) ? 2 : 1;
          await tx.agentProposal.create({ data: { tenantId: ctx.tenantId, runId: run.id, tool, input: v.data as object, summary, riskAmount: risk?.toFixed(2), requiredApprovals: required } });
          await tx.agentToolCall.create({ data: { tenantId: ctx.tenantId, runId: run.id, tool, kind: "write", input: v.data as object, output: { proposed: true, requiredApprovals: required } as object, status: "proposed" } });
          proposals++; return true;
        },
      };
      let status = "completed", error: string | undefined;
      try { await this.playbook(pb.key, env, params); }
      catch (e) {
        if (e instanceof BudgetError || e instanceof ToolDenied) { status = "failed"; error = e.message; }
        else throw e;
      }
      if (status === "completed" && proposals > 0) status = "awaiting_approval";
      const summary = { findings, proposals, skippedDuplicates: skipped, note: "Playbook déterministe (aucun modèle de langage). Les actions proposées ne sont exécutées qu'après approbation humaine." };
      await tx.agentRun.update({ where: { id: run.id }, data: { status, error, toolCallCount: calls, summary: summary as object, finishedAt: status === "awaiting_approval" ? null : new Date() } });
      await this.audit.record(tx, ctx, { action: "agent.run", entity: "AgentRun", entityId: run.id, after: { agent: agent.key, playbook: pb.key, status, calls, proposals } });
      return this.runView(tx, run.id);
    });
  }

  private async playbook(key: string, env: Env, p: Record<string, unknown>) {
    const lbl = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
    if (key === "closing_check") {
      const ts = (await env.call("read_timesheets_status", p.period ? { period: p.period } : {})) as { id: string; period: string; status: string; consultant: string; days: string }[];
      const by = (s: string) => ts.filter(t => t.status === s);
      const waitingClient = by("submitted"), waitingInternal = by("client_approved"), rejected = by("client_rejected");
      const src = (arr: typeof ts): Source[] => arr.map(t => ({ entity: "Timesheet", id: t.id, label: `${t.consultant} ${t.period}` }));
      if (waitingClient.length) env.findings.push({ severity: "blocker", text: `${lbl(waitingClient.length, "CRA attend", "CRA attendent")} la validation du client`, sources: src(waitingClient) });
      if (rejected.length) env.findings.push({ severity: "blocker", text: `${lbl(rejected.length, "CRA refusé", "CRA refusés")} par le client à corriger`, sources: src(rejected) });
      if (waitingInternal.length) env.findings.push({ severity: "warning", text: `${lbl(waitingInternal.length, "CRA approuvé", "CRA approuvés")} par le client en attente de validation interne`, sources: src(waitingInternal) });
      const ex = (await env.call("read_expenses_pending", {})) as { id: string; title: string }[];
      if (ex.length) env.findings.push({ severity: "warning", text: `${lbl(ex.length, "note de frais", "notes de frais")} à approuver`, sources: ex.map(e => ({ entity: "ExpenseClaim", id: e.id, label: e.title })) });
      const lv = (await env.call("read_leaves_pending", {})) as { id: string; type: string; start: string }[];
      if (lv.length) env.findings.push({ severity: "warning", text: `${lbl(lv.length, "demande d'absence", "demandes d'absence")} en attente`, sources: lv.map(l => ({ entity: "LeaveRequest", id: l.id, label: `${l.type} ${l.start}` })) });
      if (!env.findings.length) env.findings.push({ severity: "info", text: "Aucun bloqueur détecté sur les données lues.", sources: [], uncertain: true });
      for (const t of waitingInternal.slice(0, 20)) await env.propose("propose_validate_timesheet", { timesheetId: t.id });
    } else if (key === "invoice_preparation") {
      const rows = (await env.call("read_validated_timesheets_uninvoiced", {})) as { id: string; period: string; consultant: string; days: string; gross: string }[];
      if (!rows.length) env.findings.push({ severity: "info", text: "Aucun CRA validé en attente de facturation.", sources: [], uncertain: true });
      for (const r of rows.slice(0, 20)) { env.findings.push({ severity: "info", text: `CRA ${r.period} de ${r.consultant} : ${r.days} j, facture estimée ${r.gross} € TTC`, sources: [{ entity: "Timesheet", id: r.id, label: `${r.consultant} ${r.period}` }] }); await env.propose("propose_invoice", { timesheetId: r.id }); }
    } else if (key === "completeness_check") {
      const rows = (await env.call("read_consultants_onboarding", {})) as { id: string; name: string; missing: string[] }[];
      for (const r of rows) env.findings.push({ severity: r.missing.length ? "warning" : "info", text: r.missing.length ? `${r.name} : ${r.missing.length} tâche(s) manquante(s) — ${r.missing.join(" ; ")}` : `${r.name} : dossier complet, prêt à activer`, sources: [{ entity: "Consultant", id: r.id, label: r.name }] });
      if (!rows.length) env.findings.push({ severity: "info", text: "Aucun dossier en onboarding.", sources: [], uncertain: true });
    } else if (key === "followup") {
      const rows = (await env.call("read_contracts_pending", { olderThanDays: p.olderThanDays })) as { id: string; kind: string; status: string; createdAt: string }[];
      for (const r of rows) env.findings.push({ severity: "warning", text: `Contrat ${r.kind} « ${r.status} » depuis le ${r.createdAt}`, sources: [{ entity: "Contract", id: r.id }] });
      if (!rows.length) env.findings.push({ severity: "info", text: `Aucun contrat en attente depuis plus de ${p.olderThanDays} jour(s).`, sources: [], uncertain: true });
    } else if (key === "my_summary") {
      const s = (await env.call("read_my_summary", {})) as { leaveBalance: string; timesheets: Record<string, number>; expenses: Record<string, number> };
      env.findings.push({ severity: "info", text: `Solde de congés payés : ${s.leaveBalance} jour(s) (ajustements RH − congés approuvés)`, sources: [{ entity: "LeaveAdjustment", id: "self" }] });
      env.findings.push({ severity: "info", text: `CRA : ${Object.entries(s.timesheets).map(([k, v]) => `${v} ${k}`).join(", ") || "aucun"}`, sources: [{ entity: "Timesheet", id: "self" }] });
      env.findings.push({ severity: "info", text: `Notes de frais : ${Object.entries(s.expenses).map(([k, v]) => `${v} ${k}`).join(", ") || "aucune"}`, sources: [{ entity: "ExpenseClaim", id: "self" }] });
    } else throw new Error(`Playbook inconnu : ${key}`);
  }

  async runView(tx: Tx, id: string) {
    const r = await tx.agentRun.findUnique({ where: { id }, include: { toolCalls: { orderBy: { createdAt: "asc" }, select: { id: true, tool: true, kind: true, status: true, input: true, createdAt: true } }, proposals: { orderBy: { createdAt: "asc" }, include: { approvals: { orderBy: { createdAt: "asc" } } } } } });
    if (!r) throw new NotFoundException();
    return { id: r.id, agentKey: r.agentKey, playbook: r.playbook, status: r.status, error: r.error, createdBy: r.createdBy, startedAt: r.startedAt, finishedAt: r.finishedAt, toolCallCount: r.toolCallCount, usage: r.usage, summary: r.summary,
      toolCalls: r.toolCalls, proposals: r.proposals.map(p => ({ id: p.id, tool: p.tool, input: p.input, summary: p.summary, riskAmount: p.riskAmount?.toString() ?? null, requiredApprovals: p.requiredApprovals, status: p.status, error: p.error, result: p.result, approvals: p.approvals.map(a => ({ userId: a.userId, decision: a.decision, comment: a.comment, at: a.createdAt })) })) };
  }

  // ---------- décisions humaines ----------
  async decide(ctx: RequestContext, proposalId: string, decision: "approve" | "reject", comment?: string) {
    const outcome = await this.prisma.forTenant(ctx.tenantId, async tx => {
      await tx.$queryRaw`SELECT id FROM "AgentProposal" WHERE id = ${proposalId} FOR UPDATE`; // sérialise les décisions concurrentes
      const p = await tx.agentProposal.findUnique({ where: { id: proposalId }, include: { run: true, approvals: true } });
      if (!p) throw new NotFoundException();
      const def = TOOLS[p.tool]; if (!def || def.kind !== "write") throw new BadRequestException("Proposition invalide");
      if (!can(ctx.roles, def.permission)) throw new ForbiddenException("Vous n'avez pas le droit d'effectuer l'action sous-jacente");
      if (p.run.status === "cancelled") throw new ConflictException("Exécution annulée");
      if (p.status !== "pending") throw new ConflictException(`Proposition déjà ${p.status}`);
      if (p.approvals.some(a => a.userId === ctx.userId)) throw new ConflictException("Vous avez déjà décidé sur cette proposition");
      if (decision === "reject" && (!comment || comment.trim().length < 3)) throw new BadRequestException("Motif de refus obligatoire");
      await tx.agentApproval.create({ data: { tenantId: ctx.tenantId, proposalId, userId: ctx.userId, decision, comment: comment?.trim() } });
      let toExecute = false;
      if (decision === "reject") await tx.agentProposal.update({ where: { id: proposalId }, data: { status: "rejected", decidedAt: new Date() } });
      else if (p.approvals.filter(a => a.decision === "approve").length + 1 >= p.requiredApprovals) { await tx.agentProposal.update({ where: { id: proposalId }, data: { status: "approved", decidedAt: new Date() } }); toExecute = true; }
      await this.audit.record(tx, ctx, { action: `agent.proposal_${decision}`, entity: "AgentProposal", entityId: proposalId, after: { tool: p.tool, comment, approvals: p.approvals.length + 1, required: p.requiredApprovals } });
      if (!toExecute) await this.maybeFinish(tx, p.runId);
      return { toExecute, tool: p.tool, input: p.input as { timesheetId: string }, runId: p.runId };
    });
    if (outcome.toExecute) await this.execute(ctx, proposalId, outcome);
    return this.prisma.forTenant(ctx.tenantId, tx => this.runView(tx, outcome.runId));
  }

  /** Exécution après approbation, avec les droits de l'approbateur final; échec journalisé, jamais de relance automatique. */
  private async execute(ctx: RequestContext, proposalId: string, o: { tool: string; input: { timesheetId: string }; runId: string }) {
    let result: unknown, error: string | undefined;
    try {
      result = await this.prisma.forTenant(ctx.tenantId, async tx => {
        if (o.tool === "propose_validate_timesheet") return this.timesheets.transition(tx, ctx, o.input.timesheetId, "validate", undefined, ["validate"], {});
        if (o.tool === "propose_invoice") { const inv = await this.invoices.createDraft(tx, ctx, o.input.timesheetId); return { invoiceId: inv.id, gross: inv.gross.toString() }; }
        throw new Error("Outil inconnu");
      });
    } catch (e) { error = e instanceof HttpException ? JSON.stringify(e.getResponse()) : (e as Error).message; }
    await this.prisma.forTenant(ctx.tenantId, async tx => {
      await tx.agentProposal.update({ where: { id: proposalId }, data: error ? { status: "failed", error } : { status: "executed", result: result as object } });
      await this.audit.record(tx, ctx, { action: error ? "agent.proposal_failed" : "agent.proposal_executed", entity: "AgentProposal", entityId: proposalId, after: { tool: o.tool, error } });
      await this.maybeFinish(tx, o.runId);
    });
  }

  private async maybeFinish(tx: Tx, runId: string) {
    const open = await tx.agentProposal.count({ where: { runId, status: { in: ["pending", "approved"] } } });
    if (open === 0) await tx.agentRun.updateMany({ where: { id: runId, status: "awaiting_approval" }, data: { status: "completed", finishedAt: new Date() } });
  }

  async cancel(ctx: RequestContext, runId: string) {
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const r = await tx.agentRun.findUnique({ where: { id: runId } });
      if (!r) throw new NotFoundException();
      if (r.createdBy !== ctx.userId && !can(ctx.roles, "agent.admin")) throw new ForbiddenException("Seul l'initiateur ou un administrateur peut annuler");
      if (r.status !== "awaiting_approval" && r.status !== "running") throw new ConflictException(`Exécution déjà ${r.status}`);
      await tx.agentProposal.updateMany({ where: { runId, status: "pending" }, data: { status: "rejected", decidedAt: new Date(), error: "Exécution annulée" } });
      await tx.agentRun.update({ where: { id: runId }, data: { status: "cancelled", finishedAt: new Date() } });
      await this.audit.record(tx, ctx, { action: "agent.cancel", entity: "AgentRun", entityId: runId });
      return this.runView(tx, runId);
    });
  }

  agents() { return AGENTS; }
}
