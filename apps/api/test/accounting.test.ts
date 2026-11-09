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
const NOW = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date()), MONTH = NOW.slice(0, 7);
const tok: Record<string, string> = {}; const S = (n: string) => `${n}-${run}`;
const srv = () => request(app.getHttpServer()); const H = (k: string) => ({ Authorization: `Bearer ${tok[k]}` });
const T: Record<string, string> = {}, MISSION: Record<string, string> = {};

async function mk(key: string, tenantId: string, roles: string[]) {
  const u = await admin.user.create({ data: { email: `${key.toLowerCase()}-${run}@x.test`, passwordHash: await hashPassword(PW) } });
  await admin.membership.create({ data: { userId: u.id, tenantId, roles } });
}
async function login(key: string, slug: string) { tok[key] = (await srv().post("/auth/login").send({ email: `${key.toLowerCase()}-${run}@x.test`, password: PW, tenantSlug: slug })).body.accessToken; }
async function tenant(name: string) {
  const id = (await admin.tenant.create({ data: { slug: S(name), name } })).id; T[name] = id;
  const co = (await admin.company.create({ data: { tenantId: id, name: `Client ${name}` } })).id;
  const c = (await admin.consultant.create({ data: { tenantId: id, firstName: "C", lastName: name, status: "active" } })).id;
  MISSION[name] = (await admin.mission.create({ data: { tenantId: id, consultantId: c, companyId: co, title: "M", dailyRate: "650.00", vatRate: "20", startDate: new Date("2024-01-01") } })).id; return id;
}
async function inv(name: string, who: string, period: string, days: number, issue = true) {
  const ts = await admin.timesheet.create({ data: { tenantId: T[name]!, missionId: MISSION[name]!, period, status: "validated" } });
  for (let i = 1; i <= days; i++) await admin.timesheetLine.create({ data: { tenantId: T[name]!, timesheetId: ts.id, date: new Date(`${period}-${String(i).padStart(2, "0")}`), quantity: "1" } });
  const d = (await srv().post("/invoices").set(H(who)).send({ timesheetId: ts.id })).body;
  if (issue) expect((await srv().post(`/invoices/${d.id}/issue`).set(H(who))).status).toBe(201);
  return d.id as string;
}
const entry = (who: string, valueDate: string, lines: object[], extra: object = {}) => srv().post("/accounting/entries").set(H(who)).send({ valueDate, label: "Écriture de test", reason: "Régularisation de test", lines, ...extra });
const two = (a: string, b: string, amt: string) => [{ account: a, debit: amt }, { account: b, credit: amt }];

beforeAll(async () => {
  await tenant("ac1"); await tenant("ac2"); await tenant("ac3");
  await mk("admin", T.ac1!, ["tenant_admin"]); await mk("fin", T.ac1!, ["finance"]); await mk("ops", T.ac1!, ["operations"]); await mk("acc", T.ac1!, ["external_accountant"]); await mk("dir", T.ac1!, ["direction"]);
  await mk("admin2", T.ac2!, ["tenant_admin"]); await mk("admin3", T.ac3!, ["tenant_admin"]); await mk("acc3", T.ac3!, ["external_accountant"]); await mk("dir3", T.ac3!, ["direction"]);
  app = await createApp(); await app.init();
  for (const k of ["admin", "fin", "ops", "acc", "dir"]) await login(k, S("ac1"));
  await login("admin2", S("ac2")); for (const k of ["admin3", "acc3", "dir3"]) await login(k, S("ac3"));
});
beforeEach(() => resetLoginThrottle());
afterAll(async () => { await app.close(); await admin.$disconnect(); });

