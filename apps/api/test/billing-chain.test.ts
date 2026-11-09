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
const run = Date.now().toString(36) + "b";
let t1: string, t2: string, coA: string, coB: string, consId: string, missionId: string;
const tokens: Record<string, string> = {};
const S = (n: string) => `${n}-${run}`;
const srv = () => request(app.getHttpServer());
const H = (k: string) => ({ Authorization: `Bearer ${tokens[k]}` });

async function mkUser(key: string, tenantId: string, roles: string[], extra: { companyId?: string; consultantId?: string } = {}) {
  const email = `${key.toLowerCase()}-${run}@x.test`;
  const u = await admin.user.create({ data: { email, passwordHash: await hashPassword(PW) } });
  await admin.membership.create({ data: { userId: u.id, tenantId, roles, ...extra } });
  return email;
}
async function login(key: string, slug: string) {
  const r = await srv().post("/auth/login").send({ email: `${key.toLowerCase()}-${run}@x.test`, password: PW, tenantSlug: slug });
  tokens[key] = r.body.accessToken;
}
const days = (period: string, n: number, q = "1") => Array.from({ length: n }, (_, i) => ({ date: `${period}-${String(i + 1).padStart(2, "0")}`, quantity: q }));

/** Fait passer un CRA jusqu'à « validé » et renvoie son id. */
async function validatedTimesheet(period: string, n = 19) {
  const put = await srv().put(`/me/timesheets/missions/${missionId}/${period}`).set(H("cons")).send({ lines: days(period, n) });
  expect(put.status).toBe(200);
  const id = put.body.id;
  expect((await srv().post(`/me/timesheets/${id}/transition`).set(H("cons")).send({ event: "submit" })).body.status).toBe("submitted");
  expect((await srv().post(`/client/timesheets/${id}/transition`).set(H("clientA")).send({ event: "approve" })).body.status).toBe("client_approved");
  expect((await srv().post(`/timesheets/${id}/transition`).set(H("ops")).send({ event: "validate" })).body.status).toBe("validated");
  return id as string;
}

beforeAll(async () => {
  t1 = (await admin.tenant.create({ data: { slug: S("c1"), name: "Chaîne 1" } })).id;
  t2 = (await admin.tenant.create({ data: { slug: S("c2"), name: "Chaîne 2" } })).id;
  coA = (await admin.company.create({ data: { tenantId: t1, name: "Client A" } })).id;
  coB = (await admin.company.create({ data: { tenantId: t1, name: "Client B" } })).id;
  consId = (await admin.consultant.create({ data: { tenantId: t1, firstName: "Camille", lastName: "Fictive", status: "active" } })).id;
  await mkUser("admin", t1, ["tenant_admin"]); await mkUser("ops", t1, ["operations"]); await mkUser("fin", t1, ["finance"]);
  await mkUser("cons", t1, ["consultant"], { consultantId: consId });
  await mkUser("clientA", t1, ["client_user"], { companyId: coA }); await mkUser("clientB", t1, ["client_user"], { companyId: coB });
  await mkUser("admin2", t2, ["tenant_admin"]);
  app = await createApp(); await app.init();
  for (const k of ["admin", "ops", "fin", "cons", "clientA", "clientB"]) await login(k, S("c1"));
  await login("admin2", S("c2"));
  const m = await srv().post("/missions").set(H("ops")).send({ consultantId: consId, companyId: coA, title: "Mission test", dailyRate: "650.00", vatRate: "20", startDate: "2026-01-01" });
  expect(m.status).toBe(201); missionId = m.body.id;
});
beforeEach(() => resetLoginThrottle());
afterAll(async () => { await app.close(); await admin.$disconnect(); });

