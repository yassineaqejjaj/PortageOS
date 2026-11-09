import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { INestApplication } from "@nestjs/common";
import { createApp } from "../src/main";
import { hashPassword } from "../src/password";
import { resetLoginThrottle } from "../src/auth.controller";

const admin = new PrismaClient();
let app: INestApplication; const PW = "correct-horse-battery"; const run = Date.now().toString(36) + "i";
let t1: string, t2: string, co: string, cons: string; const tok: Record<string, string> = {}; let month = 1;
const srv = () => request(app.getHttpServer()); const H = (k: string) => ({ Authorization: `Bearer ${tok[k]}` });
async function mk(key: string, tenantId: string, roles: string[]) { const u = await admin.user.create({ data: { email: `${key}-${run}@x.test`, passwordHash: await hashPassword(PW) } }); await admin.membership.create({ data: { userId: u.id, tenantId, roles } }); }
async function draft(days = 2) {
  const m = (await srv().post("/missions").set(H("admin")).send({ consultantId: cons, companyId: co, title: `Mission facturée ${month}`, dailyRate: "650.00", vatRate: "20", startDate: "2026-01-01" })).body.id;
  const period = `2027-${String(month++).padStart(2, "0")}`; const ts = await admin.timesheet.create({ data: { tenantId: t1, missionId: m, period, status: "validated" } });
  for (let i = 1; i <= days; i++) await admin.timesheetLine.create({ data: { tenantId: t1, timesheetId: ts.id, date: new Date(`${period}-${String(i).padStart(2, "0")}`), quantity: "1" } });
  return (await srv().post("/invoices").set(H("admin")).send({ timesheetId: ts.id })).body.id as string;
}
/** Texte d'un PDF pdfkit non compressé : chaînes hexadécimales des opérateurs Tj/TJ décodées (WinAnsi ≈ latin1). */
const pdfText = (b: Buffer) => [...Buffer.from(b).toString("latin1").matchAll(/<([0-9a-f]{2,})>/gi)].map(m => Buffer.from(m[1]!, "hex").toString("latin1")).join("");
const line = (id: string, b: object, who = "admin") => srv().post(`/invoices/${id}/lines`).set(H(who)).send({ description: "Frais de déplacement refacturés", quantity: "1", unit: "forfait", unitPrice: "100.00", vatRate: "10", ...b });

beforeAll(async () => {
  t1 = (await admin.tenant.create({ data: { slug: `iv1-${run}`, name: "Facturation 1" } })).id; t2 = (await admin.tenant.create({ data: { slug: `iv2-${run}`, name: "Facturation 2" } })).id;
  co = (await admin.company.create({ data: { tenantId: t1, name: "Client facturé", siren: "732829320", paymentTermsDays: 30 } })).id; cons = (await admin.consultant.create({ data: { tenantId: t1, firstName: "I", lastName: "V", status: "active" } })).id;
  await mk("admin", t1, ["tenant_admin"]); await mk("fin", t1, ["finance"]); await mk("ops", t1, ["operations"]); await mk("admin2", t2, ["tenant_admin"]);
  app = await createApp(); await app.init();
  for (const k of ["admin", "fin", "ops"]) tok[k] = (await srv().post("/auth/login").send({ email: `${k}-${run}@x.test`, password: PW, tenantSlug: `iv1-${run}` })).body.accessToken;
  tok.admin2 = (await srv().post("/auth/login").send({ email: `admin2-${run}@x.test`, password: PW, tenantSlug: `iv2-${run}` })).body.accessToken;
});
beforeEach(() => resetLoginThrottle());
afterAll(async () => { delete process.env.PDF_UNCOMPRESSED; await app.close(); await admin.$disconnect(); });