describe("plan comptable", () => {
  it("plan par défaut créé à la demande, comptes système protégés, droits", async () => {
    const a = (await srv().get("/accounting/accounts").set(H("fin"))).body as { code: string; system: boolean }[];
    expect(a.map(x => x.code)).toEqual(["411", "44571", "512", "6251", "706"]); expect(a.every(x => x.system)).toBe(true);
    expect((await srv().post("/accounting/accounts").set(H("fin")).send({ code: "401", label: "Fournisseurs", type: "liability" })).status).toBe(201);
    expect((await srv().post("/accounting/accounts").set(H("fin")).send({ code: "401", label: "Doublon", type: "liability" })).status).toBe(409);
    expect((await srv().post("/accounting/accounts").set(H("fin")).send({ code: "0123", label: "Invalide", type: "asset" })).status).toBe(400);
    expect((await srv().post("/accounting/accounts").set(H("ops")).send({ code: "402", label: "x", type: "asset" })).status).toBe(403);
    expect((await srv().post("/accounting/accounts").set(H("acc")).send({ code: "402", label: "x", type: "asset" })).status).toBe(403); // expert-comptable : lecture
    expect((await srv().get("/accounting/accounts").set(H("acc"))).status).toBe(200);
    expect((await srv().patch("/accounting/accounts/411").set(H("fin")).send({ active: false })).status).toBe(409);
    expect((await srv().patch("/accounting/accounts/401").set(H("fin")).send({ active: false })).status).toBe(200);
    expect((await entry("fin", "2025-01-10", two("401", "706", "10"))).status).toBe(400); // compte inactif
    await expect(admin.account.create({ data: { tenantId: T.ac1!, code: "0999", label: "x", type: "asset" } })).rejects.toThrow();
  });
});

describe("écritures manuelles et contrepassation", () => {
  let e1: string;
  it("validations, équilibre, comptes, motif, droits", async () => {
    expect((await entry("fin", "2025-01-15", [{ account: "512", debit: "100" }, { account: "706", credit: "99" }])).status).toBe(400);
    expect((await entry("fin", "2025-01-15", [{ account: "512", debit: "100" }])).status).toBe(400);
    expect((await entry("fin", "2025-01-15", [{ account: "512", debit: "0" }, { account: "706", credit: "0" }])).status).toBe(400);
    expect((await entry("fin", "2025-01-15", [{ account: "512", debit: "50", credit: "50" }, { account: "706", credit: "0.01" }])).status).toBe(400);
    expect((await entry("fin", "2025-01-15", two("512", "999", "10"))).status).toBe(400);
    expect((await entry("fin", "2025-01-15", two("512", "706", "10"), { reason: "x" })).status).toBe(400);
    expect((await entry("ops", "2025-01-15", two("512", "706", "10"))).status).toBe(403);
    expect((await entry("acc", "2025-01-15", two("512", "706", "10"))).status).toBe(403);
    const ok = await entry("fin", "2025-01-15", two("512", "706", "100")); expect(ok.status).toBe(201); e1 = ok.body.id;
  });
  it("contrepassation unique, réservée aux écritures manuelles", async () => {
    const rev = await srv().post(`/accounting/entries/${e1}/reverse`).set(H("fin")).send({ reason: "Erreur de saisie" });
    expect(rev.status).toBe(201); expect(rev.body.reversalOf).toBe(e1);
    expect((await srv().post(`/accounting/entries/${e1}/reverse`).set(H("fin")).send({ reason: "Encore une fois" })).status).toBe(409);
    expect((await srv().post(`/accounting/entries/${rev.body.id}/reverse`).set(H("fin")).send({ reason: "Contre-contrepassation" })).status).toBe(409);
    expect((await srv().post(`/accounting/entries/${e1}/reverse`).set(H("acc")).send({ reason: "Pas le droit" })).status).toBe(403);
    expect((await srv().post(`/accounting/entries/${e1}/reverse`).set(H("fin")).send({ reason: "x" })).status).toBe(400);
    const sys = await inv("ac1", "admin", "2024-06", 1); void sys;
    const sysEntry = await admin.journalEntry.findFirstOrThrow({ where: { tenantId: T.ac1!, sourceType: "invoice" } });
    expect((await srv().post(`/accounting/entries/${sysEntry.id}/reverse`).set(H("fin")).send({ reason: "Écriture automatique" })).status).toBe(403);
  });
});

