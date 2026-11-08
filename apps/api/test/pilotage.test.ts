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
const run = Date.now().toString(36) + "p";
let t1: string, t2: string;
const tok: Record<string, string> = {};
const S = (n: string) => `${n}-${run}`;
const srv = () => request(app.getHttpServer());
const H = (k: string) => ({ Authorization: `Bearer ${tok[k]}` });
const Q = "from=2026-01&to=2026-02&asOf=2026-03-01";

async function mk(key: string, tenantId: string, roles: string[]) {
  const u = await admin.user.create({ data: { email: `${key.toLowerCase()}-${run}@x.test`, passwordHash: await hashPassword(PW) } });
  await admin.membership.create({ data: { userId: u.id, tenantId, roles } });
}
async function login(key: string, slug: string) { tok[key] = (await srv().post("/auth/login").send({ email: `${key.toLowerCase()}-${run}@x.test`, password: PW, tenantSlug: slug })).body.accessToken; }

/** Jeu de données dont tous les résultats attendus ont été calculés à la main (voir commentaires). */
async function seed1() {
  const co = (await admin.company.create({ data: { tenantId: t1, name: "Client P" } })).id;
  const A = (await admin.consultant.create({ data: { tenantId: t1, firstName: "Alice", lastName: "A", status: "active", createdAt: new Date("2026-01-05") } })).id;
  const B = (await admin.consultant.create({ data: { tenantId: t1, firstName: "Bruno", lastName: "B", status: "active", createdAt: new Date("2026-02-05") } })).id;
  await admin.consultant.create({ data: { tenantId: t1, firstName: "Chloé", lastName: "C", status: "onboarding", createdAt: new Date("2026-02-20") } });
  const mA = (await admin.mission.create({ data: { tenantId: t1, consultantId: A, companyId: co, title: "mA", dailyRate: "650.00", vatRate: "20", startDate: new Date("2026-01-01") } })).id;
  const mB = (await admin.mission.create({ data: { tenantId: t1, consultantId: B, companyId: co, title: "mB", dailyRate: "500.00", vatRate: "20", startDate: new Date("2026-01-01") } })).id;
  await admin.ruleParameter.create({ data: { tenantId: t1, key: "management_fee_rate_percent", value: "10", unit: "%", validFrom: new Date("2026-01-01"), source: "Source de test automatisé", status: "approved", createdBy: "u1", approvedBy: "u2", approvedAt: new Date() } });
  let n = 0;
  const inv = async (mission: string, issue: string, net: string, vat: string, status: string, paid = "0") => {
    const ts = await admin.timesheet.create({ data: { tenantId: t1, missionId: mission, period: `20${40 + n}-01`, status: "invoiced" } }); n++;
    return admin.invoice.create({ data: { tenantId: t1, companyId: co, missionId: mission, timesheetId: ts.id, status, issueDate: new Date(issue), days: "1", unitPrice: net, vatRate: "20", net, vat, gross: String(Number(net) + Number(vat)), paid } });
  };
  const I1 = await inv(mA, "2026-01-15", "1000", "200", "paid", "1200");         // payée
  const I2 = await inv(mA, "2026-02-10", "2000", "400", "partially_paid", "600"); // 1800 restant
  await inv(mB, "2026-02-20", "500", "100", "issued");                            // 600 restant
  await inv(mA, "2026-02-05", "999", "0", "cancelled");                           // exclue
  await inv(mA, "2026-01-20", "800", "160", "credited");                          // exclue
  await admin.payment.create({ data: { tenantId: t1, invoiceId: I1.id, amount: "1200", receivedOn: new Date("2026-02-10") } });
  await admin.payment.create({ data: { tenantId: t1, invoiceId: I2.id, amount: "600", receivedOn: new Date("2026-02-20") } });
  const mkTs = async (mission: string, period: string, status: string, lines: number) => { const t = await admin.timesheet.create({ data: { tenantId: t1, missionId: mission, period, status } }); for (let i = 1; i <= lines; i++) await admin.timesheetLine.create({ data: { tenantId: t1, timesheetId: t.id, date: new Date(`${period}-0${i}`), quantity: "1" } }); return t.id; };
  await mkTs(mA, "2026-03", "validated", 3);        // à facturer : 3 × 650 = 1950
  await mkTs(mA, "2026-04", "submitted", 2);        // en cours : 1300
  await mkTs(mB, "2026-04", "client_approved", 1);  // en cours : 500
  for (const [stage, c] of [["converted", 2], ["lost", 1], ["new", 1]] as const) for (let i = 0; i < c; i++) await admin.prospect.create({ data: { tenantId: t1, kind: "company", name: `P-${stage}-${i}`, stage, createdAt: new Date("2026-01-10") } });
  await admin.expenseClaim.create({ data: { tenantId: t1, consultantId: A, ownerUserId: "u", title: "frais", status: "submitted", total: "10" } });
  await admin.leaveRequest.create({ data: { tenantId: t1, consultantId: A, ownerUserId: "u", type: "other", startDate: new Date("2031-01-06"), endDate: new Date("2031-01-06"), days: "1", status: "submitted" } });
  const e1 = crypto.randomUUID(), e2 = crypto.randomUUID();
  for (const [id, action, at] of [[e1, "timesheet.submit", "2026-02-01T10:00:00Z"], [e1, "timesheet.approve", "2026-02-04T10:00:00Z"], [e2, "timesheet.submit", "2026-02-02T10:00:00Z"], [e2, "timesheet.approve", "2026-02-04T10:00:00Z"]] as const)
    await admin.auditEvent.create({ data: { tenantId: t1, action, entity: "Timesheet", entityId: id, at: new Date(at) } });
  return { A, B };
}

