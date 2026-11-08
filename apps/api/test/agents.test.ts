import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { INestApplication } from "@nestjs/common";
import { createApp } from "../src/main";
import { hashPassword } from "../src/password";
import { resetLoginThrottle } from "../src/auth.controller";
import { assertToolAllowed } from "../src/agents.registry";

const admin = new PrismaClient();
let app: INestApplication;
const PW = "correct-horse-battery";
const run = Date.now().toString(36) + "a";
let t1: string, t2: string, consId: string, onbId: string, missionId: string;
const tok: Record<string, string> = {}; const uid: Record<string, string> = {};
const S = (n: string) => `${n}-${run}`;
const srv = () => request(app.getHttpServer());
const H = (k: string) => ({ Authorization: `Bearer ${tok[k]}` });
const SRC = "Source de test automatisé (jeu de test, valeur fictive)";

async function mk(key: string, tenantId: string, roles: string[], consultantId?: string) {
  const u = await admin.user.create({ data: { email: `${key.toLowerCase()}-${run}@x.test`, passwordHash: await hashPassword(PW) } });
  uid[key] = u.id; await admin.membership.create({ data: { userId: u.id, tenantId, roles, consultantId } });
}
async function login(key: string, slug: string) { tok[key] = (await srv().post("/auth/login").send({ email: `${key.toLowerCase()}-${run}@x.test`, password: PW, tenantSlug: slug })).body.accessToken; }
async function ts(period: string, status: string, days = 2) {
  const t = await admin.timesheet.create({ data: { tenantId: t1, missionId, period, status } });
  for (let i = 1; i <= days; i++) await admin.timesheetLine.create({ data: { tenantId: t1, timesheetId: t.id, date: new Date(`${period}-${String(i).padStart(2, "0")}`), quantity: "1" } });
  return t.id;
}
const runAgent = (who: string, agentKey: string, playbook: string, params?: object) => srv().post("/agent-runs").set(H(who)).send({ agentKey, playbook, params });
const decide = (who: string, id: string, decision: string, comment?: string) => srv().post(`/agent-proposals/${id}/decision`).set(H(who)).send({ decision, comment });
const setCfg = (who: string, key: string, c: object) => srv().put(`/agents/${key}/config`).set(H(who)).send(c);
const resetCfg = async (key: string) => { await setCfg("admin", key, { enabled: true, maxToolCallsPerRun: 50, maxRunsPerDay: 1000 }); };

beforeAll(async () => {
  t1 = (await admin.tenant.create({ data: { slug: S("a1"), name: "Agents 1" } })).id;
  t2 = (await admin.tenant.create({ data: { slug: S("a2"), name: "Agents 2" } })).id;
  const co = (await admin.company.create({ data: { tenantId: t1, name: "Client A" } })).id;
  consId = (await admin.consultant.create({ data: { tenantId: t1, firstName: "Cons", lastName: "Un", status: "active" } })).id;
  const cons2 = (await admin.consultant.create({ data: { tenantId: t1, firstName: "Cons", lastName: "Deux", status: "active" } })).id;
  onbId = (await admin.consultant.create({ data: { tenantId: t1, firstName: "Nina", lastName: "Onboarding", status: "onboarding", tasks: { create: [{ tenantId: t1, key: "rc_pro", label: "Attestation RC Pro reçue" }, { tenantId: t1, key: "dpae_done", label: "DPAE effectuée", doneAt: new Date() }] } } })).id;
  missionId = (await admin.mission.create({ data: { tenantId: t1, consultantId: consId, companyId: co, title: "MA", dailyRate: "650.00", vatRate: "20", startDate: new Date("2026-01-01") } })).id;
  await admin.leaveAdjustment.create({ data: { tenantId: t1, consultantId: consId, days: "7", reason: "Solde initial test", createdBy: "seed" } });
  await admin.leaveRequest.create({ data: { tenantId: t1, consultantId: consId, ownerUserId: "u", type: "paid_leave", startDate: new Date("2031-03-03"), endDate: new Date("2031-03-04"), days: "2", status: "submitted" } });
  await admin.expenseClaim.create({ data: { tenantId: t1, consultantId: consId, ownerUserId: "u", title: "Frais en attente", status: "submitted", total: "42" } });
  const tpl = await admin.contractTemplate.create({ data: { tenantId: t1, kind: "service", name: "T", version: 1, body: "x", status: "published", createdBy: "u" } });
  await admin.contract.create({ data: { tenantId: t1, templateId: tpl.id, kind: "service", companyId: co, status: "draft", renderedBody: "x", variableValues: {}, createdBy: "u", createdAt: new Date(Date.now() - 30 * 86400_000) } });
  await mk("admin", t1, ["tenant_admin"]); await mk("ops", t1, ["operations"]); await mk("fin", t1, ["finance"]); await mk("hr", t1, ["hr"]); await mk("dir", t1, ["direction"]); await mk("compl", t1, ["compliance"]);
  await mk("cons", t1, ["consultant"], consId); await mk("cons2", t1, ["consultant"], cons2); await mk("client", t1, ["client_user"]); await mk("admin2", t2, ["tenant_admin"]);
  app = await createApp(); await app.init();
  for (const k of ["admin", "ops", "fin", "hr", "dir", "compl", "cons", "cons2", "client"]) await login(k, S("a1"));
  await login("admin2", S("a2"));
});
beforeEach(() => resetLoginThrottle());
afterAll(async () => { await app.close(); await admin.$disconnect(); });