describe("onboarding consultant", () => {
  it("activation refusée tant que la checklist est incomplète, puis acceptée; mission refusée avant activation", async () => {
    const c = (await srv().post("/consultants").set(H("ops")).send({ firstName: "Nina", lastName: "Test" })).body;
    expect(c.tasks).toHaveLength(6); expect(c.status).toBe("onboarding");
    const bad = await srv().post(`/consultants/${c.id}/activate`).set(H("ops"));
    expect(bad.status).toBe(400); expect(bad.body.error.message).toMatch(/Onboarding incomplet/);
    const m = await srv().post("/missions").set(H("ops")).send({ consultantId: c.id, companyId: coA, title: "x", dailyRate: "500", vatRate: "20", startDate: "2026-01-01" });
    expect(m.status).toBe(400);
    for (const t of c.tasks) expect((await srv().post(`/consultants/${c.id}/tasks/${t.key}`).set(H("ops")).send({ done: true })).status).toBe(201);
    expect((await srv().post(`/consultants/${c.id}/activate`).set(H("ops"))).body.status).toBe("active");
    expect((await srv().post(`/consultants/${c.id}/activate`).set(H("ops"))).status).toBe(409);
  });
  it("la conversion d'un prospect consultant crée le dossier d'onboarding, sans doublon", async () => {
    await mkUser("com", t1, ["commerce"]); await login("com", S("c1"));
    const p = (await srv().post("/prospects").set(H("com")).send({ kind: "consultant", name: "Hugo Martin", email: "hugo@example.test" })).body.id;
    for (const ev of ["contact", "qualify", "convert"]) expect((await srv().post(`/prospects/${p}/transition`).set(H("com")).send({ event: ev })).status).toBe(201);
    const found = await admin.consultant.findFirst({ where: { sourceProspectId: p }, include: { tasks: true } });
    expect(found?.firstName).toBe("Hugo"); expect(found?.lastName).toBe("Martin"); expect(found?.tasks).toHaveLength(6);
    expect((await srv().post(`/prospects/${p}/transition`).set(H("com")).send({ event: "convert" })).status).toBe(400);
  });
});

