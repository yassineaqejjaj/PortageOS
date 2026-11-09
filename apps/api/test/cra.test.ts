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
const run = Date.now().toString(36) + "u";
let t1: string, t2: string, consId: string, coA: string, coB: string, mDay: string, mHour: string, mForfait: string, mHourB: string;
const tok: Record<string, string> = {};
const S = (n: string) => `${n}-${run}`;
const srv = () => request(app.getHttpServer());
const H = (k: string) => ({ Authorization: `Bearer ${tok[k]}` });

async function mk(key: string, tenantId: string, roles: string[], extra: { consultantId?: string; companyId?: string } = {}) {
  const u = await admin.user.create({ data: { email: `${key.toLowerCase()}-${run}@x.test`, passwordHash: await hashPassword(PW) } });
  await admin.membership.create({ data: { userId: u.id, tenantId, roles, ...extra } });
}
async function login(key: string, slug: string) { tok[key] = (await srv().post("/auth/login").send({ email: `${key.toLowerCase()}-${run}@x.test`, password: PW, tenantSlug: slug })).body.accessToken; }
const put = (missionId: string, period: string, lines: { date: string; quantity: string }[], who = "cons") => srv().put(`/me/timesheets/missions/${missionId}/${period}`).set(H(who)).send({ lines });
const csv = (missionId: string, period: string, text: string, who = "cons") => srv().put(`/me/timesheets/missions/${missionId}/${period}/import`).set(H(who)).send({ csv: text });

beforeAll(async () => {
  t1 = (await admin.tenant.create({ data: { slug: S("u1"), name: "CRA 1" } })).id;
  t2 = (await admin.tenant.create({ data: { slug: S("u2"), name: "CRA 2" } })).id;
  consId = (await admin.consultant.create({ data: { tenantId: t1, firstName: "Cons", lastName: "Unités", status: "active" } })).id;
  coA = (await admin.company.create({ data: { tenantId: t1, name: "Client A" } })).id;
  coB = (await admin.company.create({ data: { tenantId: t1, name: "Client B" } })).id;
  const base = { tenantId: t1, consultantId: consId, vatRate: "20", startDate: new Date("2031-01-01") };
  mDay = (await admin.mission.create({ data: { ...base, companyId: coA, title: "Jours", dailyRate: "500" } })).id;
  mHour = (await admin.mission.create({ data: { ...base, companyId: coA, title: "Heures", dailyRate: "60", timeUnit: "hour" } })).id;
  mForfait = (await admin.mission.create({ data: { ...base, companyId: coA, title: "Forfait", dailyRate: "600", timeUnit: "forfait_jours", annualDaysCap: 3 } })).id;
  mHourB = (await admin.mission.create({ data: { ...base, companyId: coB, title: "Forfait B", dailyRate: "700", timeUnit: "forfait_jours", annualDaysCap: 5 } })).id;
  await mk("admin", t1, ["tenant_admin"]); await mk("ops", t1, ["operations"]); await mk("fin", t1, ["finance"]);
  await mk("cons", t1, ["consultant"], { consultantId: consId }); await mk("clientA", t1, ["client_user"], { companyId: coA }); await mk("clientB", t1, ["client_user"], { companyId: coB });
  await mk("admin2", t2, ["tenant_admin"]);
  app = await createApp(); await app.init();
  for (const k of ["admin", "ops", "fin", "cons", "clientA", "clientB"]) await login(k, S("u1"));
  await login("admin2", S("u2"));
});
beforeEach(() => resetLoginThrottle());
afterAll(async () => { await app.close(); await admin.$disconnect(); });