beforeAll(async () => {
  t1 = (await admin.tenant.create({ data: { slug: S("p1"), name: "Pilotage 1" } })).id;
  t2 = (await admin.tenant.create({ data: { slug: S("p2"), name: "Pilotage 2" } })).id;
  await seed1();
  // tenant 2 : un encaissement SANS paramètre de frais de gestion
  const co2 = (await admin.company.create({ data: { tenantId: t2, name: "C2" } })).id;
  const c2 = (await admin.consultant.create({ data: { tenantId: t2, firstName: "D", lastName: "D", status: "active" } })).id;
  const m2 = (await admin.mission.create({ data: { tenantId: t2, consultantId: c2, companyId: co2, title: "m2", dailyRate: "100", vatRate: "20", startDate: new Date("2026-01-01") } })).id;
  const ts2 = await admin.timesheet.create({ data: { tenantId: t2, missionId: m2, period: "2040-01", status: "invoiced" } });
  const i2 = await admin.invoice.create({ data: { tenantId: t2, companyId: co2, missionId: m2, timesheetId: ts2.id, status: "paid", issueDate: new Date("2026-01-15"), days: "1", unitPrice: "100", vatRate: "20", net: "100", vat: "20", gross: "120", paid: "120" } });
  await admin.payment.create({ data: { tenantId: t2, invoiceId: i2.id, amount: "120", receivedOn: new Date("2026-01-20") } });
  await mk("admin", t1, ["tenant_admin"]); await mk("dir", t1, ["direction"]); await mk("fin", t1, ["finance"]); await mk("ops", t1, ["operations"]); await mk("cons", t1, ["consultant"]); await mk("client", t1, ["client_user"]); await mk("admin2", t2, ["tenant_admin"]);
  app = await createApp(); await app.init();
  for (const k of ["admin", "dir", "fin", "ops", "cons", "client"]) await login(k, S("p1"));
  await login("admin2", S("p2"));
});
beforeEach(() => resetLoginThrottle());
afterAll(async () => { await app.close(); await admin.$disconnect(); });