describe("workflow 3 : CRA → facture → paiement → rapprochement", () => {
  let invId: string;
  it("saisie contrôlée du CRA", async () => {
    const put = (body: unknown, period = "2026-07") => srv().put(`/me/timesheets/missions/${missionId}/${period}`).set(H("cons")).send(body as object);
    expect((await put({ lines: [{ date: "2026-08-01", quantity: "1" }] })).status).toBe(400); // hors période
    expect((await put({ lines: [{ date: "2026-07-01", quantity: "0.75" }] })).status).toBe(400); // quantité
    expect((await put({ lines: [{ date: "2026-07-01", quantity: "1" }, { date: "2026-07-01", quantity: "0.5" }] })).status).toBe(400); // doublon
    expect((await put({ lines: [{ date: "2025-12-31", quantity: "1" }] }, "2025-12")).status).toBe(400); // avant la mission
    expect((await srv().put(`/me/timesheets/missions/${missionId}/2026-13`).set(H("cons")).send({ lines: [] })).status).toBe(400);
    const ok = await put({ lines: [{ date: "2026-07-01", quantity: "1" }, { date: "2026-07-02", quantity: "0.5" }] });
    expect(ok.status).toBe(200); expect(ok.body.totalDays).toBe("1.5");
  });
  it("circuit complet avec montants exacts, paiement partiel puis solde, et réconciliation", async () => {
    const tsId = await validatedTimesheet("2026-10", 19);
    // la validation est tracée dans l'audit (preuve : acteur, étape)
    const proof = await admin.auditEvent.findMany({ where: { entityId: tsId, action: { in: ["timesheet.approve", "timesheet.validate"] } } });
    expect(proof).toHaveLength(2);
    const inv = await srv().post("/invoices").set(H("fin")).send({ timesheetId: tsId });
    expect(inv.status).toBe(201); invId = inv.body.id;
    expect([inv.body.net, inv.body.vat, inv.body.gross]).toEqual(["12350", "2470", "14820"].map(v => `${v}`).map((_, i) => ["12350", "2470", "14820"][i]));
    expect((await srv().post("/invoices").set(H("fin")).send({ timesheetId: tsId })).status).toBe(400); // CRA déjà facturé (statut invoiced)
    expect((await srv().post(`/invoices/${invId}/payments`).set(H("fin")).send({ amount: "10", receivedOn: "2026-11-01" })).status).toBe(400); // brouillon
    const issued = await srv().post(`/invoices/${invId}/issue`).set(H("fin"));
    expect(issued.status).toBe(201); expect(issued.body.number).toMatch(/^FA-\d{4}-\d{6}$/); expect(issued.body.einvoiceStatus).toBe("not_connected");
    const p1 = await srv().post(`/invoices/${invId}/payments`).set(H("fin")).send({ amount: "5000.00", receivedOn: "2026-11-02", reference: "VIR-1" });
    expect(p1.body.status).toBe("partially_paid");
    expect((await srv().post(`/invoices/${invId}/payments`).set(H("fin")).send({ amount: "9820.01", receivedOn: "2026-11-03" })).status).toBe(400); // trop-perçu
    const p2 = await srv().post(`/invoices/${invId}/payments`).set(H("fin")).send({ amount: "9820.00", receivedOn: "2026-11-03" });
    expect(p2.body.status).toBe("paid"); expect(p2.body.paid).toBe("14820");
    const rec = await srv().get("/ledger/reconciliation").set(H("fin"));
    expect(rec.body).toMatchObject({ receivablesMatch: true, journalBalanced: true });
    const tb = Object.fromEntries((await srv().get("/ledger/trial-balance").set(H("fin"))).body.map((r: { account: string; debit: string; credit: string }) => [r.account, r]));
    expect(tb["512"].debit).toBe("14820"); expect(tb["706"].credit).toBe("12350"); expect(tb["44571"].credit).toBe("2470");
    expect((await srv().post(`/invoices/${invId}/cancel`).set(H("fin"))).status).toBe(400); // encaissée : avoir requis
  });
  it("la facture n'est plus modifiable via le CRA (verrouillé)", async () => {
    const ts = await admin.timesheet.findFirst({ where: { missionId, period: "2026-10" } });
    expect(ts?.status).toBe("invoiced");
    expect((await srv().put(`/me/timesheets/missions/${missionId}/2026-10`).set(H("cons")).send({ lines: [] })).status).toBe(400);
  });
  it("annulation d'une facture non encaissée : contrepassation, réconciliation conservée", async () => {
    const tsId = await validatedTimesheet("2026-09", 10);
    const inv = (await srv().post("/invoices").set(H("fin")).send({ timesheetId: tsId })).body.id;
    await srv().post(`/invoices/${inv}/issue`).set(H("fin"));
    const c = await srv().post(`/invoices/${inv}/cancel`).set(H("fin"));
    expect(c.body.status).toBe("cancelled");
    const rev = await admin.journalEntry.findFirst({ where: { tenantId: t1, key: `invoice.cancel:${inv}` } });
    expect(rev?.reversalOf).toBeTruthy();
    expect((await srv().get("/ledger/reconciliation").set(H("fin"))).body).toMatchObject({ receivablesMatch: true, journalBalanced: true });
    expect((await srv().post(`/invoices/${inv}/payments`).set(H("fin")).send({ amount: "10", receivedOn: "2026-11-03" })).status).toBe(400);
  });
  it("numérotation sans doublon sous émissions simultanées; double émission d'une même facture refusée", async () => {
    const ids: string[] = [];
    for (const period of ["2026-03", "2026-04", "2026-05"]) {
      const ts = await validatedTimesheet(period, 3);
      ids.push((await srv().post("/invoices").set(H("fin")).send({ timesheetId: ts })).body.id);
    }
    const res = await Promise.all(ids.map(id => srv().post(`/invoices/${id}/issue`).set(H("fin"))));
    expect(res.map(r => r.status)).toEqual([201, 201, 201]);
    const nums = res.map(r => r.body.number as string).sort();
    expect(new Set(nums).size).toBe(3);
    const seq = nums.map(n => Number(n.split("-")[2]));
    expect(seq[2]! - seq[0]!).toBe(2); // consécutifs, sans trou
    const dbl = await Promise.all([1, 2].map(() => srv().post(`/invoices/${ids[0]}/issue`).set(H("fin"))));
    expect(dbl.map(r => r.status).filter(s => s === 201)).toHaveLength(0); // déjà émise
    expect((await srv().get("/ledger/reconciliation").set(H("fin"))).body.journalBalanced).toBe(true);
  });
  it("encaissements simultanés : le total encaissé ne dépasse jamais le dû", async () => {
    const ts = await validatedTimesheet("2026-02", 2);
    const inv = (await srv().post("/invoices").set(H("fin")).send({ timesheetId: ts })).body; // 2 × 650 × 1,2 = 1560
    await srv().post(`/invoices/${inv.id}/issue`).set(H("fin"));
    const res = await Promise.all([1, 2, 3].map(() => srv().post(`/invoices/${inv.id}/payments`).set(H("fin")).send({ amount: "1000", receivedOn: "2026-11-04" })));
    expect(res.filter(r => r.status === 201)).toHaveLength(1);
    const after = await admin.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.paid.toString()).toBe("1000");
    expect((await srv().get("/ledger/reconciliation").set(H("fin"))).body.receivablesMatch).toBe(true);
  });
});