describe("factures multi-lignes et multi-taux", () => {
  it("TVA par ligne, totaux = somme des lignes, ligne d'activité protégée, brouillon seulement, écriture comptable sur les totaux", async () => {
    const id = await draft(2); // 2 j × 650 = 1300 HT, TVA 20 % = 260
    let inv = (await srv().get(`/invoices/${id}`).set(H("fin"))).body; expect(inv.lines).toHaveLength(1); expect(inv.lines[0]).toMatchObject({ kind: "activity", position: 1, net: "1300", vatRate: "20" });
    expect((await line(id, {}, "ops")).status).toBe(403);
    for (const bad of [{ quantity: "0" }, { quantity: "abc" }, { unitPrice: "-5" }, { vatRate: "101" }, { description: "x" }]) expect((await line(id, bad)).status).toBe(400);
    const a = await line(id, {}); expect(a.status).toBe(201); expect(a.body).toMatchObject({ position: 2, net: "100", vat: "10", gross: "110" }); // TVA 10 % saisie, jamais imposée
    const b = await line(id, { description: "Prestation exonérée", unitPrice: "50.55", quantity: "3", vatRate: "0" }); expect(b.body).toMatchObject({ net: "151.65", vat: "0" });
    inv = (await srv().get(`/invoices/${id}`).set(H("fin"))).body; expect(inv).toMatchObject({ net: "1551.65", vat: "270", gross: "1821.65" });
    expect((await srv().delete(`/invoices/${id}/lines/${inv.lines[0].id}`).set(H("admin"))).status).toBe(400); // activité
    expect((await srv().delete(`/invoices/${id}/lines/${b.body.id}`).set(H("admin"))).status).toBe(200);
    expect((await srv().get(`/invoices/${id}`).set(H("fin"))).body).toMatchObject({ net: "1400", vat: "270", gross: "1670" });
    expect((await line(id, {}, "admin2")).status).toBe(404);
    expect((await srv().post(`/invoices/${id}/issue`).set(H("fin"))).status).toBe(201);
    const e = await admin.journalEntry.findFirstOrThrow({ where: { tenantId: t1, key: `invoice.issue:${id}` }, include: { lines: true } });
    expect(e.lines.map(l => [l.account, l.debit.toString(), l.credit.toString()]).sort()).toEqual([["411", "1670", "0"], ["44571", "0", "270"], ["706", "0", "1400"]]);
    expect((await line(id, {})).status).toBe(400); // émise : lignes figées
    const first = await admin.invoiceLine.findFirstOrThrow({ where: { invoiceId: id } });
    await expect(admin.invoiceLine.update({ where: { id: first.id }, data: { unitPrice: "1" } })).rejects.toThrow(/figées/);
    await expect(admin.invoiceLine.delete({ where: { id: first.id } })).rejects.toThrow(/figées/);
    expect((await srv().get("/ledger/reconciliation").set(H("fin"))).body.journalBalanced).toBe(true);
  });
});

describe("identité du vendeur et PDF", () => {
  it("profil : administrateur seul, validation, complétude ; PDF : brouillon filigrané, mentions manquantes signalées, jamais présenté comme facture électronique", async () => {
    process.env.PDF_UNCOMPRESSED = "1";
    const id = await draft(1); await line(id, {});
    const none = await srv().get(`/invoices/${id}/pdf`).set(H("fin")); expect(none.status).toBe(200); expect(none.headers["content-type"]).toBe("application/pdf"); expect(none.headers["content-disposition"]).toMatch(/attachment/);
    const text = pdfText(none.body);
    expect(Buffer.from(none.body).subarray(0, 5).toString()).toBe("%PDF-"); expect(text).toContain("BROUILLON"); expect(text).toMatch(/Mentions du vendeur incompl/); expect(text).toMatch(/plateforme de facturation/);
    expect((await srv().put("/tenant/profile").set(H("fin")).send({ legalName: "Portage SAS" })).status).toBe(403);
    for (const bad of [{ legalName: "P" }, { legalName: "Portage SAS", siren: "123" }, { legalName: "Portage SAS", postalCode: "7500" }, { legalName: "Portage SAS", iban: "fr76 3000" }]) expect((await srv().put("/tenant/profile").set(H("admin")).send(bad)).status).toBe(400);
    expect((await srv().put("/tenant/profile").set(H("admin")).send({ legalName: "Portage SAS" })).body.complete).toBe(false);
    const ok = await srv().put("/tenant/profile").set(H("admin")).send({ legalName: "Société de Portage Test SAS", siren: "552100554", vatNumber: "FR12552100554", address: "1 rue de la Paix", postalCode: "75002", city: "Paris", iban: "FR7630006000011234567890189" }); expect(ok.body.complete).toBe(true);
    expect((await srv().get("/tenant/profile").set(H("ops"))).body.profile.siren).toBe("552100554"); expect((await srv().get("/tenant/profile").set(H("admin2"))).body.profile).toBeNull();
    await srv().post(`/invoices/${id}/issue`).set(H("fin"));
    const num = (await admin.invoice.findUniqueOrThrow({ where: { id } })).number!;
    const full = pdfText((await srv().get(`/invoices/${id}/pdf`).set(H("fin"))).body);
    expect(full).not.toContain("BROUILLON"); expect(full).not.toMatch(/Mentions du vendeur incompl/); expect(full).toContain(num); expect(full).toContain("552100554"); expect(full).toContain("FR7630006000011234567890189");
    expect(full).toMatch(/plateforme de facturation/); // l'avertissement demeure : e-facturation non connectée
    expect((await srv().get(`/invoices/${id}/pdf`).set(H("ops"))).status).toBe(200); expect((await srv().get(`/invoices/${id}/pdf`).set(H("admin2"))).status).toBe(404);
    expect(await admin.auditEvent.count({ where: { tenantId: t1, action: "invoice.pdf_downloaded" } })).toBeGreaterThanOrEqual(3);
  });
});
