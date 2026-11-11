import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { randomInt } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { INestApplication } from "@nestjs/common";
import { createApp } from "../src/main";
import { hashPassword } from "../src/password";
import { resetLoginThrottle } from "../src/auth.controller";
import { FakeProvider } from "../src/whatsapp.provider";

process.env.WHATSAPP_PROVIDER = "fake";
process.env.WHATSAPP_APP_SECRET = "app-secret-de-test-app-secret-de-test";
process.env.WHATSAPP_VERIFY_TOKEN = "verify-token-de-test";

const admin = new PrismaClient();
let app: INestApplication;
const PW = "correct-horse-battery";
const run = Date.now().toString(36) + "s";
const rnd = () => String(randomInt(10_000_000, 99_999_999));
const PNID = "3" + rnd() + rnd().slice(0, 4);
const PHONE = `+3363${rnd().slice(0, 7)}`;
let t1: string, t2: string, prospectId: string, simId: string;
const tok: Record<string, string> = {};
const S = (n: string) => `${n}-${run}`;
const srv = () => request(app.getHttpServer());
const H = (k: string) => ({ Authorization: `Bearer ${tok[k]}` });
async function mk(key: string, tenantId: string, roles: string[]) { const u = await admin.user.create({ data: { email: `${key}-${run}@x.test`, passwordHash: await hashPassword(PW) } }); await admin.membership.create({ data: { userId: u.id, tenantId, roles } }); }
async function login(key: string, slug: string) { tok[key] = (await srv().post("/auth/login").send({ email: `${key}-${run}@x.test`, password: PW, tenantSlug: slug })).body.accessToken; }
const PAS: [string, string][] = [["1759", "1.3"], ["3052", "7.5"], ["3476", "9.9"], ["3913", "11.9"], ["4566", "13.8"], ["5475", "15.8"], ["6851", "17.9"], ["8557", "20"], ["11877", "24"], ["16086", "28"], ["25251", "33"], ["54088", "38"]];
const BASE: [string, string][] = [["management_fee_rate_percent", "10"], ["sim.working_days_per_year", "227"], ["sim.net_to_gross_percent", "75"], ["sim.paid_leave_days", "25"], ["sim.leave_day_divisor", "250"], ["sim.pas_rate.max", "43"], ["sim.employer_charges_percent", "45"], ...PAS.map(([t, r]) => [`sim.pas_rate.${t}`, r] as [string, string])];
const body = { tjm: "700", daysPerMonth: "20", mutualMonthly: "100", scenarios: [{ grossAnnual: "58000", dailyExpenses: "270" }, { grossAnnual: "65000", dailyExpenses: "230" }, { grossAnnual: "70000", dailyExpenses: "200" }] };

beforeAll(async () => {
  t1 = (await admin.tenant.create({ data: { slug: S("sm1"), name: "Société sim 1" } })).id;
  t2 = (await admin.tenant.create({ data: { slug: S("sm2"), name: "Société sim 2" } })).id;
  await mk("com", t1, ["commerce"]); await mk("admin", t1, ["tenant_admin"]); await mk("cons", t1, ["consultant"]); await mk("com2", t2, ["commerce"]);
  prospectId = (await admin.prospect.create({ data: { tenantId: t1, kind: "consultant", name: "Alex Prospect", email: "alex@example.test", stage: "contacted" } })).id;
  app = await createApp(); await app.init();
  for (const k of ["com", "admin", "cons"]) await login(k, S("sm1")); await login("com2", S("sm2"));
});
beforeEach(() => resetLoginThrottle());
afterAll(async () => { await admin.whatsappRoute.deleteMany({ where: { tenantId: { in: [t1, t2] } } }); await app.close(); await admin.$disconnect(); });

