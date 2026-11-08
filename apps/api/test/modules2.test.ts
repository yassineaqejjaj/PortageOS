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
const run = Date.now().toString(36) + "m";
const T = new Date().toISOString().slice(0, 10), PERIOD = T.slice(0, 7);
let t1: string, t2: string, consId: string, cons2Id: string, coId: string, missionId: string;
const tok: Record<string, string> = {};
const S = (n: string) => `${n}-${run}`;
const srv = () => request(app.getHttpServer());
const H = (k: string) => ({ Authorization: `Bearer ${tok[k]}` });
const SRC = "Source de test automatisé (jeu de test, valeur fictive)";

async function mk(key: string, tenantId: string, roles: string[], extra: { companyId?: string; consultantId?: string } = {}) {
  const u = await admin.user.create({ data: { email: `${key.toLowerCase()}-${run}@x.test`, passwordHash: await hashPassword(PW) } });
  await admin.membership.create({ data: { userId: u.id, tenantId, roles, ...extra } });
}
async function login(key: string, slug: string) {
  tok[key] = (await srv().post("/auth/login").send({ email: `${key.toLowerCase()}-${run}@x.test`, password: PW, tenantSlug: slug })).body.accessToken;
}
async function param(by: string, approver: string, key: string, value: string, validFrom = "2026-01-01", unit = "x") {
  const d = await srv().post("/rules/parameters").set(H(by)).send({ key, value, unit, validFrom, source: SRC });
  expect(d.status).toBe(201);
  expect((await srv().post(`/rules/parameters/${d.body.id}/approve`).set(H(approver))).status).toBe(201);
}
/** Facture émise (et optionnellement encaissée) à partir d'un CRA validé injecté en base. */
async function issuedInvoice(tenantId: string, who: string, mId: string, period: string, days: number) {
  const ts = await admin.timesheet.create({ data: { tenantId, missionId: mId, period, status: "validated" } });
  for (let i = 1; i <= days; i++) await admin.timesheetLine.create({ data: { tenantId, timesheetId: ts.id, date: new Date(`${period}-${String(i).padStart(2, "0")}`), quantity: "1" } });
  const inv = (await srv().post("/invoices").set(H(who)).send({ timesheetId: ts.id })).body;
  const iss = await srv().post(`/invoices/${inv.id}/issue`).set(H(who));
  expect(iss.status).toBe(201);
  return iss.body as { id: string; number: string; gross: string; net: string };
}

beforeAll(async () => {
  t1 = (await admin.tenant.create({ data: { slug: S("m1"), name: "Modules 1" } })).id;
  t2 = (await admin.tenant.create({ data: { slug: S("m2"), name: "Modules 2" } })).id;
  coId = (await admin.company.create({ data: { tenantId: t1, name: "Client M" } })).id;
  const co2 = (await admin.company.create({ data: { tenantId: t2, name: "Client M2" } })).id;
  consId = (await admin.consultant.create({ data: { tenantId: t1, firstName: "Cons", lastName: "Un", status: "active" } })).id;
  cons2Id = (await admin.consultant.create({ data: { tenantId: t1, firstName: "Cons", lastName: "Deux", status: "active" } })).id;
  const cons3 = (await admin.consultant.create({ data: { tenantId: t2, firstName: "Cons", lastName: "Trois", status: "active" } })).id;
  missionId = (await admin.mission.create({ data: { tenantId: t1, consultantId: consId, companyId: coId, title: "M", dailyRate: "650.00", vatRate: "20", startDate: new Date("2026-01-01") } })).id;
  const m3 = (await admin.mission.create({ data: { tenantId: t2, consultantId: cons3, companyId: co2, title: "M3", dailyRate: "650.00", vatRate: "20", startDate: new Date("2026-01-01") } })).id;
  await mk("admin", t1, ["tenant_admin"]); await mk("compl", t1, ["compliance"]); await mk("hr", t1, ["hr"]); await mk("ops", t1, ["operations"]); await mk("fin", t1, ["finance"]);
  await mk("cons", t1, ["consultant"], { consultantId: consId }); await mk("cons2", t1, ["consultant"], { consultantId: cons2Id });
  await mk("hybrid", t1, ["consultant", "operations"], { consultantId: consId }); await mk("admin2", t2, ["tenant_admin"]);
  app = await createApp(); await app.init();
  for (const k of ["admin", "compl", "hr", "ops", "fin", "cons", "cons2", "hybrid"]) await login(k, S("m1"));
  await login("admin2", S("m2"));
  (globalThis as unknown as { m3: string }).m3 = m3;
});
beforeEach(() => resetLoginThrottle());
afterAll(async () => { await app.close(); await admin.$disconnect(); });

