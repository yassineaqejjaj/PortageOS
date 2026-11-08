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
const run = Date.now().toString(36) + "s";
let t1: string, t2: string, consId: string, missionId: string;
const tok: Record<string, string> = {}; const uid: Record<string, string> = {};
const S = (n: string) => `${n}-${run}`;
const srv = () => request(app.getHttpServer());
const H = (k: string) => ({ Authorization: `Bearer ${tok[k]}` });

async function mk(key: string, tenantId: string, roles: string[], extra: { companyId?: string; consultantId?: string } = {}) {
  const u = await admin.user.create({ data: { email: `${key.toLowerCase()}-${run}@x.test`, passwordHash: await hashPassword(PW) } });
  uid[key] = u.id; await admin.membership.create({ data: { userId: u.id, tenantId, roles, ...extra } });
}
async function login(key: string, slug: string) { tok[key] = (await srv().post("/auth/login").send({ email: `${key.toLowerCase()}-${run}@x.test`, password: PW, tenantSlug: slug })).body.accessToken; }
const notifs = async (k: string, unread = false) => (await srv().get(`/notifications${unread ? "?unread=1" : ""}`).set(H(k))).body as { id: string; type: string; title: string; body: string | null; link: string; readAt: string | null }[];
const days = (period: string, n: number) => Array.from({ length: n }, (_, i) => ({ date: `${period}-${String(i + 1).padStart(2, "0")}`, quantity: "1" }));
async function submitCra(period: string) {
  const id = (await srv().put(`/me/timesheets/missions/${missionId}/${period}`).set(H("cons")).send({ lines: days(period, 2) })).body.id;
  await srv().post(`/me/timesheets/${id}/transition`).set(H("cons")).send({ event: "submit" });
  return id as string;
}

beforeAll(async () => {
  t1 = (await admin.tenant.create({ data: { slug: S("s1"), name: "Support 1" } })).id;
  t2 = (await admin.tenant.create({ data: { slug: S("s2"), name: "Support 2" } })).id;
  const coA = (await admin.company.create({ data: { tenantId: t1, name: "Client A" } })).id, coB = (await admin.company.create({ data: { tenantId: t1, name: "Client B" } })).id;
  consId = (await admin.consultant.create({ data: { tenantId: t1, firstName: "Cons", lastName: "Un", status: "active" } })).id;
  missionId = (await admin.mission.create({ data: { tenantId: t1, consultantId: consId, companyId: coA, title: "MS", dailyRate: "500", vatRate: "20", startDate: new Date("2026-01-01") } })).id;
  await mk("admin", t1, ["tenant_admin"]); await mk("ops", t1, ["operations"]); await mk("fin", t1, ["finance"]); await mk("hr", t1, ["hr"]); await mk("dir", t1, ["direction"]);
  await mk("cons", t1, ["consultant"], { consultantId: consId }); await mk("clientA", t1, ["client_user"], { companyId: coA }); await mk("clientB", t1, ["client_user"], { companyId: coB });
  await mk("admin2", t2, ["tenant_admin"]);
  app = await createApp(); await app.init();
  for (const k of ["admin", "ops", "fin", "hr", "dir", "cons", "clientA", "clientB"]) await login(k, S("s1"));
  await login("admin2", S("s2"));
});
beforeEach(() => resetLoginThrottle());
afterAll(async () => { await app.close(); await admin.$disconnect(); });

