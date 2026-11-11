import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createHmac, randomInt } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { INestApplication } from "@nestjs/common";
import { createApp } from "../src/main";
import { hashPassword } from "../src/password";
import { resetLoginThrottle } from "../src/auth.controller";
import { FakeProvider, MetaCloudProvider, WaProviderError } from "../src/whatsapp.provider";

process.env.WHATSAPP_PROVIDER = "fake";
process.env.WHATSAPP_APP_SECRET = "app-secret-de-test-app-secret-de-test";
process.env.WHATSAPP_VERIFY_TOKEN = "verify-token-de-test";

const admin = new PrismaClient();
let app: INestApplication;
const PW = "correct-horse-battery";
const run = Date.now().toString(36) + "w";
const rnd = () => String(randomInt(10_000_000, 99_999_999));
const PNID = "1" + rnd() + rnd().slice(0, 4), PNID2 = "2" + rnd() + rnd().slice(0, 4);
const PHONE_LOCAL = `06${rnd().slice(0, 8)}`; // forme nationale saisie par l'utilisateur
const PHONE = `+33${PHONE_LOCAL.slice(1)}`;
let t1: string, t2: string, consId: string, cons2Id: string, missionId: string, convId: string;
const tok: Record<string, string> = {};
const S = (n: string) => `${n}-${run}`;
const srv = () => request(app.getHttpServer());
const H = (k: string) => ({ Authorization: `Bearer ${tok[k]}` });
async function mk(key: string, tenantId: string, roles: string[], extra: { consultantId?: string } = {}) {
  const u = await admin.user.create({ data: { email: `${key}-${run}@x.test`, passwordHash: await hashPassword(PW) } });
  await admin.membership.create({ data: { userId: u.id, tenantId, roles, ...extra } });
}
async function login(key: string, slug: string) { tok[key] = (await srv().post("/auth/login").send({ email: `${key}-${run}@x.test`, password: PW, tenantSlug: slug })).body.accessToken; }
const sign = (raw: string) => "sha256=" + createHmac("sha256", process.env.WHATSAPP_APP_SECRET!).update(raw).digest("hex");
const hook = (payload: unknown, sig?: string) => { const raw = JSON.stringify(payload); return srv().post("/webhooks/whatsapp").set("content-type", "application/json").set("x-hub-signature-256", sig ?? sign(raw)).send(raw); };
const inbound = (id: string, text: string, from = PHONE.slice(1), pnid = PNID) => ({ object: "whatsapp_business_account", entry: [{ id: "waba", changes: [{ field: "messages", value: { metadata: { phone_number_id: pnid }, contacts: [{ wa_id: from, profile: { name: "Cons WA" } }], messages: [{ from, id, type: "text", text: { body: text } }] } }] }] });
const status = (id: string, st: string, pnid = PNID) => ({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: pnid }, statuses: [{ id, status: st }] } }] }] });

beforeAll(async () => {
  t1 = (await admin.tenant.create({ data: { slug: S("w1"), name: "WA 1" } })).id;
  t2 = (await admin.tenant.create({ data: { slug: S("w2"), name: "WA 2" } })).id;
  consId = (await admin.consultant.create({ data: { tenantId: t1, firstName: "Léa", lastName: "Martin", status: "active" } })).id;
  cons2Id = (await admin.consultant.create({ data: { tenantId: t1, firstName: "Sans", lastName: "Consentement", status: "active" } })).id;
  const co = (await admin.company.create({ data: { tenantId: t1, name: "Client WA" } })).id;
  const base = { tenantId: t1, companyId: co, vatRate: "20", startDate: new Date("2031-01-01"), dailyRate: "500" };
  missionId = (await admin.mission.create({ data: { ...base, consultantId: consId, title: "Mission WA" } })).id;
  await admin.mission.create({ data: { ...base, consultantId: cons2Id, title: "Mission sans consentement" } });
  await mk("admin", t1, ["tenant_admin"]); await mk("ops", t1, ["operations"]); await mk("fin", t1, ["finance"]); await mk("cons", t1, ["consultant"], { consultantId: consId });
  await mk("admin2", t2, ["tenant_admin"]);
  app = await createApp(); await app.init();
  for (const k of ["admin", "ops", "fin", "cons"]) await login(k, S("w1"));
  await login("admin2", S("w2"));
});
beforeEach(() => resetLoginThrottle());
afterAll(async () => { await admin.whatsappRoute.deleteMany({ where: { tenantId: { in: [t1, t2] } } }); await app.close(); await admin.$disconnect(); });

