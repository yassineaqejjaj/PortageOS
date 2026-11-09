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
const run = Date.now().toString(36) + "m";
let t1: string, t2: string, consId: string, co: string, mid: string;
const tok: Record<string, string> = {};
const S = (n: string) => `${n}-${run}`;
const srv = () => request(app.getHttpServer());
const H = (k: string) => ({ Authorization: `Bearer ${tok[k]}` });
async function mk(key: string, tenantId: string, roles: string[]) {
  const u = await admin.user.create({ data: { email: `${key}-${run}@x.test`, passwordHash: await hashPassword(PW) } });
  await admin.membership.create({ data: { userId: u.id, tenantId, roles } });
}
async function login(key: string, slug: string) { tok[key] = (await srv().post("/auth/login").send({ email: `${key}-${run}@x.test`, password: PW, tenantSlug: slug })).body.accessToken; }
const amend = (who: string, body: object, id = mid) => srv().post(`/missions/${id}/amendments`).set(H(who)).send(body);
async function validatedCra(period: string, qty = "1", dates = [`${period}-02`]) {
  const ts = await admin.timesheet.create({ data: { tenantId: t1, missionId: mid, period, status: "validated" } });
  await admin.timesheetLine.createMany({ data: dates.map(d => ({ tenantId: t1, timesheetId: ts.id, date: new Date(d), quantity: qty })) });
  return ts.id;
}

beforeAll(async () => {
  t1 = (await admin.tenant.create({ data: { slug: S("m1"), name: "Missions 1" } })).id;
  t2 = (await admin.tenant.create({ data: { slug: S("m2"), name: "Missions 2" } })).id;
  consId = (await admin.consultant.create({ data: { tenantId: t1, firstName: "Cons", lastName: "Avenant", status: "active" } })).id;
  co = (await admin.company.create({ data: { tenantId: t1, name: "Client M" } })).id;
  mid = (await admin.mission.create({ data: { tenantId: t1, consultantId: consId, companyId: co, title: "Mission M", dailyRate: "500", vatRate: "20", startDate: new Date("2032-01-01"), endDate: new Date("2032-06-30") } })).id;
  await mk("admin", t1, ["tenant_admin"]); await mk("ops", t1, ["operations"]); await mk("fin", t1, ["finance"]); await mk("admin2", t2, ["tenant_admin"]);
  app = await createApp(); await app.init();
  for (const k of ["admin", "ops", "fin"]) await login(k, S("m1"));
  await login("admin2", S("m2"));
});
beforeEach(() => resetLoginThrottle());
afterAll(async () => { await app.close(); await admin.$disconnect(); });

describe("avenant de tarif", () => {
  it("le tarif s'applique par période : avant l'avenant ancien tarif, à partir du mois d'effet nouveau tarif", async () => {
    const cra1 = await validatedCra("2032-02"), cra2 = await validatedCra("2032-03");
    expect((await amend("ops", { kind: "rate", newRate: "600", effectiveMonth: "2032-03", reason: "Revalorisation" })).status).toBe(201);
    const i1 = (await srv().post("/invoices").set(H("fin")).send({ timesheetId: cra1 })).body, i2 = (await srv().post("/invoices").set(H("fin")).send({ timesheetId: cra2 })).body;
    expect(i1.net).toBe("500"); expect(i2.net).toBe("600"); expect(i2.unitPrice).toBe("600");
    const m = (await srv().get(`/missions/${mid}`).set(H("ops"))).body;
    expect(m.initialRate).toBe("500"); expect(m.amendments.length).toBe(1); expect(m.amendments[0].before).toEqual({ rate: "500" });
  });
  it("avenant rétroactif sur une période facturée refusé; motif, droits et validations", async () => {
    expect((await amend("ops", { kind: "rate", newRate: "700", effectiveMonth: "2032-02", reason: "Rétro" })).status).toBe(409);
    expect((await amend("ops", { kind: "rate", newRate: "700", effectiveMonth: "2031-12", reason: "Avant début" })).status).toBe(400);
    expect((await amend("ops", { kind: "rate", newRate: "700", effectiveMonth: "2032-05", reason: "x" })).status).toBe(400);
    expect((await amend("ops", { kind: "rate", newRate: "0", effectiveMonth: "2032-05", reason: "Zéro" })).status).toBe(400);
    expect((await amend("fin", { kind: "rate", newRate: "700", effectiveMonth: "2032-05", reason: "Finance" })).status).toBe(403);
    expect((await amend("admin2", { kind: "rate", newRate: "700", effectiveMonth: "2032-05", reason: "Autre tenant" })).status).toBe(404);
    expect((await amend("ops", { kind: "weird", reason: "abc" })).status).toBe(400);
  });
  it("les avenants sont append-only en base", async () => {
    const a = await admin.missionAmendment.findFirst({ where: { missionId: mid } });
    await expect(admin.missionAmendment.update({ where: { id: a!.id }, data: { reason: "falsifié" } })).rejects.toThrow();
    await expect(admin.missionAmendment.delete({ where: { id: a!.id } })).rejects.toThrow();
  });
});