describe("paramètres réglementaires (quatre yeux, datés, immuables)", () => {
  it("source obligatoire, auteur ≠ approbateur, chevauchement refusé, immuabilité en base", async () => {
    expect((await srv().post("/rules/parameters").set(H("compl")).send({ key: "test.p1", value: "1", unit: "x", validFrom: "2026-01-01", source: "court" })).status).toBe(400);
    const d = (await srv().post("/rules/parameters").set(H("compl")).send({ key: "test.p1", value: "1", unit: "x", validFrom: "2026-01-01", validTo: "2026-06-30", source: SRC })).body;
    expect((await srv().post(`/rules/parameters/${d.id}/approve`).set(H("compl"))).status).toBe(403); // auteur
    expect((await srv().post(`/rules/parameters/${d.id}/approve`).set(H("ops"))).status).toBe(403); // pas de droit
    expect((await srv().post(`/rules/parameters/${d.id}/approve`).set(H("admin"))).status).toBe(201);
    const o = (await srv().post("/rules/parameters").set(H("compl")).send({ key: "test.p1", value: "2", unit: "x", validFrom: "2026-03-01", source: SRC })).body;
    expect((await srv().post(`/rules/parameters/${o.id}/approve`).set(H("admin"))).status).toBe(409);
    await param("compl", "admin", "test.p1", "3", "2026-07-01");
    expect((await srv().get("/rules/parameters/at?key=test.p1&date=2026-05-01").set(H("fin"))).body.value).toBe("1");
    expect((await srv().get("/rules/parameters/at?key=test.p1&date=2026-08-01").set(H("fin"))).body.value).toBe("3");
    expect((await srv().get("/rules/parameters/at?key=test.p1&date=2025-01-01").set(H("fin"))).status).toBe(404);
    await expect(admin.ruleParameter.update({ where: { id: d.id }, data: { value: "999" } })).rejects.toThrow(/immuable/);
    await expect(admin.ruleParameter.delete({ where: { id: d.id } })).rejects.toThrow(/immuable/);
    const bad = await admin.ruleParameter.create({ data: { tenantId: t1, key: "test.p9", value: "1", unit: "x", validFrom: new Date("2026-01-01"), source: SRC, createdBy: "u1" } });
    await expect(admin.ruleParameter.update({ where: { id: bad.id }, data: { status: "approved", approvedBy: "u1" } })).rejects.toThrow(); // CHECK quatre yeux
    expect((await srv().get("/rules/parameters").set(H("cons"))).status).toBe(403);
  });
});