describe("unités de saisie", () => {
  it("jours : 0,5 ou 1 seulement ; heures : pas de 0,25, 24 h au plus", async () => {
    expect((await put(mDay, "2031-03", [{ date: "2031-03-03", quantity: "7.5" }])).status).toBe(400);
    expect((await put(mDay, "2031-03", [{ date: "2031-03-03", quantity: "0.5" }])).status).toBe(200);
    for (const bad of ["0.1", "25", "0", "-1", "abc", "7.3"]) expect((await put(mHour, "2031-03", [{ date: "2031-03-03", quantity: bad }])).status, bad).toBe(400);
    const ok = await put(mHour, "2031-03", [{ date: "2031-03-03", quantity: "7.5" }, { date: "2031-03-04", quantity: "8.25" }]);
    expect(ok.status).toBe(200); expect(ok.body.unit).toBe("hour"); expect(ok.body.totalDays).toBe("15.75");
  });
  it("un CRA en heures se facture en heures au tarif horaire; le total reste la somme des lignes", async () => {
    const ts = (await put(mHour, "2031-03", [{ date: "2031-03-03", quantity: "7.5" }, { date: "2031-03-04", quantity: "8.25" }])).body.id;
    expect((await srv().post(`/me/timesheets/${ts}/transition`).set(H("cons")).send({ event: "submit" })).body.status).toBe("submitted");
    expect((await srv().post(`/client/timesheets/${ts}/transition`).set(H("clientA")).send({ event: "approve" })).body.status).toBe("client_approved");
    expect((await srv().post(`/timesheets/${ts}/transition`).set(H("ops")).send({ event: "validate" })).body.status).toBe("validated");
    const inv = await srv().post("/invoices").set(H("fin")).send({ timesheetId: ts });
    expect(inv.status).toBe(201);
    const d = (await srv().get(`/invoices/${inv.body.id}`).set(H("fin"))).body;
    expect(d.lines[0].unit).toBe("heure"); expect(d.lines[0].quantity).toBe("15.75"); expect(d.net).toBe("945"); // 15,75 h × 60 €
  });
  it("le DB refuse une quantité hors pas de 0,25 même hors API", async () => {
    await expect(admin.$executeRawUnsafe(`INSERT INTO "TimesheetLine" (id,"tenantId","timesheetId",date,quantity) SELECT gen_random_uuid()::text,"tenantId",id,'2031-03-20',7.3 FROM "Timesheet" LIMIT 1`)).rejects.toThrow();
  });
  it("mission : l'unité et le plafond sont validés; pas d'accord-cadre sur une mission horaire", async () => {
    const body = { consultantId: consId, companyId: coA, title: "M", dailyRate: "50", vatRate: "20", startDate: "2031-05-01" };
    expect((await srv().post("/missions").set(H("ops")).send({ ...body, timeUnit: "hour" })).body.timeUnit).toBe("hour");
    expect((await srv().post("/missions").set(H("ops")).send({ ...body, timeUnit: "minute" })).status).toBe(400);
    expect((await srv().post("/missions").set(H("ops")).send({ ...body, timeUnit: "day", annualDaysCap: 200 })).status).toBe(400);
    expect((await srv().post("/missions").set(H("ops")).send({ ...body, timeUnit: "forfait_jours", annualDaysCap: 0 })).status).toBe(400);
    expect((await srv().post("/missions").set(H("ops")).send({ ...body, timeUnit: "forfait_jours", annualDaysCap: 218 })).body.annualDaysCap).toBe(218);
    await admin.mission.updateMany({ where: { tenantId: t1, startDate: new Date("2031-05-01") }, data: { status: "ended" } }); // n'entrent pas dans les relances
  });
});

describe("forfait jours", () => {
  it("compte les jours de l'année (hors brouillon), alerte au-delà du plafond saisi, sans bloquer; invisible du client", async () => {
    const lines = ["2031-04-01", "2031-04-02", "2031-04-03", "2031-04-04"].map(date => ({ date, quantity: "1" }));
    const ts = (await put(mForfait, "2031-04", lines)).body;
    expect(ts.forfait.days).toBe("0"); expect(ts.forfait.cap).toBe(3); expect(ts.forfait.overCap).toBe(false); // brouillon : pas compté
    await srv().post(`/me/timesheets/${ts.id}/transition`).set(H("cons")).send({ event: "submit" });
    const after = (await srv().get("/me/timesheets?period=2031-04").set(H("cons"))).body.find((t: { id: string }) => t.id === ts.id);
    expect(after.forfait.days).toBe("4"); expect(after.forfait.overCap).toBe(true); expect(after.forfait.capNote).toMatch(/non vérifié/);
    const client = (await srv().get("/client/timesheets").set(H("clientA"))).body.find((t: { id: string }) => t.id === ts.id);
    expect(client).toBeTruthy(); expect(client.forfait).toBeNull(); // le client ne voit pas le décompte annuel du consultant
  });
});