describe("catalogue et périmètre", () => {
  it("6 agents, Payroll indisponible, LLM non connecté déclaré; accès par rôle", async () => {
    const c = (await srv().get("/agents").set(H("dir"))).body;
    expect(c.agents.map((a: { key: string }) => a.key).sort()).toEqual(["consultant", "contract", "finance", "onboarding", "operations", "payroll"]);
    expect(c.agents.find((a: { key: string }) => a.key === "payroll")).toMatchObject({ available: false });
    expect(c.llm.status).toBe("not_connected");
    expect((await srv().get("/agents").set(H("cons"))).status).toBe(403);
    expect((await srv().get("/agents").set(H("client"))).status).toBe(403);
    expect((await runAgent("ops", "payroll", "x")).status).toBe(400);
    expect((await runAgent("dir", "operations", "closing_check")).status).toBe(403); // direction : lecture seule
  });
  it("liste blanche d'outils par agent (défense en profondeur)", () => {
    expect(() => assertToolAllowed("finance", "propose_validate_timesheet")).toThrow(/non autorisé/);
    expect(() => assertToolAllowed("operations", "propose_invoice")).toThrow(/non autorisé/);
    expect(() => assertToolAllowed("onboarding", "read_expenses_pending")).toThrow(/non autorisé/);
    expect(() => assertToolAllowed("operations", "drop_database")).toThrow(/non autorisé/);
    expect(assertToolAllowed("operations", "read_timesheets_status").kind).toBe("read");
  });
  it("droits du lanceur : un agent n'agit qu'avec les permissions de l'utilisateur", async () => {
    expect((await runAgent("hr", "operations", "closing_check")).status).toBe(403);
    expect((await runAgent("fin", "operations", "closing_check")).status).toBe(403); // finance n'a pas leave.read
    expect((await runAgent("cons", "operations", "closing_check")).status).toBe(403);
    expect((await runAgent("ops", "consultant", "my_summary")).status).toBe(400); // playbook réservé au portail consultant
    expect((await runAgent("hr", "onboarding", "completeness_check", { extra: 1 })).status).toBe(400); // paramètres stricts
    expect((await runAgent("hr", "contract", "followup", { olderThanDays: 999 })).status).toBe(400);
  });
});