describe("notes de frais", () => {
  let claim: string;
  it("sans barème approuvé, une indemnité kilométrique est refusée (aucune valeur par défaut)", async () => {
    claim = (await srv().post("/me/expenses").set(H("cons")).send({ title: "Octobre" })).body.id;
    const r = await srv().put(`/me/expenses/${claim}/lines`).set(H("cons")).send({ lines: [{ date: "2026-10-05", category: "mileage", description: "Trajet client", km: "100" }] });
    expect(r.status).toBe(422); expect(r.body.error.message).toMatch(/Barème kilométrique non paramétré/);
  });
  it("barème approuvé : montant calculé côté serveur, plafond repas signalé, justificatifs et doublons contrôlés", async () => {
    await param("compl", "admin", "expense.mileage_rate_eur_per_km", "0.50", "2026-01-01", "EUR/km");
    await param("compl", "admin", "expense.meal_max_eur", "20", "2026-01-01", "EUR");
    const r = await srv().put(`/me/expenses/${claim}/lines`).set(H("cons")).send({ lines: [
      { date: "2026-10-05", category: "mileage", description: "Trajet client", km: "100", amount: "9999" },
      { date: "2026-10-06", category: "meal", description: "Déjeuner", amount: "25.00" }] });
    expect(r.status).toBe(200);
    const m = r.body.lines.find((l: { category: string }) => l.category === "mileage"), meal = r.body.lines.find((l: { category: string }) => l.category === "meal");
    expect(m.amount).toBe("50"); expect(meal.policyFlag).toMatch(/plafond repas/); expect(r.body.total).toBe("75");
    const sub = await srv().post(`/me/expenses/${claim}/transition`).set(H("cons")).send({ event: "submit" });
    expect(sub.status).toBe(400); expect(sub.body.error.message).toMatch(/sans justificatif/);
    await srv().put(`/me/expenses/${claim}/lines`).set(H("cons")).send({ lines: [
      { date: "2026-10-05", category: "mileage", description: "Trajet client", km: "100" },
      { date: "2026-10-06", category: "meal", description: "Déjeuner", amount: "25.00", receiptRef: "TICKET-1" }] });
    const other = (await srv().post("/me/expenses").set(H("cons")).send({ title: "Doublon" })).body.id;
    const dup = await srv().put(`/me/expenses/${other}/lines`).set(H("cons")).send({ lines: [{ date: "2026-10-06", category: "meal", description: "Déjeuner", amount: "25", receiptRef: "TICKET-1" }] });
    expect(dup.status).toBe(409);
    expect((await srv().post(`/me/expenses/${claim}/transition`).set(H("cons")).send({ event: "submit" })).body.status).toBe("submitted");
    expect((await srv().put(`/me/expenses/${claim}/lines`).set(H("cons")).send({ lines: [] })).status).toBe(400); // plus modifiable
  });
  it("séparation des tâches, refus motivé, remboursement réservé à la finance, écriture au journal", async () => {
    expect((await srv().post(`/me/expenses/${claim}/transition`).set(H("cons")).send({ event: "approve" })).status).toBe(403);
    expect((await srv().post(`/expenses/${claim}/transition`).set(H("cons")).send({ event: "approve" })).status).toBe(403);
    const own = await srv().post(`/expenses/${claim}/transition`).set(H("hybrid")).send({ event: "approve" }); // même dossier consultant, mais ≠ propriétaire user
    expect(own.status).toBe(201); // hybrid n'est pas le propriétaire (cons l'est) : l'approbation est permise
    const sc = (await srv().post("/me/expenses").set(H("hybrid")).send({ title: "Mes frais" })).body.id;
    await srv().put(`/me/expenses/${sc}/lines`).set(H("hybrid")).send({ lines: [{ date: "2026-10-07", category: "hotel", description: "Hôtel", amount: "80", receiptRef: "H-1" }] });
    await srv().post(`/me/expenses/${sc}/transition`).set(H("hybrid")).send({ event: "submit" });
    const self = await srv().post(`/expenses/${sc}/transition`).set(H("hybrid")).send({ event: "approve" });
    expect(self.status).toBe(400); expect(self.body.error.message).toMatch(/propres frais/);
    expect((await srv().post(`/expenses/${sc}/transition`).set(H("ops")).send({ event: "reject" })).status).toBe(400);
    expect((await srv().post(`/expenses/${sc}/transition`).set(H("ops")).send({ event: "reject", rejectReason: "Justificatif illisible" })).body.status).toBe("rejected");
    expect((await srv().post(`/expenses/${claim}/transition`).set(H("ops")).send({ event: "reimburse" })).status).toBe(403);
    expect((await srv().post(`/expenses/${claim}/transition`).set(H("fin")).send({ event: "reimburse" })).body.status).toBe("reimbursed");
    const e = await admin.journalEntry.findFirst({ where: { tenantId: t1, key: `expense.reimburse:${claim}` }, include: { lines: true } });
    expect(e?.lines.map(l => [l.account, l.debit.toString(), l.credit.toString()]).sort()).toEqual([["512", "0", "75"], ["6251", "75", "0"]]);
    expect((await srv().get("/ledger/reconciliation").set(H("fin"))).body.journalBalanced).toBe(true);
  });
  it("IDOR et isolation : un autre consultant/tenant ne voit pas la note", async () => {
    expect((await srv().put(`/me/expenses/${claim}/lines`).set(H("cons2")).send({ lines: [] })).status).toBe(404);
    expect((await srv().post(`/me/expenses/${claim}/transition`).set(H("cons2")).send({ event: "recall" })).status).toBe(404);
    expect((await srv().get("/me/expenses").set(H("cons2"))).body).toEqual([]);
    expect((await srv().get("/expenses").set(H("admin2"))).body).toEqual([]);
  });
});