describe("droits, portails et isolation", () => {
  it("séparation des rôles", async () => {
    const ts = await validatedTimesheet("2026-06", 1);
    const inv = (await srv().post("/invoices").set(H("fin")).send({ timesheetId: ts })).body.id;
    expect((await srv().post(`/invoices/${inv}/issue`).set(H("ops"))).status).toBe(403); // opérations n'émet pas
    expect((await srv().post("/invoices").set(H("ops")).send({ timesheetId: ts })).status).toBe(403);
    expect((await srv().get("/invoices").set(H("cons"))).status).toBe(403);
    expect((await srv().get("/ledger/entries").set(H("ops"))).status).toBe(403);
    const sub = (await srv().put(`/me/timesheets/missions/${missionId}/2026-01`).set(H("cons")).send({ lines: days("2026-01", 2) })).body.id;
    await srv().post(`/me/timesheets/${sub}/transition`).set(H("cons")).send({ event: "submit" });
    expect((await srv().post(`/timesheets/${sub}/transition`).set(H("cons")).send({ event: "approve" })).status).toBe(403);
    expect((await srv().post(`/me/timesheets/${sub}/transition`).set(H("cons")).send({ event: "approve" })).status).toBe(403); // pas depuis le portail consultant
    expect((await srv().post(`/timesheets/${sub}/transition`).set(H("ops")).send({ event: "approve" })).status).toBe(403); // approbation = client uniquement
    expect((await srv().post(`/client/timesheets/${sub}/transition`).set(H("clientA")).send({ event: "validate" })).status).toBe(403);
    expect((await srv().post(`/client/timesheets/${sub}/transition`).set(H("clientA")).send({ event: "reject" })).status).toBe(400); // motif obligatoire
    const rej = await srv().post(`/client/timesheets/${sub}/transition`).set(H("clientA")).send({ event: "reject", rejectReason: "Jours erronés" });
    expect(rej.body.status).toBe("client_rejected"); expect(rej.body.rejectReason).toBe("Jours erronés");
    expect((await srv().post(`/me/timesheets/${sub}/transition`).set(H("cons")).send({ event: "reopen" })).body.status).toBe("draft");
  });
  it("portail client : cloisonné par entreprise, sans aucune donnée tarifaire ni salariale", async () => {
    const tsId = (await srv().put(`/me/timesheets/missions/${missionId}/2026-11`).set(H("cons")).send({ lines: days("2026-11", 4) })).body.id;
    await srv().post(`/me/timesheets/${tsId}/transition`).set(H("cons")).send({ event: "submit" });
    const a = await srv().get("/client/timesheets").set(H("clientA"));
    expect(a.body.some((t: { id: string }) => t.id === tsId)).toBe(true);
    const raw = JSON.stringify(a.body);
    for (const forbidden of ["dailyRate", "unitPrice", "vatRate", "650", "salary", "gross"]) expect(raw).not.toContain(forbidden);
    expect((await srv().get("/client/timesheets").set(H("clientB"))).body).toEqual([]); // autre entreprise du même tenant
    expect((await srv().post(`/client/timesheets/${tsId}/transition`).set(H("clientB")).send({ event: "approve" })).status).toBe(404); // IDOR
    expect((await srv().get("/invoices").set(H("clientA"))).status).toBe(403);
    expect((await srv().get("/missions").set(H("clientA"))).status).toBe(403);
  });
  it("portail consultant : uniquement son dossier; compte non rattaché refusé", async () => {
    const other = (await admin.consultant.create({ data: { tenantId: t1, firstName: "Autre", lastName: "Consultant", status: "active" } })).id;
    const om = (await admin.mission.create({ data: { tenantId: t1, consultantId: other, companyId: coA, title: "Mission d'un autre", dailyRate: "100", vatRate: "20", startDate: new Date("2026-01-01") } })).id;
    expect((await srv().put(`/me/timesheets/missions/${om}/2026-05`).set(H("cons")).send({ lines: [] })).status).toBe(404);
    expect((await srv().get("/me/missions").set(H("cons"))).body.every((m: { title: string }) => m.title !== "Mission d'un autre")).toBe(true);
    await mkUser("orphan", t1, ["consultant"]); await login("orphan", S("c1"));
    expect((await srv().get("/me/missions").set(H("orphan"))).status).toBe(403);
  });
  it("isolation inter-tenant sur factures, CRA, journal", async () => {
    const id = (await admin.invoice.findFirst({ where: { tenantId: t1 } }))!.id;
    const tsId = (await admin.timesheet.findFirst({ where: { tenantId: t1 } }))!.id;
    expect((await srv().get(`/invoices/${id}`).set(H("admin2"))).status).toBe(404);
    expect((await srv().post(`/invoices/${id}/issue`).set(H("admin2"))).status).toBe(404);
    expect((await srv().get(`/timesheets/${tsId}`).set(H("admin2"))).status).toBe(404);
    expect((await srv().get("/ledger/entries").set(H("admin2"))).body).toEqual([]);
    expect((await srv().get("/missions").set(H("admin2"))).body).toEqual([]);
  });
});

