import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { INestApplication } from "@nestjs/common";
import { createApp } from "../src/main";
import { hashPassword } from "../src/password";
import { resetLoginThrottle } from "../src/auth.controller";

const admin = new PrismaClient();
let app: INestApplication;
const PW = "correct-horse-battery";
const run = Date.now().toString(36) + "l";
let t1: string, t2: string, consId: string, cons2Id: string, missionId: string;
const tok: Record<string, string> = {};
const S = (n: string) => `${n}-${run}`;
const srv = () => request(app.getHttpServer());
const H = (k: string) => ({ Authorization: `Bearer ${tok[k]}` });
const SRC = "Source de test automatisé (jeu de test, valeur fictive)";

async function mk(key: string, tenantId: string, roles: string[], consultantId?: string) {
  const u = await admin.user.create({ data: { email: `${key.toLowerCase()}-${run}@x.test`, passwordHash: await hashPassword(PW) } });
  await admin.membership.create({ data: { userId: u.id, tenantId, roles, consultantId } });
}
async function login(key: string, slug: string) { tok[key] = (await srv().post("/auth/login").send({ email: `${key.toLowerCase()}-${run}@x.test`, password: PW, tenantSlug: slug })).body.accessToken; }
const ask = (who: string, body: object) => srv().post("/me/leaves").set(H(who)).send(body);
const decide = (who: string, id: string, event: string, rejectReason?: string) => srv().post(`/leaves/${id}/transition`).set(H(who)).send({ event, rejectReason });
const balance = async () => (await srv().get("/me/leave-balance").set(H("cons"))).body.paidLeaveDays as string;

beforeAll(async () => {
  t1 = (await admin.tenant.create({ data: { slug: S("l1"), name: "Congés 1" } })).id;
  t2 = (await admin.tenant.create({ data: { slug: S("l2"), name: "Congés 2" } })).id;
  consId = (await admin.consultant.create({ data: { tenantId: t1, firstName: "Cons", lastName: "Un", status: "active" } })).id;
  cons2Id = (await admin.consultant.create({ data: { tenantId: t1, firstName: "Cons", lastName: "Deux", status: "active" } })).id;
  const co = (await admin.company.create({ data: { tenantId: t1, name: "Client L" } })).id;
  missionId = (await admin.mission.create({ data: { tenantId: t1, consultantId: consId, companyId: co, title: "ML", dailyRate: "500", vatRate: "20", startDate: new Date("2026-01-01") } })).id;
  await mk("admin", t1, ["tenant_admin"]); await mk("hr", t1, ["hr"]); await mk("ops", t1, ["operations"]); await mk("compl", t1, ["compliance"]); await mk("fin", t1, ["finance"]);
  await mk("cons", t1, ["consultant"], consId); await mk("cons2", t1, ["consultant"], cons2Id); await mk("hybrid", t1, ["consultant", "operations"], consId);
  await mk("client", t1, ["client_user"]); await mk("admin2", t2, ["tenant_admin"]);
  app = await createApp(); await app.init();
  for (const k of ["admin", "hr", "ops", "compl", "fin", "cons", "cons2", "hybrid", "client"]) await login(k, S("l1"));
  await login("admin2", S("l2"));
});
beforeEach(() => resetLoginThrottle());
afterAll(async () => { await app.close(); await admin.$disconnect(); });