describe("canal : droits et configuration", () => {
  it("lecture pour opérations, configuration réservée à l'administrateur, refus aux autres rôles", async () => {
    expect((await srv().get("/whatsapp/channel").set(H("ops"))).status).toBe(200);
    expect((await srv().get("/whatsapp/channel").set(H("fin"))).status).toBe(403);
    expect((await srv().get("/whatsapp/channel").set(H("cons"))).status).toBe(403);
    expect((await srv().put("/whatsapp/channel").set(H("ops")).send({ phoneNumberId: PNID })).status).toBe(403);
    expect((await srv().get("/whatsapp/channel")).status).toBe(401);
    const g = await srv().get("/whatsapp/channel").set(H("admin"));
    expect(g.body.channel).toBeNull(); expect(g.body.simulated).toBe(true);
  });
  it("enregistre le canal sans jamais renvoyer le jeton; refuse un numéro déjà pris par une autre société", async () => {
    expect((await srv().put("/whatsapp/channel").set(H("admin")).send({ phoneNumberId: "abc" })).status).toBe(400);
    const r = await srv().put("/whatsapp/channel").set(H("admin")).send({ phoneNumberId: PNID, accessToken: "EAAB-jeton-secret-de-test-1234567890" });
    expect(r.status).toBe(200); expect(r.body.channel).toMatchObject({ phoneNumberId: PNID, status: "configured", hasToken: true });
    expect(JSON.stringify(r.body)).not.toContain("jeton-secret");
    const row = await admin.whatsappChannel.findUnique({ where: { tenantId: t1 } });
    expect(row!.accessTokenSealed).toMatch(/^v1\./); expect(row!.accessTokenSealed).not.toContain("jeton-secret");
    const dup = await srv().put("/whatsapp/channel").set(H("admin2")).send({ phoneNumberId: PNID, accessToken: "EAAB-autre-jeton-de-test-1234567890" });
    expect(dup.status).toBe(409);
    expect((await srv().get("/whatsapp/channel").set(H("admin2"))).body.channel).toBeNull();
  });
  it("vérification : « verified » seulement après un appel fournisseur (ici simulé)", async () => {
    const v = await srv().post("/whatsapp/channel/verify").set(H("admin"));
    expect(v.status).toBe(200); expect(v.body).toMatchObject({ status: "verified", provider: "fake" });
    expect((await srv().post("/whatsapp/channel/verify").set(H("admin2"))).status).toBe(409);
  });
});

describe("consentement", () => {
  it("normalise le numéro, trace l'audit, refuse numéro invalide / personne inconnue / droit manquant", async () => {
    const body = { subjectType: "consultant", subjectId: consId, phone: PHONE_LOCAL, status: "opted_in", source: "written_form", evidence: "Formulaire d'embauche signé" };
    expect((await srv().post("/whatsapp/consents").set(H("cons")).send(body)).status).toBe(403);
    expect((await srv().post("/whatsapp/consents").set(H("ops")).send({ ...body, phone: "12" })).status).toBe(400);
    expect((await srv().post("/whatsapp/consents").set(H("ops")).send({ ...body, source: "other", evidence: undefined })).status).toBe(400);
    expect((await srv().post("/whatsapp/consents").set(H("ops")).send({ ...body, subjectId: "00000000-0000-4000-8000-000000000001" })).status).toBe(404);
    const ok = await srv().post("/whatsapp/consents").set(H("ops")).send(body);
    expect(ok.status).toBe(201); expect(ok.body).toMatchObject({ phone: PHONE, status: "opted_in" });
    expect(await admin.auditEvent.count({ where: { tenantId: t1, action: "whatsapp.consent_opted_in" } })).toBe(1);
    expect((await srv().get(`/whatsapp/consents?subjectId=${consId}`).set(H("ops"))).body).toHaveLength(1);
    expect((await srv().get("/whatsapp/consents").set(H("admin2"))).body).toHaveLength(0);
  });
});