describe("clôture mensuelle", () => {
  let draftInv: string;
  it("contrôles bloquants (brouillons, périodes antérieures) puis avertissements à accuser", async () => {
    await entry("fin", "2025-02-10", two("512", "706", "50"));
    expect((await entry("fin", "2025-01-20", two("411", "706", "100"))).status).toBe(201); // fait diverger 411 des factures
    const c2 = (await srv().get("/accounting/periods/2025-02/checks").set(H("fin"))).body;
    expect(c2.blockers.map((b: { code: string }) => b.code)).toContain("earlier_open");
    expect((await srv().post("/accounting/periods/2025-02/close").set(H("fin")).send({ acknowledgeWarnings: true })).status).toBe(409);
    draftInv = await inv("ac1", "admin", "2025-01", 2, false);
    expect((await srv().get("/accounting/periods/2025-01/checks").set(H("fin"))).body.blockers.map((b: { code: string }) => b.code)).toContain("draft_invoices");
    const blocked = await srv().post("/accounting/periods/2025-01/close").set(H("fin")).send({ acknowledgeWarnings: true });
    expect(blocked.status).toBe(409); expect(blocked.body.error.message).toMatch(/brouillon/);
    expect((await srv().post(`/invoices/${draftInv}/issue`).set(H("admin"))).status).toBe(201);
    const noAck = await srv().post("/accounting/periods/2025-01/close").set(H("fin")).send({});
    expect(noAck.status).toBe(409); expect(noAck.body.error.message).toMatch(/Écart de rapprochement/);
    expect((await srv().get("/accounting/periods/2025-01/checks").set(H("fin"))).body.status).toBe("open");
    expect((await srv().post("/accounting/periods/2025-01/close").set(H("ops")).send({ acknowledgeWarnings: true })).status).toBe(403);
    expect((await srv().post("/accounting/periods/2025-01/close").set(H("acc")).send({ acknowledgeWarnings: true })).status).toBe(403);
    expect((await srv().post("/accounting/periods/2025-01/close").set(H("fin")).send({ acknowledgeWarnings: true, comment: "Clôture de test" })).body.status).toBe("closed");
    expect((await srv().post("/accounting/periods/2025-02/close").set(H("fin")).send({ acknowledgeWarnings: true })).body.status).toBe("closed");
    expect((await srv().post("/accounting/periods/2025-01/close").set(H("fin")).send({ acknowledgeWarnings: true })).status).toBe(409); // déjà close
    expect((await srv().post("/accounting/periods/2999-01/close").set(H("fin")).send({ acknowledgeWarnings: true })).status).toBe(400); // future
    expect((await srv().post("/accounting/periods/2025-13/close").set(H("fin")).send({})).status).toBe(400);
    const ev = await admin.auditEvent.findFirstOrThrow({ where: { tenantId: T.ac1!, action: "accounting.period_closed", entityId: "2025-01" } });
    expect(JSON.stringify(ev.after)).toMatch(/reconciliation/); // les avertissements accusés sont conservés
  });
  it("période close : refus par l'application ET par la base ; ajustement dans une période ouverte", async () => {
    const r = await entry("fin", "2025-01-25", two("512", "706", "5")); expect(r.status).toBe(409); expect(r.body.error.message).toMatch(/close/);
    await expect(admin.journalEntry.create({ data: { tenantId: T.ac1!, key: `x-${run}`, valueDate: new Date("2025-02-12"), label: "x", sourceType: "manual", sourceId: "x", lines: { create: [{ tenantId: T.ac1!, account: "512", debit: "1" }, { tenantId: T.ac1!, account: "706", credit: "1" }] } } })).rejects.toThrow(/close/);
    expect((await entry("fin", NOW, two("512", "706", "5"), { label: "Ajustement de la période 2025-01" })).status).toBe(201);
    expect((await srv().get("/accounting/periods").set(H("fin"))).body.find((p: { period: string }) => p.period === "2025-01")).toMatchObject({ status: "closed" });
  });
  it("réouverture : administrateur seul, motif, ordre inverse", async () => {
    expect((await srv().post("/accounting/periods/2025-02/reopen").set(H("fin")).send({ reason: "Correction nécessaire" })).status).toBe(403);
    expect((await srv().post("/accounting/periods/2025-01/reopen").set(H("admin")).send({ reason: "Correction nécessaire" })).status).toBe(409); // 2025-02 est close
    expect((await srv().post("/accounting/periods/2025-02/reopen").set(H("admin")).send({ reason: "x" })).status).toBe(400);
    expect((await srv().post("/accounting/periods/2025-02/reopen").set(H("admin")).send({ reason: "Correction nécessaire" })).body.status).toBe("open");
    expect((await srv().post("/accounting/periods/2025-01/reopen").set(H("admin")).send({ reason: "Correction nécessaire" })).body.status).toBe("open");
    expect((await entry("fin", "2025-01-26", two("512", "706", "1"))).status).toBe(201); // à nouveau possible
    expect((await srv().post("/accounting/periods/2025-01/reopen").set(H("admin")).send({ reason: "Déjà ouverte" })).status).toBe(409);
    expect((await admin.auditEvent.count({ where: { tenantId: T.ac1!, action: { in: ["accounting.period_closed", "accounting.period_reopened"] } } }))).toBeGreaterThanOrEqual(4);
  });
});