describe("avoirs", () => {
  it("avoir total sur facture encaissée : numéro AV, contrepassation, 411 = trop-perçu, non répétable, droits", async () => {
    const inv = await issuedInvoice(t1, "admin", missionId, "2026-02", 2); // 2 × 650 = 1300 HT, 1560 TTC
    await srv().post(`/invoices/${inv.id}/payments`).set(H("fin")).send({ amount: "500.00", receivedOn: T });
    expect((await srv().post(`/invoices/${inv.id}/credit`).set(H("ops")).send({ reason: "Erreur de facturation" })).status).toBe(403);
    expect((await srv().post(`/invoices/${inv.id}/credit`).set(H("fin")).send({ reason: "x" })).status).toBe(400);
    const c = await srv().post(`/invoices/${inv.id}/credit`).set(H("fin")).send({ reason: "Erreur de facturation" });
    expect(c.status).toBe(201); expect(c.body.invoice.status).toBe("credited"); expect(c.body.creditNote.number).toMatch(/^AV-\d{4}-\d{6}$/);
    expect((await srv().post(`/invoices/${inv.id}/credit`).set(H("fin")).send({ reason: "Encore une fois" })).status).toBe(400);
    expect((await srv().post(`/invoices/${inv.id}/payments`).set(H("fin")).send({ amount: "10", receivedOn: T })).status).toBe(400);
    const rec = (await srv().get("/ledger/reconciliation").set(H("fin"))).body;
    expect(rec.receivablesMatch).toBe(true); expect(rec.journalBalanced).toBe(true);
    await expect(admin.creditNote.delete({ where: { invoiceId: inv.id } })).rejects.toThrow(/append-only/);
  });
});

describe("compte d'activité (estimation sourcée)", () => {
  it("frais de gestion = paramètre daté ; jamais inventé s'il manque ; portail consultant cloisonné", async () => {
    // tenant 2 : aucun paramètre => frais de gestion indisponibles, solde non calculé
    const m3 = (globalThis as unknown as { m3: string }).m3;
    const i2 = await issuedInvoice(t2, "admin2", m3, "2026-03", 2);
    await srv().post(`/invoices/${i2.id}/payments`).set(H("admin2")).send({ amount: "1560.00", receivedOn: T });
    const cons3 = (await admin.mission.findUniqueOrThrow({ where: { id: m3 } })).consultantId;
    const miss = (await srv().get(`/accounts/${cons3}?period=${PERIOD}`).set(H("admin2"))).body;
    expect(miss.feeStatus).toBe("parameter_missing"); expect(miss.managementFee).toBeNull(); expect(miss.balanceBeforeSocialAndSalary).toBeNull(); expect(miss.estimate).toBe(true);
    // tenant 1 : paramètre 10 % + une facture encaissée + frais remboursés (75 €, ce mois-ci)
    await param("compl", "admin", "management_fee_rate_percent", "10", "2026-01-01", "%");
    const i1 = await issuedInvoice(t1, "admin", missionId, "2026-04", 2);
    await srv().post(`/invoices/${i1.id}/payments`).set(H("fin")).send({ amount: "1560.00", receivedOn: T });
    const a = await srv().get(`/accounts/${consId}?period=${PERIOD}`).set(H("fin"));
    expect(a.body).toMatchObject({ feeStatus: "computed", collectedNet: "1300.00", managementFee: "130.00", expensesReimbursed: "75.00", balanceBeforeSocialAndSalary: "1095.00" });
    expect(a.body.parametersUsed[0].source).toBe(SRC); expect(a.body.disclaimer).toMatch(/ni un bulletin de paie/);
    const mine = await srv().get(`/me/account?period=${PERIOD}`).set(H("cons"));
    expect(mine.body.balanceBeforeSocialAndSalary).toBe("1095.00");
    expect((await srv().get(`/me/account?period=${PERIOD}`).set(H("cons2"))).body.collectedNet).toBe("0.00"); // son propre compte, vide
    expect((await srv().get(`/accounts/${consId}?period=${PERIOD}`).set(H("cons"))).status).toBe(403);
    expect((await srv().get(`/accounts/${consId}?period=${PERIOD}`).set(H("admin2"))).status).toBe(404); // isolation tenant
    expect((await srv().get(`/accounts/${consId}?period=2026-13`).set(H("fin"))).status).toBe(400);
  });
});

