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
const run = Date.now().toString(36) + "c";
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
const addDays = (n: number) => { const d = new Date(`${TODAY}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
let t1: string, t2: string; const tok: Record<string, string> = {};
const S = (n: string) => `${n}-${run}`; const srv = () => request(app.getHttpServer()); const H = (k: string) => ({ Authorization: `Bearer ${tok[k]}` });
async function mk(key: string, tenantId: string, roles: string[]) {
  const u = await admin.user.create({ data: { email: `${key.toLowerCase()}-${run}@x.test`, passwordHash: await hashPassword(PW) } });
  await admin.membership.create({ data: { userId: u.id, tenantId, roles } });
}
async function login(key: string, slug: string) { tok[key] = (await srv().post("/auth/login").send({ email: `${key.toLowerCase()}-${run}@x.test`, password: PW, tenantSlug: slug })).body.accessToken; }
let co: string, cons: string;

beforeAll(async () => {
  t1 = (await admin.tenant.create({ data: { slug: S("c1"), name: "Clients 1" } })).id; t2 = (await admin.tenant.create({ data: { slug: S("c2"), name: "Clients 2" } })).id;
  await mk("admin", t1, ["tenant_admin"]); await mk("ops", t1, ["operations"]); await mk("com", t1, ["commerce"]); await mk("admin2", t2, ["tenant_admin"]);
  cons = (await admin.consultant.create({ data: { tenantId: t1, firstName: "C", lastName: "Client", status: "active" } })).id;
  app = await createApp(); await app.init();
  for (const k of ["admin", "ops", "com"]) await login(k, S("c1")); await login("admin2", S("c2"));
  co = (await srv().post("/companies").set(H("admin")).send({ name: `Client détaillé ${run}`, siren: "732829320" })).body.id; // SIREN de test à somme de contrôle valide
});
beforeEach(() => resetLoginThrottle());
afterAll(async () => { await app.close(); await admin.$disconnect(); });

describe("fiche client", () => {
  it("contacts : validation, un référent par rôle, retrait tracé, droits", async () => {
    const add = (who: string, b: object, id = co) => srv().post(`/companies/${id}/contacts`).set(H(who)).send(b);
    expect((await add("admin", { name: "Alice", role: "billing" })).status).toBe(400); // ni email ni téléphone
    expect((await add("admin", { name: "Alice", email: "pas-un-mail", role: "billing" })).status).toBe(400);
    expect((await add("admin", { name: "Alice", email: "a@x.test", role: "boss" })).status).toBe(400);
    expect((await add("ops", { name: "Alice", email: "a@x.test", role: "billing" })).status).toBe(403); // exploitation : lecture seule
    const a = await add("admin", { name: "Alice Facturation", email: "a@x.test", role: "billing", isPrimary: true }); expect(a.status).toBe(201);
    const b = await add("admin", { name: "Bob Facturation", phone: "+33123456789", role: "billing", isPrimary: true }); expect(b.status).toBe(201);
    const ov = (await srv().get(`/companies/${co}/overview`).set(H("com"))).body;
    expect(ov.contacts.filter((c: { isPrimary: boolean; role: string }) => c.isPrimary && c.role === "billing").map((c: { name: string }) => c.name)).toEqual(["Bob Facturation"]);
    expect((await srv().delete(`/companies/${co}/contacts/${a.body.id}`).set(H("admin"))).status).toBe(200);
    expect((await srv().delete(`/companies/${co}/contacts/${a.body.id}`).set(H("admin"))).status).toBe(404);
    expect((await srv().delete(`/companies/${co}/contacts/${b.body.id}`).set(H("admin2"))).status).toBe(404);
    expect(await admin.auditEvent.count({ where: { tenantId: t1, action: "company.contact_removed" } })).toBe(1);
  });
  it("sites, délai de paiement, somme de contrôle SIREN indicative, isolation", async () => {
    const site = (b: object) => srv().post(`/companies/${co}/sites`).set(H("admin")).send({ label: "Siège", address: "1 rue de Test", postalCode: "75001", city: "Paris", ...b });
    expect((await site({ postalCode: "7500" })).status).toBe(400); expect((await site({ country: "FRA" })).status).toBe(400);
    const s = await site({}); expect(s.status).toBe(201); expect((await site({ label: "siège" })).status).toBe(409);
    expect((await srv().delete(`/companies/${co}/sites/${s.body.id}`).set(H("admin"))).status).toBe(200);
    expect((await site({})).status).toBe(201); // libellé réutilisable après archivage
    const t = (v: unknown, who = "admin") => srv().patch(`/companies/${co}/terms`).set(H(who)).send({ paymentTermsDays: v });
    expect((await t(181)).status).toBe(400); expect((await t(-1)).status).toBe(400); expect((await t(1.5)).status).toBe(400); expect((await t(45, "ops")).status).toBe(403);
    expect((await t(45)).status).toBe(200);
    const ov = (await srv().get(`/companies/${co}/overview`).set(H("ops"))).body; expect(ov.company).toMatchObject({ paymentTermsDays: 45, sirenChecksumValid: true }); expect(ov.sites).toHaveLength(1);
    const bad = (await srv().post("/companies").set(H("admin")).send({ name: `Mauvais SIREN ${run}`, siren: "123456789" })).body.id;
    expect((await srv().get(`/companies/${bad}/overview`).set(H("admin"))).body.company.sirenChecksumValid).toBe(false); // signalé, jamais bloquant
    expect((await srv().get(`/companies/${co}/overview`).set(H("admin2"))).status).toBe(404); expect((await srv().post(`/companies/${co}/sites`).set(H("admin2")).send({ label: "X1", address: "1 rue", postalCode: "75001", city: "P" })).status).toBe(404);
  });
});

describe("bons de commande", () => {
  it("création, doublon, rattachement des missions, consommation calculée, clôture/annulation, valeurs figées", async () => {
    const po = (b: object) => srv().post(`/companies/${co}/purchase-orders`).set(H("admin")).send({ reference: `BC-${run}`, amount: "10000", startDate: addDays(-10), endDate: addDays(90), ...b });
    expect((await po({ amount: "0" })).status).toBe(400); expect((await po({ endDate: addDays(-20) })).status).toBe(400); expect((await srv().post(`/companies/${co}/purchase-orders`).set(H("ops")).send({ reference: "BC-X", amount: "1", startDate: addDays(0), endDate: addDays(1) })).status).toBe(403);
    const p = await po({}); expect(p.status).toBe(201); expect(p.body).toMatchObject({ amount: "10000.00", consumed: "0.00", remaining: "10000.00", overConsumed: false });
    expect((await po({})).status).toBe(409);
    const mission = (b: object) => srv().post("/missions").set(H("admin")).send({ consultantId: cons, companyId: co, title: "Mission BC", dailyRate: "500.00", vatRate: "20", startDate: addDays(0), endDate: addDays(30), purchaseOrderId: p.body.id, ...b });
    expect((await mission({ endDate: addDays(200) })).status).toBe(400); expect((await mission({ startDate: addDays(-30) })).status).toBe(400); expect((await mission({ purchaseOrderId: crypto.randomUUID() })).status).toBe(400);
    const other = (await srv().post("/companies").set(H("admin")).send({ name: `Autre client ${run}` })).body.id; expect((await mission({ companyId: other })).status).toBe(400); // BC d'un autre client
    const m = await mission({}); expect(m.status).toBe(201); expect(m.body.purchaseOrderId).toBe(p.body.id);
    // consommation : facture émise = HT compté ; brouillon et créditée exclues
    const ts = await admin.timesheet.create({ data: { tenantId: t1, missionId: m.body.id, period: "2027-02", status: "validated" } });
    for (let i = 1; i <= 3; i++) await admin.timesheetLine.create({ data: { tenantId: t1, timesheetId: ts.id, date: new Date(`2027-02-0${i}`), quantity: "1" } });
    const inv = (await srv().post("/invoices").set(H("admin")).send({ timesheetId: ts.id })).body.id;
    const view = async () => (await srv().get(`/companies/${co}/overview`).set(H("admin"))).body.purchaseOrders.find((x: { id: string }) => x.id === p.body.id);
    expect((await view()).consumed).toBe("0.00"); // brouillon
    await srv().post(`/invoices/${inv}/issue`).set(H("admin")); expect(await view()).toMatchObject({ consumed: "1500.00", remaining: "8500.00" });
    const act = (ev: string) => srv().post(`/companies/${co}/purchase-orders/${p.body.id}/${ev}`).set(H("admin"));
    expect((await act("cancel")).status).toBe(400); expect((await act("magic")).status).toBe(400); // facturé : annulation refusée
    expect((await act("close")).body.status).toBe("closed"); expect((await act("close")).status).toBe(400);
    expect((await mission({ title: "Après clôture" })).status).toBe(400);
    await expect(admin.purchaseOrder.update({ where: { id: p.body.id }, data: { amount: "1" } })).rejects.toThrow(/figés/);
    const small = (await po({ reference: `BC2-${run}`, amount: "100" })).body.id; // dépassement signalé, jamais bloqué
    const m2 = (await mission({ purchaseOrderId: small, title: "Dépasse" })).body.id; const ts2 = await admin.timesheet.create({ data: { tenantId: t1, missionId: m2, period: "2027-03", status: "validated" } });
    await admin.timesheetLine.create({ data: { tenantId: t1, timesheetId: ts2.id, date: new Date("2027-03-01"), quantity: "1" } });
    const inv2 = (await srv().post("/invoices").set(H("admin")).send({ timesheetId: ts2.id })).body.id; await srv().post(`/invoices/${inv2}/issue`).set(H("admin"));
    expect((await srv().get(`/companies/${co}/overview`).set(H("admin"))).body.purchaseOrders.find((x: { id: string }) => x.id === small)).toMatchObject({ overConsumed: true, remaining: "-400.00" });
    const empty = (await po({ reference: `BC3-${run}`, amount: "50" })).body.id; expect((await srv().post(`/companies/${co}/purchase-orders/${empty}/cancel`).set(H("admin"))).body.status).toBe("cancelled");
    expect((await srv().post(`/companies/${co}/purchase-orders/${empty}/cancel`).set(H("admin2"))).status).toBe(404);
  });
});
