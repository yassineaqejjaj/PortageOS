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
const run = Date.now().toString(36) + "o";
let plat: string, platSlug: string, platOriginalMfa = false, platCreated = false, other: string, newId: string, newSlug: string;
const tok: Record<string, string> = {};
const S = (n: string) => `${n}-${run}`;
const srv = () => request(app.getHttpServer());
const H = (k: string) => ({ Authorization: `Bearer ${tok[k]}` });
async function mk(key: string, tenantId: string, roles: string[]) {
  const u = await admin.user.create({ data: { email: `${key}-${run}@x.test`, passwordHash: await hashPassword(PW) } });
  await admin.membership.create({ data: { userId: u.id, tenantId, roles } });
}
async function login(key: string, slug: string) { const r = await srv().post("/auth/login").send({ email: `${key}-${run}@x.test`, password: PW, tenantSlug: slug }); tok[key] = r.body.accessToken; return r; }
const token = (link: string) => link.split("token=")[1]!;

beforeAll(async () => {
  // Un seul tenant plateforme possible : on réutilise celui de la base locale (graine démo) sinon on le crée ; son état est restauré à la fin.
  const existing = await admin.tenant.findFirst({ where: { isPlatform: true } });
  platOriginalMfa = existing?.mfaRequired ?? false; platCreated = !existing;
  plat = existing?.id ?? (await admin.tenant.create({ data: { slug: S("plat"), name: "Plateforme", isPlatform: true } })).id;
  platSlug = existing?.slug ?? S("plat");
  await admin.tenant.update({ where: { id: plat }, data: { mfaRequired: true } });
  other = (await admin.tenant.create({ data: { slug: S("oth"), name: "Société tierce" } })).id;
  await mk("opadmin", plat, ["tenant_admin"]); await mk("opops", plat, ["operations"]); await mk("othadmin", other, ["tenant_admin"]);
  app = await createApp(); await app.init();
  for (const [k, s] of [["opadmin", platSlug], ["opops", platSlug], ["othadmin", S("oth")]] as const) await login(k, s);
});
beforeEach(() => resetLoginThrottle());
afterAll(async () => { await admin.tenant.update({ where: { id: plat }, data: { mfaRequired: platOriginalMfa } }).catch(() => undefined); await app.close(); await admin.$disconnect(); });

describe("accès à la console", () => {
  it("refusé à un administrateur de société, à un non-administrateur de la plateforme", async () => {
    expect((await srv().get("/operator/tenants").set(H("othadmin"))).status).toBe(403);
    expect((await srv().post("/operator/tenants").set(H("othadmin")).send({ slug: S("x"), name: "X", adminEmail: "x@x.test" })).status).toBe(403);
    expect((await srv().get("/operator/tenants").set(H("opops"))).status).toBe(403 /* MFA d'abord */);
    expect((await srv().get("/operator/tenants")).status).toBe(401);
  });
  it("MFA obligatoire pour l'exploitant : sans MFA activé, refus avec code d'inscription", async () => {
    const r = await srv().get("/operator/tenants").set(H("opadmin"));
    expect(r.status).toBe(403); expect(r.body.error.code).toBe("mfa_enrollment_required");
    await admin.tenant.update({ where: { id: plat }, data: { mfaRequired: false } }); // la suite teste la console elle-même
    expect((await srv().get("/operator/tenants").set(H("opops"))).status).toBe(403); // rôle insuffisant même sans MFA
    expect((await srv().get("/operator/tenants").set(H("opadmin"))).status).toBe(200);
  });
  it("/me annonce platform.manage au seul exploitant", async () => {
    expect((await srv().get("/me").set(H("opadmin"))).body.permissions).toContain("platform.manage");
    expect((await srv().get("/me").set(H("othadmin"))).body.permissions).not.toContain("platform.manage");
  });
  it("isPlatform est immuable et unique, même pour le propriétaire de la base", async () => {
    await expect(admin.tenant.update({ where: { id: other }, data: { isPlatform: true } })).rejects.toThrow();
    await expect(admin.tenant.update({ where: { id: plat }, data: { isPlatform: false } })).rejects.toThrow(/immuable/);
    await expect(admin.tenant.create({ data: { slug: S("p2"), name: "P2", isPlatform: true } })).rejects.toThrow(); // un seul tenant plateforme
  });
});