describe("balance, TVA, tiers, export FEC (société ac3)", () => {
  let fecText = ""; let fecRes: request.Response;
  beforeAll(async () => {
    const i1 = await inv("ac3", "admin3", "2025-03", 2); const i2 = await inv("ac3", "admin3", "2025-04", 1); await inv("ac3", "admin3", "2025-05", 1);
    expect((await srv().post(`/invoices/${i1}/payments`).set(H("admin3")).send({ amount: "1560.00", receivedOn: NOW })).status).toBe(201);
    expect((await srv().post(`/invoices/${i2}/credit`).set(H("admin3")).send({ reason: "Erreur de facturation" })).status).toBe(201);
  });
  it("balance équilibrée aux soldes attendus (calculés à la main)", async () => {
    const b = (await srv().get(`/accounting/balance?from=${MONTH}&to=${MONTH}`).set(H("dir3"))).body;
    const row = (a: string) => b.rows.find((r: { account: string }) => r.account === a);
    expect(row("411")).toMatchObject({ endDebit: "780.00", endCredit: "0.00" });       // 1560 + 780 + 780 − 1560 − 780
    expect(row("706")).toMatchObject({ endCredit: "1950.00" });                          // 1300 + 650 + 650 − 650
    expect(row("44571")).toMatchObject({ endCredit: "390.00" });                         // 260 + 130 + 130 − 130
    expect(row("512")).toMatchObject({ endDebit: "1560.00" });
    expect(b.balanced).toBe(true); expect(b.totals.movementDebit).toBe(b.totals.movementCredit);
    expect((await srv().get("/accounting/balance?from=2026-13&to=2026-14").set(H("dir3"))).status).toBe(400);
  });
  it("TVA collectée issue du journal (avoirs déduits) et comptes tiers rapprochés du compte 411", async () => {
    const v = (await srv().get(`/accounting/vat?from=${MONTH}&to=${MONTH}`).set(H("acc3"))).body;
    expect(v.rows[0]).toEqual({ month: MONTH, baseHt: "1950.00", vatCollected: "390.00" }); expect(v.note).toMatch(/TVA déductible n'est pas gérée/);
    const t = (await srv().get("/accounting/third-parties").set(H("acc3"))).body;
    expect(t.rows).toEqual([{ companyId: expect.any(String), name: "Client ac3", balance: "780.00" }]); expect(t.ledger411).toBe("780.00"); expect(t.match).toBe(true);
  });
  it("FEC : 18 colonnes, journaux, équilibre, libellés, provisoire tant que la période n'est pas close", async () => {
    fecRes = await srv().get(`/accounting/export/fec?from=${MONTH}&to=${MONTH}`).set(H("acc3")); expect(fecRes.status).toBe(200);
    fecText = fecRes.text; const lines = fecText.split("\r\n").filter(l => l.length > 0); const cols = lines[0]!.split("\t");
    expect(cols).toHaveLength(18); expect(cols.slice(0, 5)).toEqual(["JournalCode", "JournalLib", "EcritureNum", "EcritureDate", "CompteNum"]);
    const rows = lines.slice(1).map(l => l.split("\t")); expect(rows.every(r => r.length === 18)).toBe(true); expect(rows).toHaveLength(14); // 5 écritures
    expect(new Set(rows.map(r => r[0]))).toEqual(new Set(["VT", "BQ"])); expect(new Set(rows.map(r => r[2]))).toEqual(new Set(["1", "2", "3", "4", "5"]));
    const num = (s: string) => Number(s.replace(",", ".")); const d = rows.reduce((s, r) => s + num(r[11]!), 0), c = rows.reduce((s, r) => s + num(r[12]!), 0);
    expect(d.toFixed(2)).toBe(c.toFixed(2)); expect(rows.every(r => r[15] === "")).toBe(true); // ValidDate vide : non close
    expect(rows.find(r => r[4] === "411")![5]).toBe("Clients"); expect(fecRes.headers["content-disposition"]).toMatch(/-provisoire\.txt/); expect(fecRes.headers["x-export-provisional"]).toBe("true");
    expect(rows[0]![3]).toBe(NOW.replace(/-/g, ""));
  });
  it("après clôture : export définitif avec date de validation ; exports et accès réservés", async () => {
    expect((await srv().post(`/accounting/periods/${MONTH}/close`).set(H("admin3")).send({ acknowledgeWarnings: true })).status).toBe(201);
    const r = await srv().get(`/accounting/export/fec?from=${MONTH}&to=${MONTH}`).set(H("admin3"));
    expect(r.headers["content-disposition"]).not.toMatch(/provisoire/); expect(r.headers["x-export-provisional"]).toBe("false");
    expect(r.text.split("\r\n").filter(l => l.length > 0).slice(1).every(l => l.split("\t")[15]!.length === 8)).toBe(true);
    const csv = await srv().get(`/accounting/export/balance.csv?from=${MONTH}&to=${MONTH}`).set(H("acc3"));
    expect(csv.text.split("\r\n")[0]).toBe("compte;libelle;mouvement_debit;mouvement_credit;solde_debit;solde_credit"); expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect((await srv().get(`/accounting/export/fec?from=${MONTH}&to=${MONTH}`).set(H("dir3"))).status).toBe(403); // lecture sans export
    expect((await srv().get("/accounting/export/fec?from=abc&to=def").set(H("acc3"))).status).toBe(400);
    expect((await admin.auditEvent.count({ where: { tenantId: T.ac3!, action: "accounting.export_fec" } }))).toBe(2);
    const d = (await srv().get(`/accounting/dossier?period=${MONTH}`).set(H("acc3"))).body;
    expect(d.checks.status).toBe("closed"); expect(d.balance.balanced).toBe(true); expect(d.vat.totals.vatCollected).toBe("390.00"); expect(d.thirdParties.match).toBe(true);
  });
  it("l'expert-comptable n'accède qu'à la comptabilité ; isolation inter-sociétés", async () => {
    for (const p of ["/invoices", "/companies", "/consultants", "/timesheets", "/pilotage/overview"]) expect((await srv().get(p).set(H("acc3"))).status).toBe(403);
    const b2 = (await srv().get(`/accounting/balance?from=${MONTH}&to=${MONTH}`).set(H("admin2"))).body; expect(b2.rows).toEqual([]);
    expect((await srv().get(`/accounting/entries?from=${MONTH}&to=${MONTH}`).set(H("admin2"))).body).toEqual([]);
    expect((await srv().get("/accounting/third-parties").set(H("admin2"))).body.rows).toEqual([]);
    expect((await srv().get(`/accounting/export/fec?from=${MONTH}&to=${MONTH}`).set(H("admin2"))).text.split("\r\n").filter(l => l.length > 0)).toHaveLength(1); // en-tête seul
    expect((await srv().get(`/accounting/periods/${MONTH}/checks`).set(H("admin2"))).body.status).toBe("open"); // pas la clôture d'un autre
  });
});
