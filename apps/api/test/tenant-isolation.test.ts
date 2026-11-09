import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { INestApplication } from "@nestjs/common";
import { createApp } from "../src/main";
import { hashPassword } from "../src/password";
import { resetLoginThrottle } from "../src/auth.controller";
import { PrismaService } from "../src/prisma.service";

const admin = new PrismaClient(); // propriétaire: fixtures uniquement
let app: INestApplication;
const PW = "correct-horse-battery";
const run = Date.now().toString(36);
const slug = (s: string) => `${s}-${run}`;
let t1: string, t2: string;

async function mkUser(email: string, tenantId: string, roles: string[]) {
  const u = await admin.user.upsert({ where: { email }, update: {}, create: { email, passwordHash: await hashPassword(PW) } });
  await admin.membership.create({ data: { userId: u.id, tenantId, roles } });
  return u;
}
async function login(email: string, tenant: string) {
  const r = await request(app.getHttpServer()).post("/auth/login").send({ email, password: PW, tenantSlug: tenant });
  return { status: r.status, token: r.body.accessToken as string };
}

beforeAll(async () => {
  t1 = (await admin.tenant.create({ data: { slug: slug("alpha"), name: "Alpha" } })).id;
  t2 = (await admin.tenant.create({ data: { slug: slug("beta"), name: "Beta" } })).id;
  await mkUser(`admin1-${run}@a.test`, t1, ["tenant_admin"]);
  await mkUser(`admin2-${run}@b.test`, t2, ["tenant_admin"]);
  await mkUser(`cons1-${run}@a.test`, t1, ["consultant"]);
  await mkUser(`comm1-${run}@a.test`, t1, ["commerce"]);
  app = await createApp(); await app.init();
});
beforeEach(() => resetLoginThrottle());
afterAll(async () => { await app.close(); await admin.$disconnect(); });

describe("authentification", () => {
  it("login valide, mauvais mot de passe, tenant inconnu, mauvais tenant", async () => {
    expect((await login(`admin1-${run}@a.test`, slug("alpha"))).status).toBe(200);
    const bad = await request(app.getHttpServer()).post("/auth/login").send({ email: `admin1-${run}@a.test`, password: "nope", tenantSlug: slug("alpha") });
    expect(bad.status).toBe(401);
    expect((await login(`admin1-${run}@a.test`, "inconnu")).status).toBe(401);
    expect((await login(`admin1-${run}@a.test`, slug("beta"))).status).toBe(401); // membre d'un autre tenant seulement
  });
  it("limite les tentatives", async () => {
    let last = 0;
    for (let i = 0; i < 7; i++) last = (await request(app.getHttpServer()).post("/auth/login").send({ email: "x@x.test", password: "x", tenantSlug: slug("alpha") })).status;
    expect(last).toBe(429);
  });
  it("refuse sans jeton, jeton falsifié ou signé avec une autre clé", async () => {
    expect((await request(app.getHttpServer()).get("/companies")).status).toBe(401);
    const forged = jwt.sign({ sub: "x", tid: t1 }, "autre-cle-autre-cle-autre-cle-autre-cle");
    expect((await request(app.getHttpServer()).get("/companies").set("Authorization", `Bearer ${forged}`)).status).toBe(401);
    const none = jwt.sign({ sub: "x", tid: t1 }, "", { algorithm: "none" as never });
    expect((await request(app.getHttpServer()).get("/companies").set("Authorization", `Bearer ${none}`)).status).toBe(401);
  });
  it("jeton avec tenant forgé (sans appartenance) refusé", async () => {
    const u = await admin.user.findUnique({ where: { email: `admin1-${run}@a.test` } });
    const forged = jwt.sign({ sub: u!.id, tid: t2 }, process.env.JWT_SECRET!);
    expect((await request(app.getHttpServer()).get("/companies").set("Authorization", `Bearer ${forged}`)).status).toBe(401);
  });
  it("utilisateur désactivé: jeton existant révoqué", async () => {
    await mkUser(`gone-${run}@a.test`, t1, ["tenant_admin"]);
    const { token } = await login(`gone-${run}@a.test`, slug("alpha"));
    expect((await request(app.getHttpServer()).get("/me").set("Authorization", `Bearer ${token}`)).status).toBe(200);
    await admin.user.update({ where: { email: `gone-${run}@a.test` }, data: { disabledAt: new Date() } });
    expect((await request(app.getHttpServer()).get("/me").set("Authorization", `Bearer ${token}`)).status).toBe(401);
  });
});