describe("import / export CSV", () => {
  it("import tout ou rien avec erreurs ligne par ligne", async () => {
    const bad = await csv(mDay, "2031-06", "date;quantite\n2031-06-02;1\n2031-07-01;1\n2031-06-03;3\n2031-06-02;0,5");
    expect(bad.status).toBe(400); expect(bad.body.error.details.length).toBe(3);
    expect((await srv().get("/me/timesheets?period=2031-06").set(H("cons"))).body.length).toBe(0); // rien d'enregistré
    const ok = await csv(mDay, "2031-06", "date;quantite\n2031-06-02;1\n2031-06-03;0,5");
    expect(ok.status).toBe(200); expect(ok.body.totalDays).toBe("1.5");
    const h = await csv(mHour, "2031-06", "2031-06-02,7.5\n2031-06-03,4");
    expect(h.status).toBe(200); expect(h.body.totalDays).toBe("11.5");
  });
  it("import refusé sur une mission d'un autre consultant, sur un CRA soumis, ou vide", async () => {
    expect((await csv("00000000-0000-4000-8000-000000000000", "2031-06", "2031-06-02;1")).status).toBe(404);
    expect((await csv(mDay, "2031-06", "")).status).toBe(400);
    const ts = (await srv().get("/me/timesheets?period=2031-06").set(H("cons"))).body.find((t: { missionId: string }) => t.missionId === mDay);
    await srv().post(`/me/timesheets/${ts.id}/transition`).set(H("cons")).send({ event: "submit" });
    expect((await csv(mDay, "2031-06", "2031-06-10;1")).status).toBe(400);
  });
  it("export CSV interne : droits, tenant, formules neutralisées, audit", async () => {
    await admin.mission.update({ where: { id: mDay }, data: { title: "=HYPERLINK(\"x\")" } });
    const r = await srv().get("/timesheets/export.csv?period=2031-06").set(H("ops"));
    expect(r.status).toBe(200); expect(r.headers["content-type"]).toMatch(/text\/csv/);
    expect(r.text.split("\r\n")[0]).toBe("periode;consultant;client;mission;unite;total;statut;jours_saisis");
    expect(r.text).toContain("'=HYPERLINK"); expect(r.text).not.toMatch(/;=HYPERLINK/);
    expect(r.text).not.toMatch(/500|dailyRate|tarif/i);
    expect((await srv().get("/timesheets/export.csv").set(H("cons"))).status).toBe(403);
    expect((await srv().get("/timesheets/export.csv").set(H("clientA"))).status).toBe(403);
    expect((await srv().get("/timesheets/export.csv?period=2031-13").set(H("ops"))).status).toBe(400);
    expect((await srv().get("/timesheets/export.csv?period=2031-06").set(H("admin2"))).text).not.toContain("Unités");
    expect(await admin.auditEvent.count({ where: { tenantId: t1, action: "timesheet.csv_exported" } })).toBeGreaterThan(0);
  });
});

describe("relances", () => {
  it("relance les CRA absents ou en brouillon, une fois par jour, pas de doublon; droits", async () => {
    const period = "2031-09";
    expect((await srv().post("/timesheets/reminders").set(H("cons")).send({ period })).status).toBe(403);
    expect((await srv().post("/timesheets/reminders").set(H("ops")).send({ period: "2031-9" })).status).toBe(400);
    const a = await srv().post("/timesheets/reminders").set(H("ops")).send({ period });
    expect(a.status).toBe(201); expect(a.body.concerned).toBe(4); expect(a.body.sent).toBe(4);
    const nb = (await srv().get("/notifications").set(H("cons"))).body;
    const n1: { type: string }[] = Array.isArray(nb) ? nb : nb.items;
    expect(n1.filter((n: { type: string }) => n.type === "timesheet.reminder").length).toBe(4);
    const b = await srv().post("/timesheets/reminders").set(H("ops")).send({ period });
    expect(b.body.sent).toBe(0); expect(b.body.alreadyRemindedToday).toBe(4);
    expect(b.body.channel).toMatch(/e-mail non utilisé/);
  });
  it("un CRA déjà soumis n'est pas relancé", async () => {
    const period = "2031-10";
    const ts = (await put(mDay, period, [{ date: "2031-10-01", quantity: "1" }])).body.id;
    await srv().post(`/me/timesheets/${ts}/transition`).set(H("cons")).send({ event: "submit" });
    expect((await srv().post("/timesheets/reminders").set(H("ops")).send({ period })).body.concerned).toBe(3);
  });
});