describe("pilotage : chiffres vérifiés à la main", () => {
  let o: any;
  beforeAll(async () => { o = (await srv().get(`/pilotage/overview?${Q}`).set(H("dir"))).body; });
  it("facturation, encaissements et frais de gestion par mois (annulée et avoirée exclues)", () => {
    expect(o.period).toMatchObject({ from: "2026-01", to: "2026-02", days: 59, asOf: "2026-03-01" });
    expect(o.series).toEqual([
      { month: "2026-01", invoicedNet: "1000.00", invoicedGross: "1200.00", collectedNet: "0.00", managementFee: "0.00" },
      { month: "2026-02", invoicedNet: "2500.00", invoicedGross: "3000.00", collectedNet: "1500.00", managementFee: "150.00" }, // 1200×1000/1200 + 600×2000/2400 = 1000 + 500 ; 10 %
    ]);
    expect(o.totals).toEqual({ invoicedNet: "3500.00", invoicedGross: "4200.00", collectedNet: "1500.00", managementFee: "150.00" });
    expect(o.feeStatus).toBe("computed");
  });
  it("créances ouvertes, ancienneté depuis l'émission et DSO", () => {
    expect(o.receivables.outstanding).toBe("2400.00"); // (2400−600) + 600
    expect(o.receivables.aging).toEqual([{ bucket: "0-30", amount: "2400.00" }, { bucket: "31-60", amount: "0.00" }, { bucket: "61-90", amount: "0.00" }, { bucket: "91+", amount: "0.00" }]);
    expect(o.receivables.dso).toBe("33.7"); // 2400 / 4200 × 59
  });
  it("à une date de référence plus tardive, les créances vieillissent", async () => {
    const late = (await srv().get("/pilotage/overview?from=2026-01&to=2026-02&asOf=2026-05-20").set(H("fin"))).body.receivables.aging;
    expect(late).toEqual([{ bucket: "0-30", amount: "0.00" }, { bucket: "31-60", amount: "0.00" }, { bucket: "61-90", amount: "600.00" }, { bucket: "91+", amount: "1800.00" }]); // I3 : 89 j ; I2 : 99 j
  });
  it("portefeuille, pipeline, opérations, à facturer", () => {
    expect(o.portfolio).toEqual({ activeConsultants: 2, onboardingConsultants: 1, activeMissions: 2 });
    expect(o.pipeline).toMatchObject({ created: 4, conversionRatePercent: "50.0" }); expect(o.pipeline.stages.converted).toBe(2);
    expect(o.operations).toMatchObject({ timesheets: { submitted: 1, clientApproved: 1, clientRejected: 0, validatedNotInvoiced: 1 }, pendingExpenses: 1, pendingLeaves: 1, avgClientApprovalDelayDays: "2.5" });
    expect(o.backlog).toMatchObject({ toInvoiceNet: "1950.00", inProgressNet: "1800.00" });
  });
  it("cohortes et classement des consultants", () => {
    expect(o.cohorts).toEqual([{ cohort: "2026-01", size: 1, billedByOffset: [1, 1, 0, 0, 0, 0, 0] }, { cohort: "2026-02", size: 2, billedByOffset: [1, 0, 0, 0, 0, 0, 0] }]);
    expect(o.topConsultants.map((t: { name: string; invoicedNet: string }) => [t.name, t.invoicedNet])).toEqual([["Alice A", "3000.00"], ["Bruno B", "500.00"]]);
  });
  it("chaque indicateur est défini et sourcé; les indicateurs non applicables sont déclarés", () => {
    for (const k of ["invoicedNet", "collectedNet", "managementFee", "outstanding", "aging", "dso", "conversion", "clientApprovalDelay", "backlog", "cohorts"]) expect(o.definitions[k]).toMatch(/\S+( \S+){5,}/);
    expect(o.notApplicable.join(" ")).toMatch(/MRR SaaS/);
    expect(o.backlog.note).toMatch(/pas une prévision/);
  });
});

describe("pilotage : droits, validation, isolation, export", () => {
  it("droits : direction, finance, admin ; refus pour opérations, consultant, client", async () => {
    for (const k of ["dir", "fin", "admin"]) expect((await srv().get(`/pilotage/overview?${Q}`).set(H(k))).status).toBe(200);
    for (const k of ["ops", "cons", "client"]) { expect((await srv().get(`/pilotage/overview?${Q}`).set(H(k))).status).toBe(403); expect((await srv().get(`/pilotage/export.csv?${Q}`).set(H(k))).status).toBe(403); }
    expect((await srv().get(`/pilotage/overview?${Q}`)).status).toBe(401);
  });
  it("validation de la période", async () => {
    for (const q of ["from=2026-03&to=2026-01", "from=2026-13&to=2026-14", "from=2020-01&to=2026-12", "from=abc&to=2026-01", "from=2026-01&to=2026-02&asOf=hier"]) expect((await srv().get(`/pilotage/overview?${q}`).set(H("dir"))).status).toBe(400);
    expect((await srv().get("/pilotage/overview").set(H("dir"))).status).toBe(200); // période par défaut
  });
  it("isolation : un autre tenant ne voit rien des données; paramètre de frais manquant = frais non calculés", async () => {
    const t = (await srv().get(`/pilotage/overview?${Q}`).set(H("admin2"))).body;
    expect(t.totals.invoicedNet).toBe("100.00"); expect(t.portfolio.activeConsultants).toBe(1); expect(t.pipeline.created).toBe(0); expect(t.backlog.toInvoiceNet).toBe("0.00"); expect(t.cohorts).toHaveLength(1);
    expect(t.feeStatus).toBe("parameter_missing"); expect(t.totals.managementFee).toBeNull(); expect(t.series[0].managementFee).toBeNull();
    expect(t.totals.collectedNet).toBe("100.00");
  });
  it("export CSV : en-têtes, lignes exactes, audité", async () => {
    const r = await srv().get(`/pilotage/export.csv?${Q}`).set(H("fin"));
    expect(r.status).toBe(200); expect(r.headers["content-type"]).toMatch(/text\/csv/); expect(r.headers["content-disposition"]).toMatch(/pilotage-2026-01-2026-02\.csv/);
    expect(r.text).toBe("mois;ca_ht_eur;ca_ttc_eur;encaisse_ht_eur;frais_gestion_eur\r\n2026-01;1000.00;1200.00;0.00;0.00\r\n2026-02;2500.00;3000.00;1500.00;150.00\r\n");
    expect((await admin.auditEvent.count({ where: { tenantId: t1, action: "pilotage.export" } }))).toBeGreaterThan(0);
  });
});