describe("contrats versionnés et signature déclarée", () => {
  it("modèles versionnés immuables après publication, variables strictes, signature tracée, onboarding mis à jour", async () => {
    const body = "Contrat entre {{societe}} et {{nom}}, à compter du {{debut}}.";
    expect((await srv().post("/contract-templates").set(H("ops")).send({ kind: "employment_cdi", name: S("CDI"), body })).status).toBe(403);
    const t1v = (await srv().post("/contract-templates").set(H("hr")).send({ kind: "employment_cdi", name: S("CDI"), body })).body;
    expect(t1v.version).toBe(1); expect(t1v.variables).toEqual(["debut", "nom", "societe"]);
    const nc = (await srv().post("/consultants").set(H("ops")).send({ firstName: "Nora", lastName: "Contrat" })).body;
    const vars = { societe: "Société Fictive", nom: "Nora Contrat", debut: "2026-12-01" };
    expect((await srv().post("/contracts").set(H("hr")).send({ templateId: t1v.id, consultantId: nc.id, variables: vars })).status).toBe(400); // non publié
    expect((await srv().post(`/contract-templates/${t1v.id}/publish`).set(H("hr"))).status).toBe(201);
    expect((await srv().post(`/contract-templates/${t1v.id}/publish`).set(H("hr"))).status).toBe(409);
    await expect(admin.contractTemplate.update({ where: { id: t1v.id }, data: { body: "modifié" } })).rejects.toThrow(/immuable/);
    expect((await srv().post("/contract-templates").set(H("hr")).send({ kind: "employment_cdi", name: S("CDI"), body: body + " v2" })).body.version).toBe(2);
    expect((await srv().post("/contracts").set(H("hr")).send({ templateId: t1v.id, consultantId: nc.id, variables: { societe: "S", nom: "N" } })).status).toBe(400); // manquante
    expect((await srv().post("/contracts").set(H("hr")).send({ templateId: t1v.id, consultantId: nc.id, variables: { ...vars, extra: "x" } })).status).toBe(400); // inconnue
    expect((await srv().post("/contracts").set(H("hr")).send({ templateId: t1v.id, variables: vars })).status).toBe(400); // consultant requis
    const c = (await srv().post("/contracts").set(H("hr")).send({ templateId: t1v.id, consultantId: nc.id, variables: vars })).body;
    expect(c.renderedBody).toBe("Contrat entre Société Fictive et Nora Contrat, à compter du 2026-12-01.");
    expect((await srv().post(`/contracts/${c.id}/transition`).set(H("hr")).send({ event: "sign", signatureDeclaration: "Signé sur papier le 01/12" })).status).toBe(400); // pas envoyé
    expect((await srv().post(`/contracts/${c.id}/transition`).set(H("ops")).send({ event: "send" })).status).toBe(403);
    expect((await srv().post(`/contracts/${c.id}/transition`).set(H("hr")).send({ event: "send" })).body.status).toBe("sent");
    expect((await srv().post(`/contracts/${c.id}/transition`).set(H("hr")).send({ event: "sign", signatureDeclaration: "court" })).status).toBe(400);
    const s = await srv().post(`/contracts/${c.id}/transition`).set(H("hr")).send({ event: "sign", signatureDeclaration: "Exemplaires signés reçus le 01/12" });
    expect(s.body.status).toBe("signed"); expect(s.body.signatureProvider).toBe("none"); expect(s.body.signatureEvidence).toMatch(/^declared_by:/);
    const task = await admin.onboardingTask.findUnique({ where: { consultantId_key: { consultantId: nc.id, key: "employment_contract_signed" } } });
    expect(task?.doneAt).toBeTruthy();
    expect((await srv().post(`/contracts/${c.id}/transition`).set(H("hr")).send({ event: "cancel" })).status).toBe(400);
    await expect(admin.contract.update({ where: { id: c.id }, data: { renderedBody: "falsifié" } })).rejects.toThrow(/immuable/);
    expect((await srv().get(`/contracts/${c.id}`).set(H("admin2"))).status).toBe(404);
    expect(DEFAULT_TASKS.some(t => t.key === "employment_contract_signed")).toBe(true);
  });
});