describe("simulation de salaire", () => {
  it("refus tant que les paramètres approuvés manquent (jamais de valeur par défaut)", async () => {
    const r = await srv().post("/crm/salary-simulations").set(H("com")).send(body);
    expect(r.status).toBe(422); expect(r.body.error.message).toMatch(/Paramètres approuvés manquants/);
  });
  it("reproduit les feuilles de référence avec les paramètres approuvés ; droits ; isolation", async () => {
    for (const [key, value] of BASE) await admin.ruleParameter.create({ data: { tenantId: t1, key, value, unit: "%", validFrom: new Date("2026-01-01"), source: "Feuille de référence (test)", status: "approved", createdBy: "t", approvedBy: "u", approvedAt: new Date() } });
    expect((await srv().post("/crm/salary-simulations").set(H("cons")).send(body)).status).toBe(403);
    const r = await srv().post("/crm/salary-simulations").set(H("com")).send({ ...body, prospectId, contact: { name: "Conseiller", email: "c@example.test" } });
    expect(r.status).toBe(201); simId = r.body.id;
    expect(r.body.scenarios.map((s: { netPaidMonthly: string }) => s.netPaidMonthly)).toEqual(["8693.63", "8201.88", "7871.25"]);
    expect(r.body.scenarios[0]).toMatchObject({ pasRatePercent: "11.90", extraForUntakenLeave: "12550.00", internalMargin: "8800.00", internalProfitabilityPercent: "5.54" });
    const pv = await srv().post("/crm/salary-simulations/preview").set(H("com")).send(body); // aperçu : même calcul, rien d'enregistré
    expect(pv.status).toBe(201); expect(pv.body.scenarios[0].netPaidMonthly).toBe("8693.63"); expect(pv.body.id).toBeUndefined();
    expect(await admin.simulation.count({ where: { tenantId: t1 } })).toBe(1);
    expect(r.body.parameters["sim.pas_rate.3913"].value).toBe("11.9"); // les taux utilisés sont tracés
    expect((await srv().post("/crm/salary-simulations").set(H("com")).send({ ...body, scenarios: [{ grossAnnual: "140000", dailyExpenses: "270" }] })).status).toBe(400); // hors enveloppe
    expect((await srv().get(`/crm/salary-simulations/${simId}/pdf`).set(H("com2"))).status).toBe(404); // autre société
    expect(await admin.auditEvent.count({ where: { tenantId: t1, action: "crm.salary_simulation" } })).toBe(1);
  });
  it("PDF : une page par scénario, réservé aux droits de lecture", async () => {
    const r = await srv().get(`/crm/salary-simulations/${simId}/pdf`).set(H("com")).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on("data", d => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); });
    expect(r.status).toBe(200); expect(r.headers["content-type"]).toMatch(/pdf/); expect(r.headers["content-disposition"]).toMatch(/simulation_Alex_Prospect_700_/);
    const buf = r.body as Buffer; expect(buf.subarray(0, 5).toString()).toBe("%PDF-"); expect((buf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length).toBe(3);
    expect((await srv().get(`/crm/salary-simulations/${simId}/pdf`)).status).toBe(401);
  });
});

describe("envoi par WhatsApp", () => {
  it("refusé sans consentement, puis sans modèle activé hors fenêtre, puis envoyé (modèle à en-tête document)", async () => {
    await srv().put("/whatsapp/channel").set(H("admin")).send({ phoneNumberId: PNID }).expect(200);
    const send = () => srv().post(`/crm/salary-simulations/${simId}/whatsapp`).set(H("com")).send({ prospectId });
    expect((await send()).status).toBe(409); // aucun consentement
    expect((await srv().post("/whatsapp/consents").set(H("com")).send({ subjectType: "prospect", subjectId: prospectId, phone: PHONE, status: "opted_in", source: "in_app", evidence: "accord oral consigné" })).status).toBe(201);
    const noTpl = await send(); expect(noTpl.status).toBe(409); expect(noTpl.body.error.message).toMatch(/non déclaré|activé/);
    await srv().put("/whatsapp/templates").set(H("admin")).send({ templates: [{ key: "salary_simulation", metaName: "portage_simulation_salaire", language: "fr", enabled: true }] }).expect(200);
    FakeProvider.sent.length = 0;
    const ok = await send(); expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ kind: "template", templateKey: "salary_simulation", status: "simulated", simulationId: simId });
    expect(FakeProvider.sent.map(s => s.kind)).toEqual(["media", "template"]); // PDF téléversé puis modèle envoyé
    expect((FakeProvider.sent[1]!.payload as { headerDocument?: { filename: string } }).headerDocument?.filename).toMatch(/\.pdf$/);
  });
  it("dans la fenêtre de 24 h : document libre ; retrait du consentement (STOP) : refus ; le modèle PDF ne s'envoie pas via send-template", async () => {
    const conv = await admin.whatsappConversation.findFirstOrThrow({ where: { tenantId: t1, phone: PHONE } });
    await admin.whatsappConversation.update({ where: { id: conv.id }, data: { lastInboundAt: new Date() } });
    FakeProvider.sent.length = 0;
    const doc = await srv().post(`/crm/salary-simulations/${simId}/whatsapp`).set(H("com")).send({ prospectId }); expect(doc.status).toBe(201);
    expect(doc.body.kind).toBe("document"); expect(FakeProvider.sent.map(s => s.kind)).toEqual(["media", "document"]);
    expect((await srv().post("/whatsapp/send-template").set(H("admin")).send({ subjectType: "prospect", subjectId: prospectId, key: "salary_simulation", params: ["A", "B"] })).status).toBe(400);
    await srv().post("/whatsapp/consents").set(H("com")).send({ subjectType: "prospect", subjectId: prospectId, phone: PHONE, status: "opted_out", source: "in_app" }).expect(201);
    expect((await srv().post(`/crm/salary-simulations/${simId}/whatsapp`).set(H("com")).send({ prospectId })).status).toBe(409);
  });
});