describe("webhook entrant", () => {
  it("vérification d'abonnement : jeton exact requis", async () => {
    const ok = await srv().get("/webhooks/whatsapp").query({ "hub.mode": "subscribe", "hub.verify_token": process.env.WHATSAPP_VERIFY_TOKEN, "hub.challenge": "12345" });
    expect(ok.status).toBe(200); expect(ok.text).toBe("12345");
    expect((await srv().get("/webhooks/whatsapp").query({ "hub.mode": "subscribe", "hub.verify_token": "faux", "hub.challenge": "1" })).status).toBe(403);
  });
  it("refuse sans signature, avec une mauvaise signature ou un corps modifié", async () => {
    const p = inbound("wamid.X1", "Bonjour");
    expect((await srv().post("/webhooks/whatsapp").send(p)).status).toBe(401);
    expect((await hook(p, "sha256=" + "0".repeat(64))).status).toBe(401);
    expect((await hook(p, "sha256=zz")).status).toBe(401);
    const raw = JSON.stringify(p);
    expect((await srv().post("/webhooks/whatsapp").set("content-type", "application/json").set("x-hub-signature-256", sign(raw)).send(raw.replace("Bonjour", "Bonsoir"))).status).toBe(401);
    expect(await admin.whatsappMessage.count({ where: { tenantId: t1 } })).toBe(0);
  });
  it("message entrant : conversation créée, non lu, fenêtre ouverte; rejeu ignoré; numéro inconnu ignoré", async () => {
    const r = await hook(inbound("wamid.A1", "Bonjour, une question sur mon CRA"));
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ inbound: 1, duplicates: 0 });
    expect((await hook(inbound("wamid.A1", "Bonjour, une question sur mon CRA"))).body).toMatchObject({ inbound: 0, duplicates: 1 });
    expect((await hook(inbound("wamid.Z9", "x", PHONE.slice(1), "999999999999"))).body.unknownNumber).toBe(1);
    const list = (await srv().get("/whatsapp/conversations").set(H("ops"))).body;
    expect(list).toHaveLength(1); convId = list[0].id;
    expect(list[0]).toMatchObject({ phone: PHONE, unreadCount: 1, subjectType: "consultant", subjectId: consId });
    const m = await srv().get(`/whatsapp/conversations/${convId}/messages`).set(H("ops"));
    expect(m.body.windowOpen).toBe(true); expect(m.body.messages).toHaveLength(1); expect(m.body.consent.status).toBe("opted_in");
    expect((await srv().get("/whatsapp/conversations").set(H("ops"))).body[0].unreadCount).toBe(0);
  });
  it("isolation : l'autre société ne voit ni la conversation ni ses messages", async () => {
    expect((await srv().get("/whatsapp/conversations").set(H("admin2"))).body).toHaveLength(0);
    expect((await srv().get(`/whatsapp/conversations/${convId}/messages`).set(H("admin2"))).status).toBe(404);
    expect((await srv().post(`/whatsapp/conversations/${convId}/messages`).set(H("admin2")).send({ text: "intrusion" })).status).toBe(404);
  });
});

describe("réponse libre et fenêtre de 24 h", () => {
  it("réponse dans la fenêtre : envoyée (simulée) ; statuts ensuite monotones", async () => {
    FakeProvider.sent.length = 0;
    const r = await srv().post(`/whatsapp/conversations/${convId}/messages`).set(H("ops")).send({ text: "Bonjour Léa, on regarde ça." });
    expect(r.status).toBe(201); expect(r.body.status).toBe("simulated"); // jamais « sent » avec le faux fournisseur
    expect(FakeProvider.sent).toEqual([{ to: PHONE, kind: "text", payload: "Bonjour Léa, on regarde ça." }]);
    expect((await srv().post(`/whatsapp/conversations/${convId}/messages`).set(H("ops")).send({ text: "   " })).status).toBe(400);
    expect((await srv().post(`/whatsapp/conversations/${convId}/messages`).set(H("cons")).send({ text: "x" })).status).toBe(403);
  });
  it("hors fenêtre : texte libre refusé (409 outside_window)", async () => {
    await admin.whatsappConversation.update({ where: { id: convId }, data: { lastInboundAt: new Date(Date.now() - 25 * 3600_000) } });
    const r = await srv().post(`/whatsapp/conversations/${convId}/messages`).set(H("ops")).send({ text: "Trop tard" });
    expect(r.status).toBe(409); expect(r.body.error.code).toBe("outside_window");
    await admin.whatsappConversation.update({ where: { id: convId }, data: { lastInboundAt: new Date() } });
  });
  it("accusés de réception du fournisseur : progression sent -> delivered -> read, jamais de recul", async () => {
    const msg = await admin.whatsappMessage.create({ data: { tenantId: t1, conversationId: convId, direction: "out", kind: "text", body: "suivi", status: "sent", providerMessageId: "wamid.OUT1" } });
    await hook(status("wamid.OUT1", "read"));
    await hook(status("wamid.OUT1", "delivered"));
    expect((await admin.whatsappMessage.findUnique({ where: { id: msg.id } }))!.status).toBe("read");
    const m2 = await admin.whatsappMessage.create({ data: { tenantId: t1, conversationId: convId, direction: "out", kind: "text", body: "échec", status: "sent", providerMessageId: "wamid.OUT2" } });
    await hook({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: PNID }, statuses: [{ id: "wamid.OUT2", status: "failed", errors: [{ title: "Numéro non WhatsApp" }] }] } }] }] });
    const f = await admin.whatsappMessage.findUnique({ where: { id: m2.id } });
    expect(f).toMatchObject({ status: "failed", error: "Numéro non WhatsApp" });
    // un statut pour un message d'une autre société (même identifiant fournisseur) ne le touche pas
    await hook(status("wamid.OUT1", "failed", PNID2));
    expect((await admin.whatsappMessage.findUnique({ where: { id: msg.id } }))!.status).toBe("read");
  });
});

