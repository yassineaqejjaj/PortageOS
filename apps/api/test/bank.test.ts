import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { INestApplication } from "@nestjs/common";
import { createApp } from "../src/main";
import { hashPassword } from "../src/password";
import { resetLoginThrottle } from "../src/auth.controller";

const admin = new PrismaClient();
let app: INestApplication; const PW = "correct-horse-battery"; const run = Date.now().toString(36) + "b";
let t1: string, t2: string, cons: string, co: string; const tok: Record<string, string> = {};
const srv = () => request(app.getHttpServer()); const H = (k: string) => ({ Authorization: `Bearer ${tok[k]}` });
let month = 1;
async function mk(key: string, tenantId: string, roles: string[]) {
  const u = await admin.user.create({ data: { email: `${key}-${run}@x.test`, passwordHash: await hashPassword(PW) } }); await admin.membership.create({ data: { userId: u.id, tenantId, roles } });
}
async function issued(days: number): Promise<{ id: string; number: string; gross: string }> {
  const m = (await srv().post("/missions").set(H("admin")).send({ consultantId: cons, companyId: co, title: `Mission ${month}`, dailyRate: "650.00", vatRate: "20", startDate: "2026-01-01" })).body.id;
  const period = `2027-${String(month++).padStart(2, "0")}`;
  const ts = await admin.timesheet.create({ data: { tenantId: t1, missionId: m, period, status: "validated" } });
  for (let i = 1; i <= days; i++) await admin.timesheetLine.create({ data: { tenantId: t1, timesheetId: ts.id, date: new Date(`${period}-${String(i).padStart(2, "0")}`), quantity: "1" } });
  const id = (await srv().post("/invoices").set(H("admin")).send({ timesheetId: ts.id })).body.id; await srv().post(`/invoices/${id}/issue`).set(H("admin"));
  const inv = await admin.invoice.findUniqueOrThrow({ where: { id } }); return { id, number: inv.number!, gross: inv.gross.toString() };
}
const csv = (rows: string[]) => ["Date;Libellé;Montant", ...rows].join("\r\n");
const preview = (who: string, c: string) => srv().post("/bank/imports/preview").set(H(who)).send({ csv: c, fileName: "releve.csv" });
const txs = async (who = "fin", status = "unmatched") => (await srv().get(`/bank/transactions?status=${status}`).set(H(who))).body as { id: string; label: string; amount: string; suggestions: { invoiceId: string; confidence: string }[] }[];

beforeAll(async () => {
  t1 = (await admin.tenant.create({ data: { slug: `bk1-${run}`, name: "Banque 1" } })).id; t2 = (await admin.tenant.create({ data: { slug: `bk2-${run}`, name: "Banque 2" } })).id;
  co = (await admin.company.create({ data: { tenantId: t1, name: "Client banque" } })).id; cons = (await admin.consultant.create({ data: { tenantId: t1, firstName: "B", lastName: "K", status: "active" } })).id;
  await mk("admin", t1, ["tenant_admin"]); await mk("fin", t1, ["finance"]); await mk("ops", t1, ["operations"]); await mk("admin2", t2, ["tenant_admin"]);
  app = await createApp(); await app.init();
  for (const k of ["admin", "fin", "ops"]) tok[k] = (await srv().post("/auth/login").send({ email: `${k}-${run}@x.test`, password: PW, tenantSlug: `bk1-${run}` })).body.accessToken;
  tok.admin2 = (await srv().post("/auth/login").send({ email: `admin2-${run}@x.test`, password: PW, tenantSlug: `bk2-${run}` })).body.accessToken;
});
beforeEach(() => resetLoginThrottle());
afterAll(async () => { await app.close(); await admin.$disconnect(); });