describe("agents de lecture, sources et portail consultant", () => {
  it("onboarding et contrats : constats sourcés; consultant : uniquement son dossier", async () => {
    const o = (await runAgent("hr", "onboarding", "completeness_check")).body;
    expect(o.status).toBe("completed"); expect(o.usage.provider).toBe("none");
    const f = o.summary.findings.find((x: { text: string }) => x.text.includes("Nina Onboarding"));
    expect(f.text).toMatch(/1 tâche\(s\) manquante\(s\).*RC Pro/); expect(f.sources[0]).toMatchObject({ entity: "Consultant", id: onbId });
    const c = (await runAgent("hr", "contract", "followup", { olderThanDays: 7 })).body;
    expect(c.summary.findings[0].text).toMatch(/Contrat service « draft »/);
    const mine = (await srv().post("/me/agent-runs").set(H("cons")).send({ playbook: "my_summary" })).body;
    expect(mine.summary.findings[0].text).toMatch(/Solde de congés payés : 7\.0/);
    const other = (await srv().post("/me/agent-runs").set(H("cons2")).send({ playbook: "my_summary" })).body;
    expect(other.summary.findings[0].text).toMatch(/Solde de congés payés : 0\.0/);
    expect(JSON.stringify(other)).not.toContain(consId);
    expect((await srv().post("/me/agent-runs").set(H("ops")).send({ playbook: "my_summary" })).status).toBe(403);
    expect((await srv().post("/me/agent-runs").set(H("cons")).send({ playbook: "closing_check" })).status).toBe(400);
  });
});