describe("isolation inter-tenant (IDOR, RLS)", () => {
  let tok1: string, tok2: string, companyOfT2: string;
  beforeAll(async () => {
    tok1 = (await login(`admin1-${run}@a.test`, slug("alpha"))).token;
    tok2 = (await login(`admin2-${run}@b.test`, slug("beta"))).token;
    const r = await request(app.getHttpServer()).post("/companies").set("Authorization", `Bearer ${tok2}`).send({ name: "Client Beta", siren: "123456789" });
    expect(r.status).toBe(201); companyOfT2 = r.body.id;
    await request(app.getHttpServer()).post("/companies").set("Authorization", `Bearer ${tok1}`).send({ name: "Client Alpha" });
  });
  it("liste: chaque tenant ne voit que ses données", async () => {
    const a = await request(app.getHttpServer()).get("/companies").set("Authorization", `Bearer ${tok1}`);
    expect(a.body.map((c: { name: string }) => c.name)).toEqual(["Client Alpha"]);
  });
  it("IDOR: lecture et modification d'un objet d'un autre tenant = 404", async () => {
    expect((await request(app.getHttpServer()).get(`/companies/${companyOfT2}`).set("Authorization", `Bearer ${tok1}`)).status).toBe(404);
    expect((await request(app.getHttpServer()).patch(`/companies/${companyOfT2}`).set("Authorization", `Bearer ${tok1}`).send({ name: "pwn" })).status).toBe(404);
    const still = await request(app.getHttpServer()).get(`/companies/${companyOfT2}`).set("Authorization", `Bearer ${tok2}`);
    expect(still.body.name).toBe("Client Beta");
  });
  it("tenantId fourni dans le body est ignoré", async () => {
    const r = await request(app.getHttpServer()).post("/companies").set("Authorization", `Bearer ${tok1}`).send({ name: "X", tenantId: t2 });
    expect(r.status).toBe(201); expect(r.body.tenantId).toBe(t1);
  });
  it("validation: SIREN invalide, id non-UUID", async () => {
    expect((await request(app.getHttpServer()).post("/companies").set("Authorization", `Bearer ${tok1}`).send({ name: "Y", siren: "12" })).status).toBe(400);
    expect((await request(app.getHttpServer()).get("/companies/not-a-uuid").set("Authorization", `Bearer ${tok1}`)).status).toBe(400);
  });
  it("RLS en base: sans contexte tenant, le rôle applicatif ne voit rien et ne peut pas écrire chez un autre tenant", async () => {
    const prisma = app.get(PrismaService);
    expect(await prisma.company.count()).toBe(0);
    await expect(prisma.forTenant(t1, tx => tx.company.create({ data: { tenantId: t2, name: "evil" } }))).rejects.toThrow();
  });
});