describe("notifications", () => {
  let ts: string;
  it("événements métier → bonnes personnes seulement (cloisonnement par entreprise)", async () => {
    ts = await submitCra("2031-01");
    const a = await notifs("clientA"); expect(a.map(n => n.type)).toContain("timesheet.submitted"); expect(a[0]!.link).toBe("/client/timesheets");
    expect(await notifs("clientB")).toEqual([]); expect(await notifs("cons")).toEqual([]); // l'acteur n'est pas notifié de sa propre action
    await srv().post(`/client/timesheets/${ts}/transition`).set(H("clientA")).send({ event: "approve" });
    expect((await notifs("ops")).map(n => n.type)).toContain("timesheet.client_approved");
    expect((await notifs("cons")).map(n => n.type)).toContain("timesheet.client_approved");
    expect(await notifs("fin")).toEqual([]); expect(await notifs("dir")).toEqual([]);
    await srv().post(`/timesheets/${ts}/transition`).set(H("ops")).send({ event: "validate" });
    expect((await notifs("cons")).map(n => n.type)).toContain("timesheet.validated");
  });
  it("refus client : le motif est transmis au consultant et aux opérations", async () => {
    const t = await submitCra("2031-02");
    await srv().post(`/client/timesheets/${t}/transition`).set(H("clientA")).send({ event: "reject", rejectReason: "Jours erronés" });
    const n = (await notifs("cons")).find(x => x.type === "timesheet.client_rejected");
    expect(n?.body).toBe("Jours erronés"); expect((await notifs("ops")).some(x => x.type === "timesheet.client_rejected")).toBe(true);
  });
  it("frais et absences : la décision notifie l'auteur", async () => {
    const c = (await srv().post("/me/expenses").set(H("cons")).send({ title: "Frais notif" })).body.id;
    await srv().put(`/me/expenses/${c}/lines`).set(H("cons")).send({ lines: [{ date: "2031-03-03", category: "hotel", description: "Hôtel", amount: "90", receiptRef: "H-1" }] });
    await srv().post(`/me/expenses/${c}/transition`).set(H("cons")).send({ event: "submit" });
    expect((await notifs("ops")).some(x => x.type === "expense.submitted")).toBe(true);
    await srv().post(`/expenses/${c}/transition`).set(H("ops")).send({ event: "reject", rejectReason: "Justificatif manquant" });
    const e = (await notifs("cons")).find(x => x.type === "expense.decided"); expect(e?.title).toMatch(/refusée/); expect(e?.body).toBe("Justificatif manquant");
    const l = (await srv().post("/me/leaves").set(H("cons")).send({ type: "unpaid", startDate: "2031-09-01", endDate: "2031-09-01" })).body.id;
    expect((await notifs("hr")).some(x => x.type === "leave.submitted")).toBe(true);
    await srv().post(`/leaves/${l}/transition`).set(H("hr")).send({ event: "approve" });
    expect((await notifs("cons")).some(x => x.type === "leave.decided" && /approuvée/.test(x.title))).toBe(true);
  });
  it("lecture strictement personnelle, compteur, tout marquer comme lu", async () => {
    const mine = await notifs("cons"); expect(mine.length).toBeGreaterThan(1);
    const before = (await srv().get("/notifications/unread-count").set(H("cons"))).body.count;
    expect((await srv().post(`/notifications/${mine[0]!.id}/read`).set(H("clientB"))).status).toBe(404); // IDOR
    expect((await srv().post(`/notifications/${mine[0]!.id}/read`).set(H("cons"))).status).toBe(201);
    expect((await srv().get("/notifications/unread-count").set(H("cons"))).body.count).toBe(before - 1);
    expect((await srv().post("/notifications/read-all").set(H("cons"))).body.updated).toBe(before - 1);
    expect(await notifs("cons", true)).toEqual([]);
    expect(await notifs("admin2")).toEqual([]);
  });
  it("préférences : un type désactivé n'est plus reçu; canal e-mail déclaré non connecté", async () => {
    const p = (await srv().get("/notification-preferences").set(H("clientA"))).body;
    expect(p.email.status).toBe("not_connected"); expect(p.types.length).toBe(10);
    expect((await srv().put("/notification-preferences").set(H("clientA")).send({ type: "inconnu", enabled: false })).status).toBe(400);
    await srv().put("/notification-preferences").set(H("clientA")).send({ type: "timesheet.submitted", enabled: false });
    const n0 = (await notifs("clientA")).length;
    await submitCra("2031-04");
    expect((await notifs("clientA")).length).toBe(n0);
    await srv().put("/notification-preferences").set(H("clientA")).send({ type: "timesheet.submitted", enabled: true });
    await submitCra("2031-05");
    expect((await notifs("clientA")).length).toBe(n0 + 1);
  });
  it("en base : seule la date de lecture est modifiable; aucune suppression", async () => {
    const n = await admin.notification.findFirstOrThrow({ where: { tenantId: t1 } });
    await expect(admin.notification.update({ where: { id: n.id }, data: { title: "falsifié" } })).rejects.toThrow(/seule la date de lecture/);
    await expect(admin.notification.update({ where: { id: n.id }, data: { readAt: new Date() } })).resolves.toBeTruthy();
    await expect(admin.notification.delete({ where: { id: n.id } })).rejects.toThrow(/append-only/);
  });
});