describe("décompte des jours", () => {
  it("sans calendrier de fériés approuvé : décompte signalé non fiable; puis férié approuvé à quatre yeux exclu du décompte", async () => {
    const a = await ask("cons", { type: "paid_leave", startDate: "2031-03-03", endDate: "2031-03-09" }); // lun → dim
    expect(a.status).toBe(201); expect(a.body.days).toBe("5"); expect(a.body.holidaysConfigured).toBe(false);
    await srv().post(`/me/leaves/${a.body.id}/cancel`).set(H("cons"));
    const d = (await srv().post("/rules/parameters").set(H("compl")).send({ key: "calendar.public_holiday", value: "Jour férié de test", unit: "date", validFrom: "2031-03-05", validTo: "2031-03-05", source: SRC })).body;
    expect((await srv().post(`/rules/parameters/${d.id}/approve`).set(H("compl"))).status).toBe(403); // quatre yeux
    expect((await srv().post(`/rules/parameters/${d.id}/approve`).set(H("admin"))).status).toBe(201);
    const b = await ask("cons", { type: "paid_leave", startDate: "2031-03-03", endDate: "2031-03-07" });
    expect(b.body.days).toBe("4"); expect(b.body.holidaysConfigured).toBe(true);
    await srv().post(`/me/leaves/${b.body.id}/cancel`).set(H("cons"));
    expect((await ask("cons", { type: "paid_leave", startDate: "2031-03-08", endDate: "2031-03-09" })).status).toBe(400); // week-end seul
    expect((await ask("cons", { type: "paid_leave", startDate: "2031-03-07", endDate: "2031-03-03" })).status).toBe(400);
    expect((await ask("cons", { type: "alien", startDate: "2031-03-03", endDate: "2031-03-04" })).status).toBe(400);
    const h = await ask("cons", { type: "paid_leave", startDate: "2031-03-03", endDate: "2031-03-04", halfStart: true, halfEnd: true });
    expect(h.body.days).toBe("1"); await srv().post(`/me/leaves/${h.body.id}/cancel`).set(H("cons"));
  });
});

describe("solde, approbation, annulation", () => {
  let march: string;
  it("le solde vient d'ajustements RH motivés; l'opération ne peut pas ajuster", async () => {
    expect((await srv().post("/leave-adjustments").set(H("ops")).send({ consultantId: consId, days: "10", reason: "Solde initial" })).status).toBe(403);
    expect((await srv().post("/leave-adjustments").set(H("hr")).send({ consultantId: consId, days: "10", reason: "x" })).status).toBe(400);
    expect((await srv().post("/leave-adjustments").set(H("hr")).send({ consultantId: consId, days: "10", reason: "Solde initial 2031" })).body.paidLeaveDays).toBe("10.0");
    expect(await balance()).toBe("10.0");
  });
  it("approbation : solde décompté, chevauchement refusé, sans auto-approbation, refus motivé", async () => {
    march = (await ask("cons", { type: "paid_leave", startDate: "2031-03-03", endDate: "2031-03-07" })).body.id; // 4 j (férié le 05)
    expect((await ask("cons", { type: "sick", startDate: "2031-03-06", endDate: "2031-03-06" })).status).toBe(409);
    expect((await decide("cons", march, "approve")).status).toBe(403);
    expect((await srv().post(`/me/leaves/${march}/cancel`).set(H("cons2"))).status).toBe(404); // IDOR
    expect((await decide("ops", march, "approve")).body.status).toBe("approved");
    expect(await balance()).toBe("6.0");
    const own = (await ask("hybrid", { type: "unpaid", startDate: "2031-07-07", endDate: "2031-07-07" })).body.id;
    const self = await decide("hybrid", own, "approve");
    expect(self.status).toBe(400); expect(self.body.error.message).toMatch(/propre/);
    expect((await decide("hr", own, "approve")).body.status).toBe("approved");
    const big = (await ask("cons", { type: "paid_leave", startDate: "2031-04-21", endDate: "2031-05-09" })).body; // 15 j > 6
    const ko = await decide("ops", big.id, "approve");
    expect(ko.status).toBe(400); expect(ko.body.error.message).toMatch(/insuffisant/);
    expect((await decide("ops", big.id, "reject")).status).toBe(400);
    expect((await decide("ops", big.id, "reject", "Période de forte activité")).body.rejectReason).toBe("Période de forte activité");
    expect(await balance()).toBe("6.0");
  });
  it("arrêt maladie : ne consomme pas le solde", async () => {
    const s = (await ask("cons", { type: "sick", startDate: "2031-06-02", endDate: "2031-06-06" })).body;
    expect(s.days).toBe("5"); expect((await decide("hr", s.id, "approve")).body.status).toBe("approved");
    expect(await balance()).toBe("6.0");
  });
  it("annulation d'une absence approuvée à venir : solde restitué; commencée : refusée", async () => {
    expect((await srv().post(`/me/leaves/${march}/cancel`).set(H("cons"))).body.status).toBe("cancelled");
    expect(await balance()).toBe("10.0");
    const past = (await ask("cons", { type: "other", startDate: "2026-01-05", endDate: "2026-01-05" })).body.id;
    await decide("hr", past, "approve");
    const c = await srv().post(`/me/leaves/${past}/cancel`).set(H("cons"));
    expect(c.status).toBe(400); expect(c.body.error.message).toMatch(/déjà commencée/);
  });
});