describe("autorisations (RBAC)", () => {
  it("consultant: 403 sur les clients; commerce: lecture/écriture mais pas gestion des membres ni audit", async () => {
    const c = (await login(`cons1-${run}@a.test`, slug("alpha"))).token;
    expect((await request(app.getHttpServer()).get("/companies").set("Authorization", `Bearer ${c}`)).status).toBe(403);
    const m = (await login(`comm1-${run}@a.test`, slug("alpha"))).token;
    expect((await request(app.getHttpServer()).post("/companies").set("Authorization", `Bearer ${m}`).send({ name: "Z" })).status).toBe(201);
    expect((await request(app.getHttpServer()).get("/audit").set("Authorization", `Bearer ${m}`)).status).toBe(403);
    const esc = await request(app.getHttpServer()).post("/invitations").set("Authorization", `Bearer ${m}`).send({ email: `evil-${run}@a.test`, roles: ["tenant_admin"] });
    expect(esc.status).toBe(403);
  });
  it("admin : invitation (rôle invalide refusé, mot de passe faible refusé, jeton à usage unique), compte existant protégé", async () => {
    const api = () => request(app.getHttpServer());
    const H = (t: string) => ({ Authorization: `Bearer ${t}` });
    const tok = (await login(`admin1-${run}@a.test`, slug("alpha"))).token;
    expect((await api().post("/invitations").set(H(tok)).send({ email: `n2-${run}@a.test`, roles: ["superadmin"] })).status).toBe(400);
    const inv = await api().post("/invitations").set(H(tok)).send({ email: `new-${run}@a.test`, roles: ["finance"] });
    expect(inv.status).toBe(201); expect(inv.body.link).toMatch(/^\/invite\?token=/);
    const token = inv.body.link.split("token=")[1];
    expect((await api().post("/auth/invitations/accept").send({ token, password: "court" })).status).toBe(400);
    expect((await api().post("/auth/invitations/accept").send({ token, password: "Cheval-Agrafe-Lune-42" })).status).toBe(200);
    expect((await api().post("/auth/invitations/accept").send({ token, password: "Cheval-Agrafe-Lune-42" })).status).toBe(404); // usage unique
    expect((await api().post("/auth/login").send({ email: `new-${run}@a.test`, password: "Cheval-Agrafe-Lune-42", tenantSlug: slug("alpha") })).status).toBe(200);
    // un compte existant d'un autre tenant : son mot de passe n'est jamais modifié, et il doit le prouver
    const tok2 = (await login(`admin2-${run}@b.test`, slug("beta"))).token;
    void tok2;
    const inv2 = await api().post("/invitations").set(H(tok)).send({ email: `admin2-${run}@b.test`, roles: ["finance"] });
    const t2 = inv2.body.link.split("token=")[1];
    const before = await admin.user.findUnique({ where: { email: `admin2-${run}@b.test` } });
    expect((await api().post("/auth/invitations/accept").send({ token: t2, password: "Attaquant-Choisit-Ceci-99" })).status).toBe(401);
    expect((await api().post("/auth/invitations/accept").send({ token: t2, password: "x", currentPassword: "mauvais" })).status).toBe(401);
    const after = await admin.user.findUnique({ where: { email: `admin2-${run}@b.test` } });
    expect(after!.passwordHash).toBe(before!.passwordHash);
  });
});

describe("audit append-only", () => {
  it("les actions critiques sont journalisées par tenant, sans fuite inter-tenant", async () => {
    const tok1 = (await login(`admin1-${run}@a.test`, slug("alpha"))).token;
    const r = await request(app.getHttpServer()).get("/audit").set("Authorization", `Bearer ${tok1}`);
    expect(r.status).toBe(200);
    const actions = r.body.map((e: { action: string }) => e.action);
    expect(actions).toContain("company.create"); expect(actions).toContain("auth.login");
    expect(r.body.every((e: { tenantId: string }) => e.tenantId === t1)).toBe(true);
  });
  it("UPDATE/DELETE/TRUNCATE refusés, même pour le propriétaire de la base", async () => {
    const ev = await admin.auditEvent.findFirst({ where: { tenantId: t1 } });
    await expect(admin.auditEvent.update({ where: { id: ev!.id }, data: { action: "x" } })).rejects.toThrow(/append-only/);
    await expect(admin.auditEvent.delete({ where: { id: ev!.id } })).rejects.toThrow(/append-only/);
    await expect(admin.$executeRawUnsafe('TRUNCATE "AuditEvent"')).rejects.toThrow(/append-only/);
  });
});