describe("support", () => {
  let tk: string;
  it("tout membre ouvre un ticket; le personnel est notifié; le demandeur ne voit que les siens", async () => {
    const r = await srv().post("/support/tickets").set(H("clientA")).send({ subject: "Question sur une facture", category: "question", body: "Bonjour, une question." });
    expect(r.status).toBe(201); tk = r.body.id; expect(r.body.status).toBe("open"); expect(r.body.messages).toHaveLength(1);
    expect((await notifs("ops")).some(n => n.type === "support.ticket_created")).toBe(true);
    expect((await notifs("clientB")).some(n => n.type === "support.ticket_created")).toBe(false);
    expect((await srv().get(`/support/tickets/${tk}`).set(H("clientB"))).status).toBe(404); // IDOR entre clients
    expect((await srv().get(`/support/tickets/${tk}`).set(H("cons"))).status).toBe(404);
    expect((await srv().get(`/support/tickets/${tk}`).set(H("admin2"))).status).toBe(404);
    expect((await srv().get("/support/tickets").set(H("clientB"))).body).toEqual([]);
    expect((await srv().get("/support/tickets").set(H("ops"))).body.some((t: { id: string }) => t.id === tk)).toBe(true);
    expect((await srv().post("/support/tickets").set(H("cons")).send({ subject: "x", category: "question", body: "b" })).status).toBe(400);
    expect((await srv().post("/support/tickets").set(H("cons")).send({ subject: "Sujet valide", category: "alien", body: "b" })).status).toBe(400);
  });
  it("réponses, notes internes invisibles du demandeur, workflow de statut", async () => {
    expect((await srv().post(`/support/tickets/${tk}/messages`).set(H("clientA")).send({ body: "note", internal: true })).status).toBe(403);
    const staff = await srv().post(`/support/tickets/${tk}/messages`).set(H("ops")).send({ body: "Bonjour, voici la réponse." });
    expect(staff.body.status).toBe("pending_requester");
    expect((await notifs("clientA")).some(n => n.type === "support.reply")).toBe(true);
    await srv().post(`/support/tickets/${tk}/messages`).set(H("hr")).send({ body: "Note interne : vérifier le contrat", internal: true });
    const asRequester = (await srv().get(`/support/tickets/${tk}`).set(H("clientA"))).body;
    expect(asRequester.messages).toHaveLength(2); expect(JSON.stringify(asRequester)).not.toContain("Note interne"); expect(asRequester.assigneeUserId).toBeUndefined();
    expect((await srv().get(`/support/tickets/${tk}`).set(H("ops"))).body.messages).toHaveLength(3);
    const back = await srv().post(`/support/tickets/${tk}/messages`).set(H("clientA")).send({ body: "Merci, une précision." });
    expect(back.body.status).toBe("open");
    expect((await srv().post(`/support/tickets/${tk}/transition`).set(H("clientA")).send({ event: "resolve" })).status).toBe(403); // résoudre = personnel
    expect((await srv().post(`/support/tickets/${tk}/transition`).set(H("ops")).send({ event: "resolve" })).body.status).toBe("resolved");
    expect((await srv().post(`/support/tickets/${tk}/messages`).set(H("clientA")).send({ body: "Finalement non résolu." })).body.status).toBe("open"); // réouverture par le demandeur
    await srv().post(`/support/tickets/${tk}/transition`).set(H("ops")).send({ event: "resolve" });
    expect((await srv().post(`/support/tickets/${tk}/transition`).set(H("clientA")).send({ event: "close" })).body.status).toBe("closed");
    expect((await srv().post(`/support/tickets/${tk}/messages`).set(H("clientA")).send({ body: "Encore ?" })).status).toBe(409);
    expect((await srv().post(`/support/tickets/${tk}/messages`).set(H("ops")).send({ body: "Encore ?" })).status).toBe(409);
    expect((await srv().post(`/support/tickets/${tk}/messages`).set(H("clientB")).send({ body: "intrus" })).status).toBe(404);
  });
  it("assignation, recherche, modèles de réponse, droits", async () => {
    const t = (await srv().post("/support/tickets").set(H("cons")).send({ subject: "Problème de connexion", category: "incident", priority: "high", body: "Je n'arrive pas à me connecter." })).body.id;
    expect((await srv().post(`/support/tickets/${t}/assign`).set(H("cons")).send({ userId: uid.ops })).status).toBe(403);
    expect((await srv().post(`/support/tickets/${t}/assign`).set(H("ops")).send({ userId: uid.clientA })).status).toBe(400); // pas du support
    expect((await srv().post(`/support/tickets/${t}/assign`).set(H("ops")).send({ userId: uid.hr })).body.assigneeUserId).toBe(uid.hr);
    await srv().post(`/support/tickets/${t}/messages`).set(H("cons")).send({ body: "Relance." });
    expect((await notifs("hr")).some(n => n.type === "support.reply")).toBe(true); // la réponse va à l'assigné
    expect((await srv().get("/support/tickets?q=connexion").set(H("ops"))).body.map((x: { id: string }) => x.id)).toEqual([t]);
    expect((await srv().get("/support/tickets?q=connexion&mine=1").set(H("ops"))).body).toEqual([]);
    expect((await srv().get("/support/tickets?status=alien").set(H("ops"))).status).toBe(400);
    expect((await srv().get("/support/tickets?q=connexion").set(H("cons"))).body).toHaveLength(1); // seulement les siens
    expect((await srv().post("/support/templates").set(H("cons")).send({ name: "Accusé", body: "Bien reçu." })).status).toBe(403);
    expect((await srv().post("/support/templates").set(H("ops")).send({ name: "Accusé", body: "Nous avons bien reçu votre demande." })).status).toBe(201);
    expect((await srv().post("/support/templates").set(H("ops")).send({ name: "Accusé", body: "x" })).status).toBe(409);
    expect((await srv().get("/support/templates").set(H("ops"))).body).toHaveLength(1);
    expect((await srv().get("/support/templates").set(H("admin2"))).body).toEqual([]);
  });
  it("contenu en texte brut et immuabilité des messages en base", async () => {
    const xss = "<script>alert(1)</script>";
    const t = (await srv().post("/support/tickets").set(H("cons")).send({ subject: "Test contenu", category: "other", body: xss })).body;
    expect(t.messages[0].body).toBe(xss); // stocké tel quel, jamais interprété : l'affichage échappe (React)
    const m = await admin.supportMessage.findFirstOrThrow({ where: { tenantId: t1 } });
    await expect(admin.supportMessage.update({ where: { id: m.id }, data: { body: "modifié" } })).rejects.toThrow(/append-only/);
    await expect(admin.supportMessage.delete({ where: { id: m.id } })).rejects.toThrow(/append-only/);
    await expect(admin.supportTicket.update({ where: { id: t.id }, data: { status: "alien" } })).rejects.toThrow();
  });
});