describe("prolongation, fin anticipée, budget", () => {
  it("prolongation : doit dépasser la fin actuelle", async () => {
    expect((await amend("ops", { kind: "extend", newEndDate: "2032-06-30", reason: "Pareil" })).status).toBe(400);
    expect((await amend("ops", { kind: "extend", newEndDate: "2032-09-30", reason: "Renouvellement" })).status).toBe(201);
    expect((await srv().get(`/missions/${mid}`).set(H("ops"))).body.endDate).toContain("2032-09-30");
  });
  it("fin anticipée : jamais avant les jours déjà déclarés, doit précéder la fin", async () => {
    expect((await amend("ops", { kind: "early_end", newEndDate: "2032-03-01", reason: "Trop tôt" })).status).toBe(409); // jours déclarés le 2032-03-02
    expect((await amend("ops", { kind: "early_end", newEndDate: "2032-12-31", reason: "Après la fin" })).status).toBe(400);
    expect((await amend("ops", { kind: "early_end", newEndDate: "2032-04-15", reason: "Fin de besoin client" })).status).toBe(201);
    const bad = await srv().put(`/timesheets/missions/${mid}/2032-04`).set(H("ops")).send({ lines: [{ date: "2032-04-20", quantity: "1" }] });
    expect(bad.status).toBe(400); expect(bad.body.error.message).toMatch(/hors mission/);
  });
  it("budget : consommation = factures HT non annulées, alerte non bloquante", async () => {
    expect((await amend("ops", { kind: "budget", budgetAmount: "1000", reason: "Budget initial" })).status).toBe(201);
    let b = (await srv().get(`/missions/${mid}`).set(H("ops"))).body.budget;
    expect(b.consumed).toBe("1100.00"); expect(b.remaining).toBe("-100.00"); expect(b.overBudget).toBe(true);
    expect((await amend("ops", { kind: "budget", budgetAmount: "5000", reason: "Relèvement" })).status).toBe(201);
    b = (await srv().get(`/missions/${mid}`).set(H("ops"))).body.budget;
    expect(b.overBudget).toBe(false); expect(b.remaining).toBe("3900.00");
  });
});

describe("clients : édition des contacts et sites", () => {
  it("modifie un contact et un site, refuse les doublons, journalise", async () => {
    const c = (await srv().post(`/companies/${co}/contacts`).set(H("admin")).send({ name: "Alice Test", email: "alice@x.test", role: "billing", isPrimary: true })).body;
    const e = await srv().patch(`/companies/${co}/contacts/${c.id}`).set(H("admin")).send({ name: "Alice Modifiée", email: "alice2@x.test", role: "operations", isPrimary: false });
    expect(e.status).toBe(200); expect(e.body.role).toBe("operations"); expect(e.body.name).toBe("Alice Modifiée");
    expect((await srv().patch(`/companies/${co}/contacts/${c.id}`).set(H("admin")).send({ name: "A", role: "billing" })).status).toBe(400);
    expect((await srv().patch(`/companies/${co}/contacts/${c.id}`).set(H("admin2")).send({ name: "Pirate", email: "p@x.test", role: "other" })).status).toBe(404);
    const s1 = (await srv().post(`/companies/${co}/sites`).set(H("admin")).send({ label: "Siège", address: "1 rue A", postalCode: "75001", city: "Paris" })).body;
    await srv().post(`/companies/${co}/sites`).set(H("admin")).send({ label: "Agence", address: "2 rue B", postalCode: "69001", city: "Lyon" });
    expect((await srv().patch(`/companies/${co}/sites/${s1.id}`).set(H("admin")).send({ label: "agence", address: "1 rue A", postalCode: "75001", city: "Paris" })).status).toBe(409);
    const ok = await srv().patch(`/companies/${co}/sites/${s1.id}`).set(H("admin")).send({ label: "Siège social", address: "3 rue C", postalCode: "75002", city: "Paris" });
    expect(ok.status).toBe(200); expect(ok.body.address).toBe("3 rue C");
    expect(await admin.auditEvent.count({ where: { tenantId: t1, action: { in: ["company.contact_updated", "company.site_updated"] } } })).toBe(2);
  });
});