describe("création et cycle de vie d'une société", () => {
  it("crée la société, invite son premier administrateur (jeton à usage unique), journalise des deux côtés", async () => {
    newSlug = S("neuve");
    expect((await srv().post("/operator/tenants").set(H("opadmin")).send({ slug: "Bad Slug", name: "N", adminEmail: "a@x.test" })).status).toBe(400);
    expect((await srv().post("/operator/tenants").set(H("opadmin")).send({ slug: "admin", name: "Réservé", adminEmail: "a@x.test" })).status).toBe(400);
    expect((await srv().post("/operator/tenants").set(H("opadmin")).send({ slug: newSlug, name: "Neuve", adminEmail: "pas-un-mail" })).status).toBe(400);
    const r = await srv().post("/operator/tenants").set(H("opadmin")).send({ slug: newSlug, name: "Société neuve", plan: "Pilote", maxMembers: 2, adminEmail: `neuve-${run}@x.test` });
    expect(r.status).toBe(201); newId = r.body.tenant.id; expect(r.body.tenant.isPlatform).toBe(false); expect(r.body.invitation.link).toContain("/invite?token=");
    expect((await srv().post("/operator/tenants").set(H("opadmin")).send({ slug: newSlug, name: "Doublon", adminEmail: "a@x.test" })).status).toBe(409);
    const acc = await srv().post("/auth/invitations/accept").send({ token: token(r.body.invitation.link), password: PW });
    expect(acc.status).toBe(200);
    expect((await srv().post("/auth/invitations/accept").send({ token: token(r.body.invitation.link), password: PW })).status).toBe(404); // usage unique
    expect((await login("neuve", newSlug).then(x => x.status))).toBe(200);
    expect((await srv().get("/me").set(H("neuve"))).body.roles).toEqual(["tenant_admin"]);
    expect((await srv().get("/operator/tenants").set(H("neuve"))).status).toBe(403);
    expect(await admin.auditEvent.count({ where: { tenantId: newId, action: "operator.tenant_created" } })).toBe(1);
    expect(await admin.auditEvent.count({ where: { tenantId: plat, action: "operator.tenant_created", entityId: newId } })).toBe(1);
  });
  it("quota de membres appliqué aux invitations; abaissement sous l'existant refusé", async () => {
    const inv = (email: string) => srv().post("/invitations").set(H("neuve")).send({ email, roles: ["operations"] });
    expect((await inv(`m1-${run}@x.test`)).status).toBe(201);
    const full = await inv(`m2-${run}@x.test`);
    expect(full.status).toBe(409); expect(full.body.error.message).toMatch(/Quota/);
    expect((await srv().patch(`/operator/tenants/${newId}`).set(H("opadmin")).send({ maxMembers: 1 })).status).toBe(400);
    expect((await srv().patch(`/operator/tenants/${newId}`).set(H("opadmin")).send({ maxMembers: 3, plan: "Standard" })).body.maxMembers).toBe(3);
    expect((await inv(`m2-${run}@x.test`)).status).toBe(201);
    expect((await srv().patch(`/operator/tenants/${newId}`).set(H("opadmin")).send({})).status).toBe(400);
  });
  it("suspension : connexion et sessions refusées, données conservées; réactivation", async () => {
    expect((await srv().post(`/operator/tenants/${newId}/suspend`).set(H("opadmin")).send({ reason: "x" })).status).toBe(400);
    const s = await srv().post(`/operator/tenants/${newId}/suspend`).set(H("opadmin")).send({ reason: "Impayé constaté hors plateforme" });
    expect(s.status).toBe(201); expect(s.body.status).toBe("suspended");
    expect((await srv().get("/me").set(H("neuve"))).status).toBe(401); // session révoquée
    const l = await srv().post("/auth/login").send({ email: `neuve-${run}@x.test`, password: PW, tenantSlug: newSlug });
    expect(l.status).toBe(403); expect(l.body.error.message).toMatch(/suspendue/);
    expect((await srv().post("/auth/login").send({ email: `neuve-${run}@x.test`, password: "mauvais-mot-de-passe-1", tenantSlug: newSlug })).status).toBe(401); // pas d'indice sans identifiants valides
    expect((await srv().post(`/operator/tenants/${newId}/suspend`).set(H("opadmin")).send({ reason: "Encore une fois" })).status).toBe(409);
    expect(await admin.membership.count({ where: { tenantId: newId } })).toBe(1); // données conservées
    expect((await srv().post(`/operator/tenants/${plat}/suspend`).set(H("opadmin")).send({ reason: "Tentative interdite" })).status).toBe(400);
    expect((await srv().post(`/operator/tenants/${newId}/reactivate`).set(H("opadmin"))).body.status).toBe("active");
    expect((await login("neuve", newSlug)).status).toBe(200);
    expect(await admin.auditEvent.count({ where: { tenantId: newId, action: { in: ["operator.tenant_suspended", "operator.tenant_reactivated"] } } })).toBe(2);
  });
  it("nouvelle invitation du premier administrateur; liste et détail sans donnée métier", async () => {
    const r = await srv().post(`/operator/tenants/${newId}/admin-invitation`).set(H("opadmin")).send({ adminEmail: `autre-${run}@x.test` });
    expect(r.status).toBe(201); expect(r.body.link).toContain("token=");
    expect((await srv().post(`/operator/tenants/${plat}/admin-invitation`).set(H("opadmin")).send({ adminEmail: "z@x.test" })).status).toBe(404);
    const list = (await srv().get("/operator/tenants").set(H("opadmin"))).body as { id: string; members: number; isPlatform: boolean }[];
    const mine = list.find(t => t.id === newId)!; expect(mine.members).toBe(1);
    expect(list.filter(t => t.isPlatform).length).toBe(1);
    const d = (await srv().get(`/operator/tenants/${newId}`).set(H("opadmin"))).body;
    expect(d.pendingInvitations).toBeGreaterThan(0); expect(Object.keys(d)).not.toContain("companies");
    expect((await srv().get(`/operator/tenants/00000000-0000-4000-8000-000000000000`).set(H("opadmin"))).status).toBe(404);
  });
});