describe("relance de CRA par WhatsApp", () => {
  it("sans modèle activé : rien n'est envoyé ; avec modèle activé et consentement : un message par consultant concerné", async () => {
    await admin.whatsappMessage.deleteMany({ where: { tenantId: t1, kind: "template" } });
    FakeProvider.sent.length = 0;
    const r0 = await srv().post("/timesheets/reminders").set(H("ops")).send({ period: "2031-02" });
    expect(r0.status).toBe(201); expect(r0.body.whatsapp).toMatchObject({ queued: 0, templateNotEnabled: 1, noConsent: 1 });
    expect(FakeProvider.sent).toHaveLength(0);

    expect((await srv().put("/whatsapp/templates").set(H("ops")).send({ templates: [] })).status).toBe(403);
    expect((await srv().put("/whatsapp/templates").set(H("admin")).send({ templates: [{ key: "inconnu", metaName: "x", language: "fr", enabled: true }] })).status).toBe(400);
    expect((await srv().put("/whatsapp/templates").set(H("admin")).send({ templates: [{ key: "timesheet_reminder", metaName: "Nom Invalide", language: "fr", enabled: true }] })).status).toBe(400);
    const t = await srv().put("/whatsapp/templates").set(H("admin")).send({ templates: [{ key: "timesheet_reminder", metaName: "portage_cra_relance", language: "fr", enabled: true }] });
    expect(t.status).toBe(200); expect(t.body.templates.find((x: { key: string }) => x.key === "timesheet_reminder")).toMatchObject({ enabled: true, metaName: "portage_cra_relance" });

    await admin.timesheetReminder.deleteMany({ where: { tenantId: t1 } });
    const r1 = await srv().post("/timesheets/reminders").set(H("ops")).send({ period: "2031-02" });
    expect(r1.body.whatsapp).toMatchObject({ queued: 1, noConsent: 1 });
    expect(FakeProvider.sent).toHaveLength(1);
    expect(FakeProvider.sent[0]).toMatchObject({ to: PHONE, kind: "template", payload: { name: "portage_cra_relance", language: "fr", params: ["Léa", "2031-02", "Mission WA"] } });
    const sent = await admin.whatsappMessage.findFirst({ where: { tenantId: t1, kind: "template" } });
    expect(sent).toMatchObject({ status: "simulated", templateKey: "timesheet_reminder" }); expect(sent!.body).toContain("Léa");
    // idempotent le même jour
    const r2 = await srv().post("/timesheets/reminders").set(H("ops")).send({ period: "2031-02" });
    expect(r2.body.alreadyRemindedToday).toBe(2); expect(FakeProvider.sent).toHaveLength(1);
  });
  it("sans canal configuré, le message reste tracé « not_connected » (jamais « envoyé »)", async () => {
    const m = await admin.whatsappMessage.create({ data: { tenantId: t2, conversationId: (await admin.whatsappConversation.create({ data: { tenantId: t2, phone: "+33699990000" } })).id, direction: "out", kind: "text", body: "x", status: "queued" } });
    expect((await srv().post("/whatsapp/flush").set(H("admin2"))).body).toMatchObject({ processed: 1, notConnected: 1, sent: 0 });
    expect((await admin.whatsappMessage.findUnique({ where: { id: m.id } }))!.status).toBe("not_connected");
  });
});

