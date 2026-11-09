import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { INestApplication } from "@nestjs/common";
import { createApp } from "../src/main";
import { hashPassword } from "../src/password";
import { resetLoginThrottle } from "../src/auth.controller";
import { DEFAULT_TASKS } from "../src/consultants.service";

const admin = new PrismaClient();
let app: INestApplication;
const PW = "correct-horse-battery";
const run = Date.now().toString(36) + "r";
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
const addDays = (n: number) => { const d = new Date(`${TODAY}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const addMonths = (n: number) => { const d = new Date(`${TODAY}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
let t1: string, t2: string; const tok: Record<string, string> = {}, uid: Record<string, string> = {};
const S = (n: string) => `${n}-${run}`; const srv = () => request(app.getHttpServer()); const H = (k: string) => ({ Authorization: `Bearer ${tok[k]}` });
async function mk(key: string, tenantId: string, roles: string[], extra: { companyId?: string; consultantId?: string } = {}) {
  const u = await admin.user.create({ data: { email: `${key.toLowerCase()}-${run}@x.test`, passwordHash: await hashPassword(PW) } }); uid[key] = u.id;
  await admin.membership.create({ data: { userId: u.id, tenantId, roles, ...extra } });
}
async function login(key: string, slug: string) { tok[key] = (await srv().post("/auth/login").send({ email: `${key.toLowerCase()}-${run}@x.test`, password: PW, tenantSlug: slug })).body.accessToken; }
const mkProspect = async (who: string, extra: object = {}) => (await srv().post("/prospects").set(H(who)).send({ kind: "consultant", name: `Prospect ${Math.random().toString(36).slice(2, 7)}`, ...extra })).body;
const move = (who: string, id: string, event: string, lostReason?: string) => srv().post(`/prospects/${id}/transition`).set(H(who)).send({ event, lostReason });
const detail = async (who: string, id: string) => (await srv().get(`/crm/prospects/${id}`).set(H(who))).body;

beforeAll(async () => {
  t1 = (await admin.tenant.create({ data: { slug: S("r1"), name: "CRM 1" } })).id; t2 = (await admin.tenant.create({ data: { slug: S("r2"), name: "CRM 2" } })).id;
  await mk("admin", t1, ["tenant_admin"]); await mk("com", t1, ["commerce"]); await mk("com2", t1, ["commerce"]); await mk("fin", t1, ["finance"]); await mk("ops", t1, ["operations"]); await mk("dir", t1, ["direction"]); await mk("compl", t1, ["compliance"]);
  await mk("client", t1, ["client_user"], { companyId: (await admin.company.create({ data: { tenantId: t1, name: "Client R" } })).id }); await mk("admin2", t2, ["tenant_admin"]);
  app = await createApp(); await app.init();
  for (const k of ["admin", "com", "com2", "fin", "ops", "dir", "compl", "client"]) await login(k, S("r1")); await login("admin2", S("r2"));
});
beforeEach(() => resetLoginThrottle());
afterAll(async () => { await app.close(); await admin.$disconnect(); });

describe("scoring explicable", () => {
  it("chaque point est justifié, les pondérations sont configurables par l'administrateur seul", async () => {
    const p = await mkProspect("com", { email: "alice@example.test" });
    let l = (await srv().get("/crm/prospects").set(H("com"))).body.find((x: { id: string }) => x.id === p.id); expect(l).toMatchObject({ score: 10, band: "cold" });
    await srv().post(`/crm/prospects/${p.id}/interactions`).set(H("com")).send({ type: "call", summary: "Premier échange téléphonique" });
    await move("com", p.id, "contact");
    const d = await detail("com", p.id);
    expect(d.score.score).toBe(35); expect(d.score.band).toBe("warm"); // email 10 + contacté 10 + 1 interaction 5 + activité récente 10
    expect(d.score.breakdown.map((b: { key: string; points: number }) => [b.key, b.points])).toEqual([["email", 10], ["contacted", 10], ["interaction", 5], ["recentActivity", 10]]); expect(d.score.disclaimer).toMatch(/décision automatisée/);
    await srv().post("/crm/tasks").set(H("com")).send({ prospectId: p.id, title: "Relancer par email", dueDate: addDays(-2) });
    expect((await detail("com", p.id)).score.score).toBe(30); // tâche en retard −5
        const w = (await srv().get("/crm/scoring").set(H("com"))).body; expect(w.defaults.email).toBe(10);
    expect((await srv().put("/crm/scoring").set(H("com")).send({ weights: { ...w.weights, email: 20 } })).status).toBe(403);
    expect((await srv().put("/crm/scoring").set(H("admin")).send({ weights: { email: 20 } })).status).toBe(400);
    expect((await srv().put("/crm/scoring").set(H("admin")).send({ weights: { ...w.weights, email: 99 } })).status).toBe(400);
    expect((await srv().put("/crm/scoring").set(H("admin")).send({ weights: { ...w.weights, email: 20 } })).status).toBe(200);
    expect((await detail("com", p.id)).score.score).toBe(40);
    await srv().put("/crm/scoring").set(H("admin")).send({ weights: w.defaults });
    const lost = await mkProspect("com", { email: "perdu@example.test" }); await move("com", lost.id, "lose", "Budget gelé"); expect((await detail("com", lost.id)).score.score).toBe(0);
    expect((await admin.auditEvent.count({ where: { tenantId: t1, action: "crm.scoring_updated" } }))).toBe(2);
  });
});

describe("interactions et tâches", () => {
  it("journal non modifiable, droits, isolation; tâches assignées avec notification", async () => {
    const p = await mkProspect("com"); const post = (who: string, id: string, b: object) => srv().post(`/crm/prospects/${id}/interactions`).set(H(who)).send(b);
    expect((await post("com", p.id, { type: "meeting", summary: "Rendez-vous" })).status).toBe(201);
    expect((await post("com", p.id, { type: "meeting", summary: "x" })).status).toBe(400); expect((await post("com", p.id, { type: "alien", summary: "Rendez-vous" })).status).toBe(400);
    expect((await post("com", p.id, { type: "note", summary: "Dans le futur", occurredAt: new Date(Date.now() + 3 * 86400_000).toISOString() })).status).toBe(400);
    for (const who of ["ops", "client", "dir"]) expect((await post(who, p.id, { type: "note", summary: "Interdit pour ce rôle" })).status).toBe(403);
    expect((await post("admin2", p.id, { type: "note", summary: "Autre société" })).status).toBe(404);
    expect((await srv().get(`/crm/prospects/${p.id}`).set(H("admin2"))).status).toBe(404); expect((await srv().get(`/crm/prospects/${p.id}`).set(H("ops"))).status).toBe(403);
    const i = await admin.interaction.findFirstOrThrow({ where: { prospectId: p.id } });
    await expect(admin.interaction.update({ where: { id: i.id }, data: { summary: "falsifié" } })).rejects.toThrow(/append-only/); await expect(admin.interaction.delete({ where: { id: i.id } })).rejects.toThrow(/append-only/);
    const t = await srv().post("/crm/tasks").set(H("com")).send({ prospectId: p.id, title: "Envoyer la proposition", dueDate: addDays(3), assigneeUserId: uid.com2 }); expect(t.status).toBe(201);
    expect((await admin.notification.count({ where: { userId: uid.com2, type: "crm.task_assigned" } }))).toBe(1);
    expect((await srv().post("/crm/tasks").set(H("com")).send({ title: "Pour la finance", dueDate: addDays(3), assigneeUserId: uid.fin })).status).toBe(400);
    expect((await srv().post("/crm/tasks").set(H("com")).send({ title: "Date invalide", dueDate: "demain" })).status).toBe(400);
    expect((await srv().get("/crm/tasks?mine=1").set(H("com2"))).body.map((x: { id: string }) => x.id)).toContain(t.body.id); expect((await srv().get("/crm/tasks?mine=1").set(H("com"))).body.map((x: { id: string }) => x.id)).not.toContain(t.body.id);
    expect((await srv().post(`/crm/tasks/${t.body.id}/done`).set(H("admin")).send()).status).toBe(201); // administrateur
    expect((await srv().post(`/crm/tasks/${t.body.id}/done`).set(H("com2")).send()).status).toBe(409); // déjà clôturée
    const t2b = await srv().post("/crm/tasks").set(H("com")).send({ title: "À moi seul", dueDate: addDays(1) });
    expect((await srv().post(`/crm/tasks/${t2b.body.id}/done`).set(H("com2")).send()).status).toBe(403); // ni assigné, ni créateur, ni admin
    const late = await srv().post("/crm/tasks").set(H("com")).send({ title: "En retard", dueDate: addDays(-1) });
    expect((await srv().get("/crm/tasks?mine=1").set(H("com"))).body.find((x: { id: string }) => x.id === late.body.id).overdue).toBe(true);
  });
});

describe("campagnes", () => {
  it("cycle de vie, affectation sans réaffectation, statistiques et coût par conversion", async () => {
    const c = (await srv().post("/crm/campaigns").set(H("com")).send({ name: "Campagne automne", kind: "consultants", channel: "email", budget: "1000" })).body;
    expect((await srv().post("/crm/campaigns").set(H("com")).send({ name: "Campagne automne", kind: "consultants", channel: "email" })).status).toBe(409);
    expect((await srv().post("/crm/campaigns").set(H("com")).send({ name: "Dates", kind: "consultants", channel: "email", startDate: "2026-05-02", endDate: "2026-05-01" })).status).toBe(400);
    expect((await srv().post("/crm/campaigns").set(H("ops")).send({ name: "Interdit", kind: "consultants", channel: "email" })).status).toBe(403);
    expect((await srv().post(`/crm/campaigns/${c.id}/transition`).set(H("com")).send({ event: "end" })).body.status).toBe("ended" === "ended" ? "ended" : "");
    const c2 = (await srv().post("/crm/campaigns").set(H("com")).send({ name: "Campagne hiver", kind: "consultants", channel: "event", budget: "1000" })).body;
    expect((await srv().post(`/crm/campaigns/${c2.id}/transition`).set(H("com")).send({ event: "launch" })).body.status).toBe("active");
    expect((await srv().post(`/crm/campaigns/${c2.id}/transition`).set(H("com")).send({ event: "launch" })).status).toBe(400);
    const ps = [await mkProspect("com", { email: "a1@example.test" }), await mkProspect("com", { email: "a2@example.test" }), await mkProspect("com", { campaignId: c2.id })];
    const a = await srv().post(`/crm/campaigns/${c2.id}/prospects`).set(H("com")).send({ prospectIds: ps.map(p => p.id) }); expect(a.body).toEqual({ assigned: 2, skipped: 1 }); // le 3e en a déjà une
    expect((await srv().post(`/crm/campaigns/${c.id}/prospects`).set(H("com")).send({ prospectIds: [ps[0].id] })).status).toBe(409); // campagne terminée
    for (const p of ps.slice(0, 2)) { await move("com", p.id, "contact"); await move("com", p.id, "qualify"); await move("com", p.id, "convert"); }
    const st = (await srv().get(`/crm/campaigns/${c2.id}/stats`).set(H("com"))).body;
    expect(st).toMatchObject({ prospects: 3, conversionRatePercent: "66.7", costPerConversion: "500.00" }); expect(st.stages.converted).toBe(2);
    expect((await srv().get(`/crm/prospects?campaignId=${c2.id}`).set(H("com"))).body).toHaveLength(3);
    expect((await srv().post("/prospects").set(H("com")).send({ kind: "company", name: "X", campaignId: crypto.randomUUID() })).status).toBe(400);
    expect((await srv().get(`/crm/campaigns/${c2.id}/stats`).set(H("admin2"))).status).toBe(404);
  });
});

describe("apporteurs, parrainages et commissions", () => {
  let intro: string, sponsor: string, pctProspect: string, refPct: string, fixedCommission: string;
  it("apporteurs et règles de commission validées et figées", async () => {
    expect((await srv().post("/crm/referrers").set(H("com")).send({ kind: "sponsor", name: "Parrain sans dossier" })).status).toBe(400);
    const cons = (await admin.consultant.create({ data: { tenantId: t1, firstName: "Parrain", lastName: "Consultant", status: "active" } })).id;
    sponsor = (await srv().post("/crm/referrers").set(H("com")).send({ kind: "sponsor", name: "Parrain Consultant", consultantId: cons })).body.id;
    intro = (await srv().post("/crm/referrers").set(H("com")).send({ kind: "introducer", name: "Cabinet Apporteur", email: "contact@apporteur.test" })).body.id;
    expect((await srv().post("/crm/referrers").set(H("com")).send({ kind: "introducer", name: "Cabinet Apporteur" })).status).toBe(409);
    pctProspect = (await mkProspect("com", { email: "filleul@example.test" })).id;
    const bad = (b: object) => srv().post("/crm/referrals").set(H("com")).send({ prospectId: pctProspect, referrerId: intro, ...b });
    expect((await bad({ ruleType: "percent_of_collected_net", ruleValue: "101", durationMonths: 6 })).status).toBe(400); expect((await bad({ ruleType: "percent_of_collected_net", ruleValue: "5", durationMonths: 0 })).status).toBe(400);
    expect((await bad({ ruleType: "magic", ruleValue: "5" })).status).toBe(400);
    const r = await bad({ ruleType: "percent_of_collected_net", ruleValue: "5", durationMonths: 6 }); expect(r.status).toBe(201); refPct = r.body.id;
    expect((await bad({ ruleType: "fixed_per_conversion", ruleValue: "100" })).status).toBe(409); // déjà parrainé
    await srv().patch(`/crm/referrers/${sponsor}`).set(H("com")).send({ status: "suspended" });
    expect((await srv().post("/crm/referrals").set(H("com")).send({ prospectId: (await mkProspect("com")).id, referrerId: sponsor, ruleType: "fixed_per_conversion", ruleValue: "50" })).status).toBe(409); // suspendu
    await expect(admin.referral.update({ where: { id: refPct }, data: { ruleValue: "50" } })).rejects.toThrow(/figée/);
    expect((await srv().post("/crm/referrals").set(H("ops")).send({ prospectId: pctProspect, referrerId: intro, ruleType: "fixed_per_conversion", ruleValue: "1" })).status).toBe(403);
  });
  it("forfait à la conversion; commission proportionnelle sur les encaissements pendant la durée convenue seulement", async () => {
    // forfait de 200 € à la conversion d'une entreprise
    const co = (await mkProspect("com", { kind: "company", name: `Société parrainée ${run}`, email: "achats@parrainee.test" })).id;
    expect((await srv().post("/crm/referrals").set(H("com")).send({ prospectId: co, referrerId: intro, ruleType: "fixed_per_conversion", ruleValue: "200" })).status).toBe(201);
    await move("com", co, "contact"); await move("com", co, "qualify"); await move("com", co, "convert");
    const fixed = (await srv().get("/crm/commissions").set(H("com"))).body.find((c: { sourceType: string; amount: string }) => c.sourceType === "conversion"); expect(fixed.amount).toBe("200"); fixedCommission = fixed.id;
    // 5 % du HT encaissé pendant 6 mois : conversion du consultant, onboarding, mission, CRA, facture, paiements
    await move("com", pctProspect, "contact"); await move("com", pctProspect, "qualify"); await move("com", pctProspect, "convert");
    const d = await detail("com", pctProspect); expect(d.referral.convertedAt).toBeTruthy();
    const cons = await admin.consultant.findFirstOrThrow({ where: { sourceProspectId: pctProspect } });
    for (const t of DEFAULT_TASKS) await srv().post(`/consultants/${cons.id}/tasks/${t.key}`).set(H("admin")).send({ done: true });
    expect((await srv().post(`/consultants/${cons.id}/activate`).set(H("admin"))).status).toBe(201);
    const company = (await admin.company.create({ data: { tenantId: t1, name: "Client final" } })).id;
    const mission = (await srv().post("/missions").set(H("admin")).send({ consultantId: cons.id, companyId: company, title: "Mission parrainée", dailyRate: "650.00", vatRate: "20", startDate: "2026-01-01" })).body.id;
    const ts = await admin.timesheet.create({ data: { tenantId: t1, missionId: mission, period: "2027-01", status: "validated" } });
    for (let i = 1; i <= 2; i++) await admin.timesheetLine.create({ data: { tenantId: t1, timesheetId: ts.id, date: new Date(`2027-01-0${i}`), quantity: "1" } });
    const inv = (await srv().post("/invoices").set(H("admin")).send({ timesheetId: ts.id })).body.id; await srv().post(`/invoices/${inv}/issue`).set(H("admin"));
    expect((await srv().post(`/invoices/${inv}/payments`).set(H("admin")).send({ amount: "1000.00", receivedOn: TODAY })).status).toBe(201);
    expect((await srv().post(`/invoices/${inv}/payments`).set(H("admin")).send({ amount: "560.00", receivedOn: addMonths(7) })).status).toBe(201); // hors durée
    const cs = (await srv().get("/crm/commissions").set(H("com"))).body.filter((c: { sourceType: string }) => c.sourceType === "payment");
    expect(cs).toHaveLength(1); expect(cs[0].amount).toBe("41.67"); expect(cs[0].rule).toMatch(/5 % du HT encaissé pendant 6 mois/); // 1000 × 1300/1560 = 833,33 ; × 5 %
    expect((await srv().get("/crm/referrers").set(H("com"))).body.find((r: { id: string }) => r.id === intro)).toMatchObject({ referrals: 2, conversions: 2, commissions: { accrued: "241.67" } });
  });
  it("approbation à quatre yeux, paiement avec écriture comptable, montants figés", async () => {
    const act = (who: string, id: string, b: object) => srv().post(`/crm/commissions/${id}/transition`).set(H(who)).send(b);
    expect((await act("com", fixedCommission, { event: "approve" })).status).toBe(403); expect((await act("ops", fixedCommission, { event: "approve" })).status).toBe(403);
    const own = await mkProspect("admin", { kind: "company", name: `Parrainé par admin ${run}`, email: "x@admin.test" });
    await srv().post("/crm/referrals").set(H("admin")).send({ prospectId: own.id, referrerId: intro, ruleType: "fixed_per_conversion", ruleValue: "50" });
    await move("admin", own.id, "contact"); await move("admin", own.id, "qualify"); await move("admin", own.id, "convert");
    const mine = (await srv().get("/crm/commissions").set(H("admin"))).body.find((c: { amount: string; status: string }) => c.amount === "50" && c.status === "accrued");
    const self = await act("admin", mine.id, { event: "approve" }); expect(self.status).toBe(400); expect(self.body.error.message).toMatch(/quatre yeux/);
    expect((await act("fin", mine.id, { event: "approve" })).body.status).toBe("approved");
    expect((await act("fin", mine.id, { event: "pay" })).status).toBe(400); // référence obligatoire
    expect((await act("com", mine.id, { event: "pay", reference: "VIR-1" })).status).toBe(403);
    expect((await act("fin", fixedCommission, { event: "pay", reference: "VIR-0" })).status).toBe(400); // pas encore approuvée
    expect((await act("fin", mine.id, { event: "pay", reference: "VIR-2026-0042" })).body.status).toBe("paid");
    const e = await admin.journalEntry.findFirstOrThrow({ where: { tenantId: t1, key: `commission.pay:${mine.id}` }, include: { lines: true } });
    expect(e.lines.map(l => [l.account, l.debit.toString(), l.credit.toString()]).sort()).toEqual([["512", "0", "50"], ["622", "50", "0"]]);
    expect((await act("fin", mine.id, { event: "pay", reference: "VIR-AGAIN" })).status).toBe(400); expect((await act("fin", mine.id, { event: "cancel" })).status).toBe(400);
    expect((await act("fin", fixedCommission, { event: "approve" })).body.status).toBe("approved"); expect((await act("fin", fixedCommission, { event: "cancel" })).body.status).toBe("cancelled");
    await expect(admin.commission.update({ where: { id: mine.id }, data: { amount: "5000" } })).rejects.toThrow(/figés/);
    await expect(admin.commission.create({ data: { tenantId: t1, referralId: refPct, sourceType: "payment", sourceId: (await admin.payment.findFirstOrThrow({ where: { tenantId: t1 } })).id, amount: "1" } })).rejects.toThrow(); // unicité : idempotence
    expect((await srv().get("/ledger/reconciliation").set(H("fin"))).body.journalBalanced).toBe(true);
    for (const who of ["ops", "client"]) expect((await srv().get("/crm/commissions").set(H(who))).status).toBe(403);
    expect((await srv().get("/crm/commissions").set(H("admin2"))).body).toEqual([]);
    expect((await srv().get("/crm/commissions?status=alien").set(H("com"))).status).toBe(400);
  });
});

describe("accords-cadres", () => {
  it("grille de tarifs plafonds, cycle de vie, alertes d'échéance, contrôle des missions", async () => {
    const co = (await admin.company.create({ data: { tenantId: t1, name: "Client accord" } })).id, other = (await admin.company.create({ data: { tenantId: t1, name: "Autre client" } })).id;
    const cons = (await admin.consultant.create({ data: { tenantId: t1, firstName: "Cons", lastName: "Accord", status: "active" } })).id;
    const body = { companyId: co, name: "Accord 2026", startDate: addDays(-30), endDate: addDays(40), paymentTermsDays: 30, rates: [{ label: "Senior", maxDailyRate: "700.00" }, { label: "Junior", maxDailyRate: "450.00" }] };
    expect((await srv().post("/crm/agreements").set(H("ops")).send(body)).status).toBe(403);
    expect((await srv().post("/crm/agreements").set(H("com")).send({ ...body, companyId: crypto.randomUUID() })).status).toBe(400);
    expect((await srv().post("/crm/agreements").set(H("com")).send({ ...body, rates: [{ label: "A", maxDailyRate: "1" }, { label: "a", maxDailyRate: "2" }] })).status).toBe(400);
    expect((await srv().post("/crm/agreements").set(H("com")).send({ ...body, endDate: addDays(-60) })).status).toBe(400);
    const a = (await srv().post("/crm/agreements").set(H("com")).send(body)).body; const senior = a.rates.find((r: { label: string }) => r.label === "Senior").id, junior = a.rates.find((r: { label: string }) => r.label === "Junior").id;
    const mission = (b: object) => srv().post("/missions").set(H("admin")).send({ consultantId: cons, companyId: co, title: "Mission accord", dailyRate: "650.00", vatRate: "20", startDate: addDays(0), endDate: addDays(30), agreementId: a.id, agreementRateId: senior, ...b });
    expect((await mission({})).status).toBe(400); // accord non actif
    expect((await srv().post(`/crm/agreements/${a.id}/transition`).set(H("com")).send({ event: "terminate" })).status).toBe(400);
    expect((await srv().post(`/crm/agreements/${a.id}/transition`).set(H("com")).send({ event: "activate" })).body.status).toBe("active");
    expect((await mission({ dailyRate: "700.01" })).status).toBe(400); expect((await mission({ agreementRateId: junior })).status).toBe(400); expect((await mission({ agreementRateId: undefined })).status).toBe(400);
    expect((await mission({ endDate: addDays(90) })).status).toBe(400); expect((await mission({ startDate: addDays(-60) })).status).toBe(400); expect((await mission({ companyId: other })).status).toBe(400);
    expect((await mission({ agreementId: undefined })).status).toBe(400); // tarif sans accord
    const ok = await mission({ dailyRate: "700.00" }); expect(ok.status).toBe(201); expect(ok.body.agreementId).toBe(a.id);
    const list = (await srv().get("/crm/agreements?expiringWithin=60").set(H("com"))).body.find((x: { id: string }) => x.id === a.id); expect(list).toMatchObject({ company: "Client accord", effectiveStatus: "active", expiringSoon: true, daysLeft: 40 });
    expect((await srv().get("/crm/agreements?expiringWithin=10").set(H("com"))).body.find((x: { id: string }) => x.id === a.id).expiringSoon).toBe(false);
    const old = await admin.frameworkAgreement.create({ data: { tenantId: t1, companyId: co, name: "Accord échu", startDate: new Date("2020-01-01"), endDate: new Date("2020-12-31"), status: "active", createdBy: "u" } });
    expect((await srv().get("/crm/agreements").set(H("com"))).body.find((x: { id: string }) => x.id === old.id)).toMatchObject({ status: "active", effectiveStatus: "expired", expiringSoon: false });
    expect((await srv().get("/crm/agreements?expiringWithin=-1").set(H("com"))).status).toBe(400); expect((await srv().get("/crm/agreements").set(H("admin2"))).body).toEqual([]);
  });
});

describe("imports CSV", () => {
  const csv = (rows: string[]) => ["Nom;Email;Téléphone;Type;Source", ...rows].join("\r\n");
  it("aperçu avec rapport d'erreurs et doublons, validation unique, annulation logique conditionnée", async () => {
    await mkProspect("com", { email: "existant@example.test", name: "Déjà là" });
    const c = (await srv().post("/crm/campaigns").set(H("com")).send({ name: "Campagne import", kind: "consultants", channel: "event" })).body;
    const data = csv(["Alice Import;alice.imp@example.test;+33 6 11 22 33 44;consultant;salon", "Bob Import;bob.imp@example.test;;;", "Mauvais Email;pas-un-email;;consultant;", ";sans.nom@example.test;;;", "Doublon Fichier;bob.imp@example.test;;;", "Déjà Là;existant@example.test;;;", "Société Imp;contact@imp.test;;entreprise;"]);
    const pv = await srv().post("/crm/imports/preview").set(H("com")).send({ csv: data, fileName: "salon.csv", campaignId: c.id }); expect(pv.status).toBe(201);
    expect(pv.body).toMatchObject({ status: "previewed", rowsTotal: 7, rowsValid: 3, rowsInvalid: 4 });
    expect(pv.body.errors.map((e: { line: number; errors: string[] }) => [e.line, e.errors[0]])).toEqual([[4, "email invalide"], [5, "nom manquant"], [6, "doublon dans le fichier"], [7, "doublon : un prospect avec cet email existe déjà"]]);
    expect(await admin.prospect.count({ where: { importJobId: pv.body.id } })).toBe(0); // l'aperçu n'écrit rien
    const cm = await srv().post(`/crm/imports/${pv.body.id}/commit`).set(H("com")); expect(cm.body).toMatchObject({ created: 3, skippedDuplicates: 0 });
    expect((await srv().post(`/crm/imports/${pv.body.id}/commit`).set(H("com"))).status).toBe(409);
    const imported = await admin.prospect.findMany({ where: { importJobId: pv.body.id } }); expect(imported.map(p => p.campaignId)).toEqual([c.id, c.id, c.id]); expect(imported.find(p => p.name === "Société Imp")?.kind).toBe("company"); expect(imported.find(p => p.name === "Alice Import")?.source).toBe("salon");
    expect((await srv().get("/crm/imports").set(H("com"))).body[0].status).toBe("committed");
    // annulation logique : refusée dès qu'un prospect importé a été travaillé
    await move("com", imported[0]!.id, "contact");
    const refused = await srv().post(`/crm/imports/${pv.body.id}/rollback`).set(H("com")); expect(refused.status).toBe(409); expect(refused.body.error.message).toMatch(/déjà été travaillés/);
    const pv2 = (await srv().post("/crm/imports/preview").set(H("com")).send({ csv: csv(["Zoé Import;zoe.imp@example.test;;;", "Yann Import;yann.imp@example.test;;;"]) })).body;
    await srv().post(`/crm/imports/${pv2.id}/commit`).set(H("com"));
    const rb = await srv().post(`/crm/imports/${pv2.id}/rollback`).set(H("com")); expect(rb.body).toEqual({ id: pv2.id, status: "rolled_back", archived: 2 });
    expect((await srv().get("/crm/prospects?q=Import").set(H("com"))).body.every((p: { name: string }) => !["Zoé Import", "Yann Import"].includes(p.name))).toBe(true); // archivés = masqués
    expect((await srv().post(`/crm/imports/${pv2.id}/rollback`).set(H("com"))).status).toBe(409);
    const pv3 = (await srv().post("/crm/imports/preview").set(H("com")).send({ csv: csv(["Abandon;ab@example.test;;;"]) })).body;
    expect((await srv().post(`/crm/imports/${pv3.id}/cancel`).set(H("com"))).body.status).toBe("cancelled"); expect((await srv().post(`/crm/imports/${pv3.id}/commit`).set(H("com"))).status).toBe(409);
  });
  it("validations du fichier et du mappage, droits, isolation", async () => {
    const pv = (b: object) => srv().post("/crm/imports/preview").set(H("com")).send(b);
    expect((await pv({ csv: "Colonne;Autre\r\n1;2" })).status).toBe(400); // pas de colonne nom
    expect((await pv({ csv: "Nom;Email\r\nA;a@x.test", mapping: { name: "Inexistante" } })).status).toBe(400);
    expect((await pv({ csv: 'Nom;Email\r\n"Non fermé;a@x.test' })).status).toBe(400); expect((await pv({ csv: "Nom;Nom\r\nA;B" })).status).toBe(400);
    expect((await pv({ csv: "Nom\r\n" + "x".repeat(1_000_001) })).status).toBe(400);
    expect((await pv({ csv: "Nom\r\n" + "x".repeat(2_000_000) })).status).toBe(413);
    expect((await pv({ csv: "Name,Email\r\nMapping Anglais,map.en@example.test" })).body).toMatchObject({ rowsValid: 1, mapping: { name: "Name", email: "Email" } });
    const j = (await srv().get("/crm/imports").set(H("com"))).body[0];
    expect((await srv().post("/crm/imports/preview").set(H("ops")).send({ csv: "Nom\r\nA" })).status).toBe(403);
    expect((await srv().get(`/crm/imports/${j.id}`).set(H("admin2"))).status).toBe(404); expect((await srv().post(`/crm/imports/${j.id}/commit`).set(H("admin2"))).status).toBe(404);
  });
});

describe("simulation commerciale", () => {
  it("hypothèse explicite ou paramètre approuvé; jamais présentée comme une rémunération", async () => {
    const p = await mkProspect("com", { email: "sim@example.test" });
    const sc = [{ label: "Base", dailyRate: "650", daysPerMonth: "19", vatRate: "20", monthlyExpenses: "50" }, { label: "Prudent", dailyRate: "650", daysPerMonth: "15", vatRate: "20" }];
    const sim = (b: object) => srv().post("/crm/simulations").set(H("com")).send({ scenarios: sc, ...b });
    expect((await sim({})).status).toBe(422); // ni taux saisi ni paramètre approuvé
    const h = await sim({ prospectId: p.id, feeRatePercent: "10" }); expect(h.status).toBe(201);
    expect(h.body.results[0]).toMatchObject({ label: "Base", invoicedNet: "12350.00", managementFee: "1235.00", balanceBeforeSocialAndSalary: "11065.00" }); expect(h.body.results[1].invoicedNet).toBe("9750.00");
    expect(h.body.feeSource.type).toBe("hypothesis"); expect(h.body.disclaimer).toMatch(/ni un calcul de rémunération/); expect(h.body.results[0].hypotheses.join(" ")).toMatch(/NON calculés/);
    expect((await detail("com", p.id)).simulations).toHaveLength(1);
    const d = (await srv().post("/rules/parameters").set(H("compl")).send({ key: "management_fee_rate_percent", value: "12", unit: "%", validFrom: "2026-01-01", source: "Source de test automatisé (valeur fictive)" })).body;
    await srv().post(`/rules/parameters/${d.id}/approve`).set(H("admin"));
    const pr = await sim({}); expect(pr.body.feeSource).toMatchObject({ type: "parameter", value: "12" }); expect(pr.body.results[0].managementFee).toBe("1482.00");
    for (const bad of [{ scenarios: [{ ...sc[0], daysPerMonth: "0" }] }, { scenarios: [{ ...sc[0], daysPerMonth: "10.3" }] }, { scenarios: [] }, { scenarios: Array(6).fill(sc[0]) }, { feeRatePercent: "150" }]) expect((await sim({ feeRatePercent: "10", ...bad })).status).toBe(400);
    expect((await srv().post("/crm/simulations").set(H("ops")).send({ scenarios: sc, feeRatePercent: "10" })).status).toBe(403);
    expect((await srv().post("/crm/simulations").set(H("admin2")).send({ prospectId: p.id, scenarios: sc, feeRatePercent: "10" })).status).toBe(404);
    const row = await admin.simulation.findFirstOrThrow({ where: { tenantId: t1 } }); await expect(admin.simulation.update({ where: { id: row.id }, data: { inputs: {} } })).rejects.toThrow(/append-only/);
  });
});