describe("cohérence avec le CRA", () => {
  it("pas d'activité sur un jour d'absence approuvée; demi-journée : 0,5 au plus", async () => {
    // arrêt maladie approuvé du 02 au 06/06/2031 (cf. test précédent)
    const full = await srv().put(`/me/timesheets/missions/${missionId}/2031-06`).set(H("cons")).send({ lines: [{ date: "2031-06-03", quantity: "1" }] });
    expect(full.status).toBe(400); expect(full.body.error.message).toMatch(/Absence approuvée/);
    const half = (await ask("cons", { type: "paid_leave", startDate: "2031-08-04", endDate: "2031-08-04", halfEnd: true })).body;
    expect(half.days).toBe("0.5");
    await decide("ops", half.id, "approve");
    expect((await srv().put(`/me/timesheets/missions/${missionId}/2031-08`).set(H("cons")).send({ lines: [{ date: "2031-08-04", quantity: "1" }] })).status).toBe(400);
    expect((await srv().put(`/me/timesheets/missions/${missionId}/2031-08`).set(H("cons")).send({ lines: [{ date: "2031-08-04", quantity: "0.5" }, { date: "2031-08-05", quantity: "1" }] })).status).toBe(200);
    expect((await srv().put(`/me/timesheets/missions/${missionId}/2031-06`).set(H("cons")).send({ lines: [{ date: "2031-06-09", quantity: "1" }] })).status).toBe(200); // jour sans absence
  });
});

describe("droits et isolation", () => {
  it("rôles, portails et tenants", async () => {
    expect((await srv().get("/leaves").set(H("cons"))).status).toBe(403);
    expect((await srv().get("/leaves").set(H("client"))).status).toBe(403);
    expect((await srv().get("/leaves").set(H("fin"))).status).toBe(403);
    expect((await srv().get("/leaves").set(H("ops"))).body.length).toBeGreaterThan(0);
    expect((await srv().get("/me/leaves").set(H("cons2"))).body).toEqual([]);
    expect((await srv().get("/leaves").set(H("admin2"))).body).toEqual([]);
    expect((await srv().get(`/leave-balances/${consId}`).set(H("admin2"))).status).toBe(404);
    expect((await srv().get(`/leave-balances/${consId}`).set(H("hr"))).body.adjustments).toHaveLength(1);
  });
  it("garanties en base : ajustements append-only, période cohérente", async () => {
    const adj = await admin.leaveAdjustment.findFirst({ where: { tenantId: t1 } });
    await expect(admin.leaveAdjustment.update({ where: { id: adj!.id }, data: { days: "99" } })).rejects.toThrow(/append-only/);
    await expect(admin.leaveAdjustment.delete({ where: { id: adj!.id } })).rejects.toThrow(/append-only/);
    await expect(admin.leaveRequest.create({ data: { tenantId: t1, consultantId: consId, ownerUserId: "u", type: "sick", startDate: new Date("2031-05-05"), endDate: new Date("2031-05-01"), days: "1" } })).rejects.toThrow();
    await expect(admin.leaveRequest.create({ data: { tenantId: t1, consultantId: consId, ownerUserId: "u", type: "holiday", startDate: new Date("2031-05-01"), endDate: new Date("2031-05-01"), days: "1" } })).rejects.toThrow();
  });
});