describe("clôture : proposer, approuver, exécuter", () => {
  let tsA: string, tsB: string, runId: string, propId: string;
  it("closing_check : bloqueurs sourcés, appels d'outils journalisés, validation proposée (non exécutée)", async () => {
    tsA = await ts("2031-01", "client_approved"); tsB = await ts("2031-02", "submitted");
    const r = await runAgent("ops", "operations", "closing_check");
    expect(r.status).toBe(201); expect(r.body.status).toBe("awaiting_approval"); runId = r.body.id;
    expect(r.body.toolCalls.filter((c: { kind: string; status: string }) => c.kind === "read" && c.status === "ok")).toHaveLength(3);
    expect(r.body.toolCalls.some((c: { kind: string; status: string }) => c.kind === "write" && c.status === "proposed")).toBe(true);
    const texts = r.body.summary.findings.map((x: { text: string }) => x.text).join("|");
    expect(texts).toMatch(/attend la validation du client/); expect(texts).toMatch(/approuvé par le client en attente de validation interne/); expect(texts).toMatch(/note de frais/); expect(texts).toMatch(/demande d'absence/);
    expect(r.body.summary.findings.every((x: { sources: unknown[]; uncertain?: boolean }) => x.sources.length > 0 || x.uncertain)).toBe(true);
    expect(r.body.proposals).toHaveLength(1); propId = r.body.proposals[0].id;
    expect((await admin.timesheet.findUniqueOrThrow({ where: { id: tsA } })).status).toBe("client_approved"); // rien exécuté
    expect(tsB).toBeTruthy();
  });
  it("décision : droits de l'action sous-jacente, motif de refus, approbation exécutée avec les droits de l'approbateur, une seule fois", async () => {
    expect((await decide("fin", propId, "approve")).status).toBe(403); // finance ne peut pas valider un CRA
    expect((await decide("dir", propId, "approve")).status).toBe(403);
    const ok = await decide("ops", propId, "approve");
    expect(ok.status).toBe(201); expect(ok.body.proposals[0]).toMatchObject({ status: "executed" }); expect(ok.body.status).toBe("completed");
    expect((await admin.timesheet.findUniqueOrThrow({ where: { id: tsA } })).status).toBe("validated");
    const ev = await admin.auditEvent.findMany({ where: { tenantId: t1, entityId: tsA, action: "timesheet.validate" } });
    expect(ev[0]?.actorId).toBe(uid.ops); // l'acteur est l'humain, pas l'agent
    expect((await admin.auditEvent.findMany({ where: { entityId: propId, action: "agent.proposal_executed" } })).length).toBe(1);
    expect((await decide("ops", propId, "approve")).status).toBe(409);
  });
  it("relance sans doublon; refus motivé", async () => {
    const e = await ts("2031-03", "client_approved");
    const r1 = (await runAgent("ops", "operations", "closing_check")).body; expect(r1.proposals).toHaveLength(1);
    const r2 = (await runAgent("ops", "operations", "closing_check")).body; expect(r2.proposals).toHaveLength(0); expect(r2.summary.skippedDuplicates).toBe(1);
    expect((await decide("ops", r1.proposals[0].id, "reject")).status).toBe(400);
    const rej = await decide("ops", r1.proposals[0].id, "reject", "CRA à revérifier");
    expect(rej.body.proposals[0].status).toBe("rejected"); expect(rej.body.status).toBe("completed");
    expect((await admin.timesheet.findUniqueOrThrow({ where: { id: e } })).status).toBe("client_approved");
  });
  it("annulation : propositions rejetées, décisions ultérieures refusées, droits d'annulation", async () => {
    await ts("2031-04", "client_approved");
    const r = (await runAgent("ops", "operations", "closing_check")).body;
    expect((await srv().post(`/agent-runs/${r.id}/cancel`).set(H("hr"))).status).toBe(403);
    const c = await srv().post(`/agent-runs/${r.id}/cancel`).set(H("ops"));
    expect(c.body.status).toBe("cancelled"); expect(c.body.proposals[0].status).toBe("rejected");
    expect((await decide("ops", r.proposals[0].id, "approve")).status).toBe(409);
    expect((await srv().post(`/agent-runs/${r.id}/cancel`).set(H("ops"))).status).toBe(409);
  });
});

describe("facturation : montants serveur et approbation à deux niveaux", () => {
  it("niveau 1 : facture brouillon créée après approbation, montant calculé côté serveur; l'opération ne peut pas approuver", async () => {
    const t = await ts("2031-05", "validated");
    const r = (await runAgent("fin", "finance", "invoice_preparation")).body;
    const p = r.proposals.find((x: { input: { timesheetId: string } }) => x.input.timesheetId === t); expect(p.requiredApprovals).toBe(1); expect(p.riskAmount).toBe("1560");
    expect((await decide("ops", p.id, "approve")).status).toBe(403);
    const ok = (await decide("fin", p.id, "approve")).body.proposals.find((x: { id: string }) => x.id === p.id);
    expect(ok.status).toBe("executed");
    const inv = await admin.invoice.findUniqueOrThrow({ where: { timesheetId: t } });
    expect(inv.gross.toString()).toBe("1560"); expect(inv.status).toBe("draft");
    expect((await admin.timesheet.findUniqueOrThrow({ where: { id: t } })).status).toBe("invoiced");
    for (const other of r.proposals.filter((x: { id: string }) => x.id !== p.id)) await decide("fin", other.id, "reject", "Hors périmètre du test");
  });
  it("niveau 2 au-delà du seuil paramétré : deux approbateurs distincts, exécution unique même en concurrence", async () => {
    const d = (await srv().post("/rules/parameters").set(H("compl")).send({ key: "ai.second_approval_threshold_eur", value: "1000", unit: "EUR", validFrom: "2026-01-01", source: SRC })).body;
    expect((await srv().post(`/rules/parameters/${d.id}/approve`).set(H("admin"))).status).toBe(201);
    const t = await ts("2031-06", "validated");
    const r = (await runAgent("fin", "finance", "invoice_preparation")).body;
    const p = r.proposals.find((x: { input: { timesheetId: string } }) => x.input.timesheetId === t);
    expect(p.requiredApprovals).toBe(2);
    const first = (await decide("fin", p.id, "approve")).body.proposals.find((x: { id: string }) => x.id === p.id);
    expect(first.status).toBe("pending"); expect(first.approvals).toHaveLength(1);
    expect(await admin.invoice.count({ where: { timesheetId: t } })).toBe(0);
    expect((await decide("fin", p.id, "approve")).status).toBe(409); // même personne
    const second = (await decide("admin", p.id, "approve")).body.proposals.find((x: { id: string }) => x.id === p.id);
    expect(second.status).toBe("executed"); expect(await admin.invoice.count({ where: { timesheetId: t } })).toBe(1);
    for (const other of r.proposals.filter((x: { id: string; status: string }) => x.id !== p.id && x.status === "pending")) await decide("fin", other.id, "reject", "Hors périmètre du test");
    // concurrence
    const t2id = await ts("2031-07", "validated");
    const r2 = (await runAgent("fin", "finance", "invoice_preparation")).body;
    const q = r2.proposals.find((x: { input: { timesheetId: string } }) => x.input.timesheetId === t2id);
    const both = await Promise.all([decide("fin", q.id, "approve"), decide("admin", q.id, "approve")]);
    expect(both.map(b => b.status)).toEqual([201, 201]);
    expect(await admin.invoice.count({ where: { timesheetId: t2id } })).toBe(1);
    expect((await admin.agentProposal.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("executed");
  });
});

describe("budgets, coupe-circuit, isolation, immuabilité", () => {
  it("budget d'appels, budget quotidien, coupe-circuit; configuration réservée à l'administrateur", async () => {
    expect((await setCfg("ops", "operations", { enabled: false, maxToolCallsPerRun: 5, maxRunsPerDay: 5 })).status).toBe(403);
    expect((await setCfg("admin", "operations", { enabled: true, maxToolCallsPerRun: 0, maxRunsPerDay: 5 })).status).toBe(400);
    await setCfg("admin", "operations", { enabled: true, maxToolCallsPerRun: 2, maxRunsPerDay: 1000 });
    const b = (await runAgent("ops", "operations", "closing_check")).body;
    expect(b.status).toBe("failed"); expect(b.error).toMatch(/Budget d'appels/); expect(b.proposals).toHaveLength(0);
    await setCfg("admin", "operations", { enabled: false, maxToolCallsPerRun: 50, maxRunsPerDay: 1000 });
    expect((await runAgent("ops", "operations", "closing_check")).status).toBe(403);
    await resetCfg("operations");
    await setCfg("admin", "onboarding", { enabled: true, maxToolCallsPerRun: 50, maxRunsPerDay: 1 });
    const used = (await srv().get("/agents").set(H("admin"))).body.agents.find((a: { key: string }) => a.key === "onboarding").runsToday;
    await setCfg("admin", "onboarding", { enabled: true, maxToolCallsPerRun: 50, maxRunsPerDay: Math.max(1, used) });
    expect((await runAgent("hr", "onboarding", "completeness_check")).status).toBe(429);
    await resetCfg("onboarding");
  });
  it("isolation inter-tenant", async () => {
    const list = (await srv().get("/agent-runs").set(H("admin"))).body;
    expect(list.length).toBeGreaterThan(0);
    expect((await srv().get("/agent-runs").set(H("admin2"))).body).toEqual([]);
    expect((await srv().get(`/agent-runs/${list[0].id}`).set(H("admin2"))).status).toBe(404);
    const prop = await admin.agentProposal.findFirst({ where: { tenantId: t1 } });
    expect((await decide("admin2", prop!.id, "approve")).status).toBe(404);
  });
  it("garanties en base : journal d'appels et approbations append-only, proposition figée", async () => {
    const call = await admin.agentToolCall.findFirst({ where: { tenantId: t1 } });
    await expect(admin.agentToolCall.update({ where: { id: call!.id }, data: { tool: "x" } })).rejects.toThrow(/append-only/);
    await expect(admin.agentToolCall.delete({ where: { id: call!.id } })).rejects.toThrow(/append-only/);
    const p = await admin.agentProposal.findFirst({ where: { tenantId: t1, status: "executed" } });
    const ap = await admin.agentApproval.findFirst({ where: { proposalId: p!.id } });
    await expect(admin.agentApproval.update({ where: { id: ap!.id }, data: { decision: "reject" } })).rejects.toThrow(/append-only/);
    await expect(admin.agentProposal.update({ where: { id: p!.id }, data: { input: { timesheetId: "00000000-0000-0000-0000-000000000000" } } })).rejects.toThrow(/immuables/);
    await expect(admin.agentProposal.update({ where: { id: p!.id }, data: { requiredApprovals: 1, riskAmount: "1" } })).rejects.toThrow(/immuables/);
    await expect(admin.agentProposal.delete({ where: { id: p!.id } })).rejects.toThrow(/append-only/);
    await expect(admin.agentApproval.create({ data: { tenantId: t1, proposalId: p!.id, userId: ap!.userId, decision: "approve" } })).rejects.toThrow(); // unicité (proposition, utilisateur)
  });
});