describe("registre financier : garanties en base", () => {
  it("journal et paiements append-only; écriture déséquilibrée refusée à la validation", async () => {
    const e = await admin.journalEntry.findFirst({ where: { tenantId: t1 } });
    await expect(admin.journalEntry.update({ where: { id: e!.id }, data: { label: "x" } })).rejects.toThrow(/append-only/);
    await expect(admin.journalEntry.delete({ where: { id: e!.id } })).rejects.toThrow(/append-only/);
    const p = await admin.payment.findFirst({ where: { tenantId: t1 } });
    await expect(admin.payment.delete({ where: { id: p!.id } })).rejects.toThrow(/append-only/);
    await expect(admin.journalEntry.create({ data: { tenantId: t1, key: `bad-${run}`, valueDate: new Date(), label: "déséquilibrée", sourceType: "test", sourceId: "x",
      lines: { create: [{ tenantId: t1, account: "411", debit: "100" }, { tenantId: t1, account: "706", credit: "99" }] } } })).rejects.toThrow(/déséquilibrée/);
    await expect(admin.journalEntry.create({ data: { tenantId: t1, key: `bad2-${run}`, valueDate: new Date(), label: "double sens", sourceType: "test", sourceId: "x",
      lines: { create: [{ tenantId: t1, account: "411", debit: "100", credit: "100" }] } } })).rejects.toThrow();
  });
  it("contraintes : quantité de jour, solde facture", async () => {
    const ts = await admin.timesheet.findFirst({ where: { tenantId: t1 } });
    await expect(admin.timesheetLine.create({ data: { tenantId: t1, timesheetId: ts!.id, date: new Date("2026-12-30"), quantity: "2" } })).rejects.toThrow();
    const inv = await admin.invoice.findFirst({ where: { tenantId: t1 } });
    await expect(admin.invoice.update({ where: { id: inv!.id }, data: { paid: "99999999" } })).rejects.toThrow();
  });
});

describe("portail consultant : feuille par période", () => {
  it("le filtre de période renvoie la feuille demandée même au-delà de la liste récente; période invalide refusée", async () => {
    const far = "9876-05";
    await srv().put(`/me/timesheets/missions/${missionId}/${far}`).set(H("cons")).send({ lines: [{ date: `${far}-04`, quantity: "1" }] });
    const one = (await srv().get(`/me/timesheets?period=${far}`).set(H("cons"))).body;
    expect(one).toHaveLength(1); expect(one[0].period).toBe(far); expect(one[0].totalDays).toBe("1");
    expect((await srv().get("/me/timesheets?period=2026-13").set(H("cons"))).status).toBe(400);
    expect((await srv().get("/me/timesheets?period=2026-10").set(H("cons"))).body.every((t: { period: string }) => t.period === "2026-10")).toBe(true);
  });
});
