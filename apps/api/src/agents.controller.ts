import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put, Req } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext, RequirePermission } from "./auth.guard";
import { AgentsService } from "./agents.service";
import { AGENTS, LLM_STATUS, agentByKey } from "./agents.registry";
import { parisToday, parseZod } from "./workflow";

const Run = z.object({ agentKey: z.string().max(40), playbook: z.string().max(60), params: z.record(z.unknown()).optional() });
const SelfRun = z.object({ playbook: z.literal("my_summary") });
const Config = z.object({ enabled: z.boolean(), maxToolCallsPerRun: z.number().int().min(1).max(500), maxRunsPerDay: z.number().int().min(1).max(1000) });
const Decision = z.object({ decision: z.enum(["approve", "reject"]), comment: z.string().max(500).optional() });
type R = { ctx: RequestContext };

@Controller()
export class AgentsController {
  constructor(private prisma: PrismaService, private audit: AuditService, private svc: AgentsService) {}

  @Get("agents") @RequirePermission("agent.read")
  catalog(@Req() { ctx }: R) {
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const startOfDay = new Date(`${parisToday()}T00:00:00Z`);
      const agents = await Promise.all(AGENTS.map(async a => ({
        key: a.key, name: a.name, description: a.description, available: a.available, unavailableReason: a.unavailableReason, allowedTools: a.allowedTools,
        playbooks: a.playbooks.map(p => ({ key: p.key, label: p.label, description: p.description, permissions: p.permissions, selfService: !!p.selfService })),
        config: await this.svc.config(tx, ctx.tenantId, a.key), runsToday: await tx.agentRun.count({ where: { agentKey: a.key, startedAt: { gte: startOfDay } } }),
      })));
      return { orchestrator: "Moteur d'exécution persistant : plan, appels d'outils journalisés, budgets, coupe-circuit, approbations humaines.", llm: LLM_STATUS, agents };
    });
  }

  @Put("agents/:key/config") @RequirePermission("agent.admin")
  setConfig(@Req() { ctx }: R, @Param("key") key: string, @Body() body: unknown) {
    if (!agentByKey(key)) throw new NotFoundException();
    const d = parseZod(Config, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const before = await this.svc.config(tx, ctx.tenantId, key);
      await tx.agentConfig.upsert({ where: { tenantId_agentKey: { tenantId: ctx.tenantId, agentKey: key } }, update: d, create: { tenantId: ctx.tenantId, agentKey: key, ...d } });
      await this.audit.record(tx, ctx, { action: "agent.config", entity: "AgentConfig", entityId: key, before, after: d });
      return d;
    });
  }

  @Post("agent-runs") @RequirePermission("agent.run")
  run(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parseZod(Run, body);
    const a = agentByKey(d.agentKey); const pb = a?.playbooks.find(p => p.key === d.playbook);
    if (!a || !pb) throw new BadRequestException("Agent ou playbook inconnu");
    if (pb.selfService) throw new BadRequestException("Ce playbook est réservé au portail consultant");
    return this.svc.start(ctx, a, pb, d.params);
  }

  /** Consultant Agent : uniquement la synthèse du dossier de l'utilisateur connecté. */
  @Post("me/agent-runs") @RequirePermission("portal.self")
  mine(@Req() { ctx }: R, @Body() body: unknown) {
    parseZod(SelfRun, body);
    const a = agentByKey("consultant")!;
    return this.svc.start(ctx, a, a.playbooks[0]!, {});
  }

  @Get("agent-runs") @RequirePermission("agent.read")
  list(@Req() { ctx }: R) {
    return this.prisma.forTenant(ctx.tenantId, async tx => (await tx.agentRun.findMany({ orderBy: { startedAt: "desc" }, take: 50, include: { proposals: { select: { status: true } } } }))
      .map(r => ({ id: r.id, agentKey: r.agentKey, playbook: r.playbook, status: r.status, startedAt: r.startedAt, proposals: r.proposals.length, pending: r.proposals.filter(p => p.status === "pending").length })));
  }

  @Get("agent-runs/:id") @RequirePermission("agent.read")
  get(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) { return this.prisma.forTenant(ctx.tenantId, tx => this.svc.runView(tx, id)); }

  @Post("agent-runs/:id/cancel") @RequirePermission("agent.run")
  cancel(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) { return this.svc.cancel(ctx, id); }

  @Post("agent-proposals/:id/decision") @RequirePermission("agent.approve")
  decide(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parseZod(Decision, body);
    return this.svc.decide(ctx, id, d.decision, d.comment);
  }
}