describe("rapprochement bancaire", () => {
  it("aperçu sans écriture, rapport d'erreurs, validation unique, doublons jamais réimportés, droits et isolation", async () => {
    const data = csv(["05/03/2027;VIR SEPA CLIENT ABC 111;1 000,00", "06/03/2027;PRLV ASSURANCE;-45,10", "pas-une-date;X;5,00", "07/03/2027;;9,00", "05/03/2027;VIR SEPA CLIENT ABC 111;1 000,00"]);
    expect((await preview("ops", data)).status).toBe(403);
    const pv = await preview("fin", data); expect(pv.status).toBe(201); expect(pv.body).toMatchObject({ rowsTotal: 5, rowsValid: 2, rowsInvalid: 3, credits: 1, debits: 1 });
    expect(pv.body.errors.map((e: { line: number }) => e.line)).toEqual([4, 5, 6]);
    expect(await admin.bankTransaction.count({ where: { tenantId: t1 } })).toBe(0);
    expect((await srv().post(`/bank/imports/${pv.body.id}/commit`).set(H("admin2"))).status).toBe(404);
    expect((await srv().post(`/bank/imports/${pv.body.id}/commit`).set(H("fin"))).body).toMatchObject({ created: 2, skippedDuplicates: 0 });
    expect((await srv().post(`/bank/imports/${pv.body.id}/commit`).set(H("fin"))).status).toBe(409);
    const again = await preview("fin", csv(["05/03/2027;VIR SEPA CLIENT ABC 111;1 000,00"])); expect(again.body).toMatchObject({ rowsValid: 0, rowsInvalid: 1 }); expect(again.body.errors[0].errors[0]).toBe("déjà importé");
    expect((await txs()).map(t => t.amount)).toEqual(["1000"]); expect((await txs("fin", "ignored")).map(t => t.amount)).toEqual(["-45.1"]); // débit : hors rapprochement
    expect((await txs("admin2")).length).toBe(0);
    expect((await preview("fin", "A;B\r\n1;2")).status).toBe(400); expect((await preview("fin", "Date;Libellé;Montant\r\n" + "x".repeat(1_000_001))).status).toBe(400);
    const ab = await preview("fin", csv(["09/03/2027;À abandonner;1,00"])); expect((await srv().post(`/bank/imports/${ab.body.id}/cancel`).set(H("fin"))).body.status).toBe("cancelled"); expect((await srv().post(`/bank/imports/${ab.body.id}/commit`).set(H("fin"))).status).toBe(409);
  });
  it("proposition par référence ou montant, décision humaine, encaissement + écriture, concurrence, surpaiement refusé", async () => {
    const a = await issued(2), b = await issued(1), c = await issued(1); // 1560, 780, 780 (b et c : même solde)
    const pv = await preview("fin", csv([`10/03/2027;VIR ${a.number.toLowerCase()} SOLDE;${a.gross.replace(".", ",")}`, "11/03/2027;VIR DIVERS 780;780,00", `12/03/2027;ACOMPTE ${b.number};300,00`, `13/03/2027;TROP PERCU ${b.number};9 999,00`]));
    await srv().post(`/bank/imports/${pv.body.id}/commit`).set(H("fin"));
    const list = await txs(); const byLabel = (s: string) => list.find(t => t.label.includes(s))!;
    expect(byLabel(a.number.toLowerCase()).suggestions).toMatchObject([{ invoiceId: a.id, confidence: "reference" }]);
    expect(byLabel("DIVERS 780").suggestions).toEqual([]); // b et c ont le même solde : ambigu, jamais deviné
    expect(byLabel("ACOMPTE").suggestions[0]).toMatchObject({ invoiceId: b.id });
    const m = await srv().post(`/bank/transactions/${byLabel(a.number.toLowerCase()).id}/match`).set(H("fin")).send({ invoiceId: a.id }); expect(m.status).toBe(201);
    expect(await admin.invoice.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: "paid" }); expect((await admin.invoice.findUniqueOrThrow({ where: { id: a.id } })).paid.toString()).toBe(a.gross);
    const e = await admin.journalEntry.findFirstOrThrow({ where: { tenantId: t1, key: `payment:${m.body.paymentId}` }, include: { lines: true } }); expect(e.lines.map(l => [l.account, l.debit.toString(), l.credit.toString()]).sort()).toEqual([["411", "0", a.gross], ["512", a.gross, "0"]]);
    expect((await srv().post(`/bank/transactions/${byLabel(a.number.toLowerCase()).id}/match`).set(H("fin")).send({ invoiceId: a.id })).status).toBe(409);
    const acompte = byLabel("ACOMPTE"); expect((await srv().post(`/bank/transactions/${acompte.id}/match`).set(H("fin")).send({ invoiceId: b.id })).status).toBe(201); expect((await admin.invoice.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("partially_paid");
    const trop = byLabel("TROP PERCU"); const over = await srv().post(`/bank/transactions/${trop.id}/match`).set(H("fin")).send({ invoiceId: b.id }); expect(over.status).toBe(400);
    expect((await txs()).some(t => t.id === trop.id)).toBe(true); // refus => le mouvement reste à traiter
    // concurrence : deux rapprochements simultanés du même mouvement => un seul encaissement
    const div = byLabel("DIVERS 780"); const rs = await Promise.all([c.id, c.id].map(i => srv().post(`/bank/transactions/${div.id}/match`).set(H("fin")).send({ invoiceId: i })));
    expect(rs.map(r => r.status).sort()).toEqual([201, 409]); expect(await admin.payment.count({ where: { invoiceId: c.id } })).toBe(1);
    expect((await srv().post(`/bank/transactions/${trop.id}/match`).set(H("ops")).send({ invoiceId: b.id })).status).toBe(403);
    expect((await srv().post(`/bank/transactions/${trop.id}/ignore`).set(H("fin")).send({ reason: "x" })).status).toBe(400);
    expect((await srv().post(`/bank/transactions/${trop.id}/ignore`).set(H("fin")).send({ reason: "Erreur de saisie banque" })).body.status).toBe("ignored");
    expect((await srv().post(`/bank/transactions/${trop.id}/ignore`).set(H("fin")).send({ reason: "Encore une fois" })).status).toBe(409);
    await expect(admin.bankTransaction.update({ where: { id: trop.id }, data: { amount: "1" } })).rejects.toThrow(/figé/);
    expect((await srv().get("/ledger/reconciliation").set(H("fin"))).body.journalBalanced).toBe(true);
    expect(await admin.auditEvent.count({ where: { tenantId: t1, action: "bank.matched" } })).toBe(3);
  });
});