describe("retrait du consentement (STOP)", () => {
  it("un message STOP retire le consentement, trace l'audit et bloque tout envoi (texte, modèle, relance)", async () => {
    const r = await hook(inbound("wamid.STOP1", "STOP"));
    expect(r.body.optOuts).toBe(1);
    const c = await admin.whatsappConsent.findFirst({ where: { tenantId: t1, subjectId: consId } });
    expect(c).toMatchObject({ status: "opted_out", source: "stop_keyword" });
    expect(await admin.auditEvent.count({ where: { tenantId: t1, action: "whatsapp.consent_opted_out" } })).toBe(1);
    const text = await srv().post(`/whatsapp/conversations/${convId}/messages`).set(H("ops")).send({ text: "Une dernière question" });
    expect(text.status).toBe(409); expect(text.body.error.code).toBe("opted_out");
    const tpl = await srv().post("/whatsapp/send-template").set(H("ops")).send({ subjectType: "consultant", subjectId: consId, key: "timesheet_reminder", params: ["Léa", "2031-02", "M"] });
    expect(tpl.status).toBe(400); expect(tpl.body.error.code).toBe("no_consent");
    FakeProvider.sent.length = 0; await admin.timesheetReminder.deleteMany({ where: { tenantId: t1 } });
    const rem = await srv().post("/timesheets/reminders").set(H("ops")).send({ period: "2031-02" });
    expect(rem.body.whatsapp.queued).toBe(0); expect(FakeProvider.sent).toHaveLength(0);
  });
  it("le consentement peut être rétabli par un humain, avec trace", async () => {
    const r = await srv().post("/whatsapp/consents").set(H("ops")).send({ subjectType: "consultant", subjectId: consId, phone: PHONE, status: "opted_in", source: "in_app", evidence: "Accord confirmé par téléphone" });
    expect(r.status).toBe(201); expect(r.body.status).toBe("opted_in");
    expect(await admin.auditEvent.count({ where: { tenantId: t1, action: "whatsapp.consent_opted_in" } })).toBe(2);
  });
});

describe("webhook désactivé et canal désactivé", () => {
  it("sans secret d'application configuré, le webhook refuse tout (non connecté)", async () => {
    const s = process.env.WHATSAPP_APP_SECRET; delete process.env.WHATSAPP_APP_SECRET;
    try { expect((await srv().post("/webhooks/whatsapp").send(inbound("wamid.N1", "x"))).status).toBe(403); } finally { process.env.WHATSAPP_APP_SECRET = s; }
  });
  it("désactiver le canal supprime le jeton et le routage", async () => {
    expect((await srv().delete("/whatsapp/channel").set(H("admin"))).status).toBe(204);
    const row = await admin.whatsappChannel.findUnique({ where: { tenantId: t1 } });
    expect(row).toMatchObject({ status: "disabled", accessTokenSealed: null });
    expect(await admin.whatsappRoute.count({ where: { phoneNumberId: PNID } })).toBe(0);
    expect((await hook(inbound("wamid.AFTER", "x"))).body.unknownNumber).toBe(1);
  });
});

describe("fournisseur Meta (appels simulés par un fetch factice)", () => {
  const creds = { phoneNumberId: "12345678", accessToken: "TOKEN-SECRET" };
  it("construit les requêtes Graph API et ne divulgue pas le jeton dans les erreurs", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ messages: [{ id: "wamid.OK" }] }), { status: 200 }); }) as unknown as typeof fetch;
    const p = new MetaCloudProvider(f, "v99.0");
    expect(await p.sendText(creds, "+33612345678", "Salut")).toEqual({ id: "wamid.OK" });
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v99.0/12345678/messages");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN-SECRET");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ messaging_product: "whatsapp", to: "33612345678", type: "text", text: { body: "Salut" } });
    await p.sendTemplate(creds, "+33612345678", { name: "tpl", language: "fr", params: ["a", "b"] });
    expect(JSON.parse(calls[1]!.init.body as string).template).toEqual({ name: "tpl", language: { code: "fr" }, components: [{ type: "body", parameters: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }] });
    const bad = new MetaCloudProvider((async () => new Response(JSON.stringify({ error: { message: "Invalid OAuth access token", code: 190 } }), { status: 401 })) as unknown as typeof fetch);
    const e = await bad.sendText(creds, "+33612345678", "x").catch(x => x);
    expect(e).toBeInstanceOf(WaProviderError); expect(e.message).toContain("190"); expect(e.message).not.toContain("TOKEN-SECRET");
    const down = new MetaCloudProvider((async () => { throw new Error("ECONNREFUSED TOKEN-SECRET"); }) as unknown as typeof fetch);
    expect((await down.check(creds).catch(x => x)).message).not.toContain("TOKEN-SECRET");
  });
  it("le faux fournisseur est interdit en production", async () => {
    const { WhatsappService } = await import("../src/whatsapp.service");
    const svc = new WhatsappService({} as never, {} as never);
    const prev = process.env.NODE_ENV; process.env.NODE_ENV = "production";
    try { expect(svc.provider().name).toBe("meta"); } finally { process.env.NODE_ENV = prev; }
  });
});
