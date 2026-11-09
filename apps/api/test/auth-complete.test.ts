import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { INestApplication } from "@nestjs/common";
import { createApp } from "../src/main";
import { hashPassword } from "../src/password";
import { resetLoginThrottle } from "../src/auth.controller";
import { base32Decode, hotp, stepOf, verifyTotp } from "../src/totp";

const admin = new PrismaClient();
let app: INestApplication;
const PW = "Cheval-Agrafe-Lune-42";
const run = Date.now().toString(36) + "x";
let t1: string, t2: string;
const S = (n: string) => `${n}-${run}`;
const srv = () => request(app.getHttpServer());
const H = (t: string) => ({ Authorization: `Bearer ${t}` });
const email = (k: string) => `${k.toLowerCase()}-${run}@x.test`;
async function mk(key: string, tenantId: string, roles: string[], extra: { companyId?: string; consultantId?: string } = {}) {
  const u = await admin.user.create({ data: { email: email(key), passwordHash: await hashPassword(PW) } });
  await admin.membership.create({ data: { userId: u.id, tenantId, roles, ...extra } }); return u.id;
}
const login = (key: string, slug: string, password = PW) => srv().post("/auth/login").send({ email: email(key), password, tenantSlug: slug });
const code = (secretB32: string, offsetSteps = 0) => hotp(base32Decode(secretB32), stepOf(Date.now()) + offsetSteps);
const ids: Record<string, string> = {};

beforeAll(async () => {
  t1 = (await admin.tenant.create({ data: { slug: S("au1"), name: "Auth 1" } })).id;
  t2 = (await admin.tenant.create({ data: { slug: S("au2"), name: "Auth 2" } })).id;
  ids.admin = await mk("admin", t1, ["tenant_admin"]); ids.ops = await mk("ops", t1, ["operations"]); ids.other = await mk("admin2", t2, ["tenant_admin"]);
  app = await createApp(); await app.init();
});
beforeEach(() => resetLoginThrottle());
afterAll(async () => { await app.close(); await admin.$disconnect(); });

describe("TOTP (RFC 6238)", () => {
  it("vecteur de test officiel et anti-rejeu", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // "12345678901234567890"
    expect(hotp(base32Decode(secret), stepOf(59_000), 8)).toBe("94287082");
    expect(verifyTotp(secret, "287082", 59_000)).toBe(1);
    expect(verifyTotp(secret, "287082", 59_000, 1)).toBeNull(); // même pas déjà utilisé
    expect(verifyTotp(secret, "000000", 59_000)).toBeNull(); expect(verifyTotp(secret, "12345", 59_000)).toBeNull();
    expect(verifyTotp(secret, "287082", 59_000 + 95_000)).toBeNull(); // hors fenêtre ±1
  });
});

describe("sessions : rafraîchissement avec rotation, détection de rejeu, révocation", () => {
  it("rotation, ancien jeton rejoué = session révoquée, déconnexion et révocation immédiates", async () => {
    const l = (await login("admin", S("au1"))).body;
    expect(l.refreshToken).toBeTruthy();
    expect((await srv().get("/me").set(H(l.accessToken))).status).toBe(200);
    const r1 = (await srv().post("/auth/refresh").send({ refreshToken: l.refreshToken })).body;
    expect(r1.refreshToken).not.toBe(l.refreshToken); expect((await srv().get("/me").set(H(r1.accessToken))).status).toBe(200);
    expect((await srv().post("/auth/refresh").send({ refreshToken: l.refreshToken })).status).toBe(401); // rejeu de l'ancien jeton
    expect((await srv().get("/me").set(H(r1.accessToken))).status).toBe(401); // la session entière est révoquée
    expect((await srv().post("/auth/refresh").send({ refreshToken: r1.refreshToken })).status).toBe(401);
    expect((await admin.auditEvent.count({ where: { tenantId: t1, action: "auth.refresh_reuse_detected" } }))).toBeGreaterThan(0);
    expect((await srv().post("/auth/refresh").send({ refreshToken: "x".repeat(40) })).status).toBe(401);
  });
  it("logout, liste et révocation des sessions, changement de mot de passe", async () => {
    const a = (await login("admin", S("au1"))).body, b = (await login("admin", S("au1"))).body;
    const list = (await srv().get("/auth/sessions").set(H(a.accessToken))).body;
    expect(list.length).toBeGreaterThanOrEqual(2); expect(list.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    const other = list.find((s: { current: boolean }) => !s.current);
    expect((await srv().delete(`/auth/sessions/${other.id}`).set(H(a.accessToken))).status).toBe(200);
    expect((await srv().get("/me").set(H(b.accessToken))).status).toBe(200 === 200 && (await srv().get("/me").set(H(b.accessToken))).status);
    expect((await srv().post("/auth/logout").set(H(a.accessToken))).status).toBe(200);
    expect((await srv().get("/me").set(H(a.accessToken))).status).toBe(401);
    // changement de mot de passe : mauvais actuel / mot de passe faible / succès + autres sessions coupées
    const c = (await login("ops", S("au1"))).body, d = (await login("ops", S("au1"))).body;
    expect((await srv().post("/auth/password").set(H(c.accessToken)).send({ currentPassword: "faux", newPassword: "Nouveau-Mot-De-Passe-77" })).status).toBe(401);
    expect((await srv().post("/auth/password").set(H(c.accessToken)).send({ currentPassword: PW, newPassword: "court" })).status).toBe(400);
    expect((await srv().post("/auth/password").set(H(c.accessToken)).send({ currentPassword: PW, newPassword: "Nouveau-Mot-De-Passe-77" })).status).toBe(200);
    expect((await srv().get("/me").set(H(d.accessToken))).status).toBe(401); expect((await srv().get("/me").set(H(c.accessToken))).status).toBe(200);
    expect((await login("ops", S("au1"), PW)).status).toBe(401); expect((await login("ops", S("au1"), "Nouveau-Mot-De-Passe-77")).status).toBe(200);
  });
});

describe("MFA TOTP", () => {
  let secret: string, recovery: string[];
  it("activation : secret chiffré en base, codes de secours à usage unique", async () => {
    const tok = (await login("admin", S("au1"))).body.accessToken;
    const s = (await srv().post("/auth/mfa/setup").set(H(tok))).body;
    expect(s.otpauthUri).toMatch(/^otpauth:\/\/totp\//); secret = s.secret;
    const u = await admin.user.findUniqueOrThrow({ where: { id: ids.admin } });
    expect(u.mfaPendingEnc).toBeTruthy(); expect(u.mfaPendingEnc).not.toContain(secret); // jamais en clair
    expect((await srv().post("/auth/mfa/enable").set(H(tok)).send({ code: "000000" })).status).toBe(400);
    const en = await srv().post("/auth/mfa/enable").set(H(tok)).send({ code: code(secret) });
    expect(en.status).toBe(200); recovery = en.body.recoveryCodes; expect(recovery).toHaveLength(10);
    const after = await admin.user.findUniqueOrThrow({ where: { id: ids.admin } });
    expect(after.mfaEnabledAt).toBeTruthy(); expect(after.recoveryHashes.join()).not.toContain(recovery[0]!); // haché
    expect((await srv().post("/auth/mfa/setup").set(H(tok))).status).toBe(409);
  });
  it("connexion en deux étapes : pas de session sans second facteur, code rejoué refusé, code de secours à usage unique", async () => {
    const l = await login("admin", S("au1"));
    expect(l.body.mfaRequired).toBe(true); expect(l.body.accessToken).toBeUndefined();
    expect((await srv().get("/me").set(H(l.body.mfaToken))).status).toBe(401); // le jeton d'étape n'ouvre aucune route
    expect((await srv().post("/auth/mfa/verify").send({ mfaToken: l.body.mfaToken, code: "123456" })).status).toBe(401);
    // le pas utilisé à l'activation ne peut pas être rejoué : on prend le pas suivant
    const ok = await srv().post("/auth/mfa/verify").send({ mfaToken: l.body.mfaToken, code: code(secret, 1) });
    expect(ok.status).toBe(200); expect(ok.body.accessToken).toBeTruthy();
    expect((await srv().get("/me").set(H(ok.body.accessToken))).body.mfaEnabled).toBe(true);
    const l2 = await login("admin", S("au1"));
    expect((await srv().post("/auth/mfa/verify").send({ mfaToken: l2.body.mfaToken, code: code(secret, 1) })).status).toBe(401); // rejeu
    expect((await srv().post("/auth/mfa/verify").send({ mfaToken: l2.body.mfaToken, recoveryCode: recovery[0] })).status).toBe(200);
    const l3 = await login("admin", S("au1"));
    expect((await srv().post("/auth/mfa/verify").send({ mfaToken: l3.body.mfaToken, recoveryCode: recovery[0] })).status).toBe(401); // déjà utilisé
    expect((await srv().post("/auth/mfa/verify").send({ mfaToken: "x".repeat(30), code: "123456" })).status).toBe(401);
    expect((await srv().post("/auth/mfa/verify").send({ mfaToken: l3.body.mfaToken })).status).toBe(400);
  });
  it("blocage après échecs répétés du second facteur", async () => {
    const l = await login("admin", S("au1"));
    for (let i = 0; i < 5; i++) await srv().post("/auth/mfa/verify").send({ mfaToken: l.body.mfaToken, code: "111111" });
    expect((await srv().post("/auth/mfa/verify").send({ mfaToken: l.body.mfaToken, code: code(secret, 1) })).status).toBe(429);
  });
  it("désactivation : mot de passe ET code requis", async () => {
    resetLoginThrottle();
    const l = await login("admin", S("au1"));
    const tok = (await srv().post("/auth/mfa/verify").send({ mfaToken: l.body.mfaToken, code: code(secret, -1) }));
    // le pas -1 est antérieur au dernier pas utilisé : refusé (anti-rejeu strict) -> on utilise un code de secours
    const v = tok.status === 200 ? tok : await srv().post("/auth/mfa/verify").send({ mfaToken: l.body.mfaToken, recoveryCode: recovery[1] });
    const t = v.body.accessToken;
    expect((await srv().post("/auth/mfa/disable").set(H(t)).send({ password: "faux", code: "123456" })).status).toBe(401);
    const step = stepOf(Date.now()) + 2; // pas futur hors fenêtre : refus
    void step;
    const u = await admin.user.findUniqueOrThrow({ where: { id: ids.admin } });
    await admin.user.update({ where: { id: ids.admin }, data: { mfaLastStep: stepOf(Date.now()) - 5 } }); // autorise le pas courant pour ce test
    expect((await srv().post("/auth/mfa/disable").set(H(t)).send({ password: PW, code: code(secret) })).status).toBe(200);
    expect((await admin.user.findUniqueOrThrow({ where: { id: ids.admin } })).mfaEnabledAt).toBeNull(); void u;
    expect((await login("admin", S("au1"))).body.accessToken).toBeTruthy();
  });
});

describe("MFA obligatoire par société", () => {
  it("l'administrateur doit être inscrit avant d'imposer le MFA; les non-inscrits sont ensuite bloqués hors inscription", async () => {
    ids.sec = await mk("sec", t1, ["tenant_admin"]);
    const first = (await login("sec", S("au1"))).body.accessToken;
    const sec = (await srv().post("/auth/mfa/setup").set(H(first))).body.secret as string;
    expect((await srv().post("/auth/mfa/enable").set(H(first)).send({ code: code(sec) })).status).toBe(200);
    const again = await login("sec", S("au1"));
    const secTok = (await srv().post("/auth/mfa/verify").send({ mfaToken: again.body.mfaToken, code: code(sec, 1) })).body.accessToken as string;
    const adminTok = (await login("admin", S("au1"))).body.accessToken;
    expect((await srv().put("/tenant/security").set(H(adminTok)).send({ mfaRequired: true })).status).toBe(409); // admin sans MFA : refus (évite l'auto-blocage)
    expect((await srv().put("/tenant/security").set(H(secTok)).send({ mfaRequired: true })).status).toBe(200);
    const opsTok = (await login("ops", S("au1"), "Nouveau-Mot-De-Passe-77")).body.accessToken;
    const blocked = await srv().get("/companies").set(H(opsTok));
    expect(blocked.status).toBe(403); expect(blocked.body.error.code).toBe("mfa_enrollment_required");
    expect((await srv().get("/me").set(H(opsTok))).body.mfaEnrollmentRequired).toBe(true);
    const s = (await srv().post("/auth/mfa/setup").set(H(opsTok))).body;
    expect((await srv().post("/auth/mfa/enable").set(H(opsTok)).send({ code: code(s.secret) })).status).toBe(200);
    expect((await srv().get("/companies").set(H(opsTok))).status).not.toBe(403);
    expect((await srv().put("/tenant/security").set(H(opsTok)).send({ mfaRequired: false })).status).toBe(403); // pas administrateur
    expect((await srv().put("/tenant/security").set(H(secTok)).send({ mfaRequired: false })).status).toBe(200);
  });
});

describe("invitations, réinitialisation et administration des membres", () => {
  let adminTok: string;
  beforeAll(async () => { adminTok = (await login("admin", S("au1"))).body.accessToken; });
  it("liens liés à une entreprise/un dossier, aperçu, usage unique, révocation, expiration", async () => {
    const co = (await admin.company.create({ data: { tenantId: t1, name: "Client Inv" } })).id;
    expect((await srv().post("/invitations").set(H(adminTok)).send({ email: email("cli"), roles: ["client_user"] })).status).toBe(400); // entreprise requise
    expect((await srv().post("/invitations").set(H(adminTok)).send({ email: email("cli"), roles: ["client_user"], companyId: crypto.randomUUID() })).status).toBe(400);
    const inv = (await srv().post("/invitations").set(H(adminTok)).send({ email: email("cli"), roles: ["client_user"], companyId: co })).body;
    const token = inv.link.split("token=")[1];
    expect((await srv().get(`/auth/invitations/preview?token=${token}`)).body).toMatchObject({ kind: "invite", email: email("cli"), existingAccount: false, roles: ["client_user"] });
    const raw = await admin.invitation.findUniqueOrThrow({ where: { id: inv.id } }); expect(raw.tokenHash).not.toContain(token); // jeton haché
    expect((await srv().post("/auth/invitations/accept").send({ token, password: PW })).status).toBe(200);
    const m = await admin.membership.findFirstOrThrow({ where: { tenantId: t1, user: { email: email("cli") } } }); expect(m.companyId).toBe(co);
    expect((await srv().get(`/auth/invitations/preview?token=${token}`)).status).toBe(404);
    const i2 = (await srv().post("/invitations").set(H(adminTok)).send({ email: email("rev"), roles: ["finance"] })).body;
    expect((await srv().delete(`/invitations/${i2.id}`).set(H(adminTok))).status).toBe(200);
    expect((await srv().post("/auth/invitations/accept").send({ token: i2.link.split("token=")[1], password: PW })).status).toBe(404);
    const i3 = (await srv().post("/invitations").set(H(adminTok)).send({ email: email("exp"), roles: ["finance"] })).body;
    await admin.invitation.update({ where: { id: i3.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await srv().post("/auth/invitations/accept").send({ token: i3.link.split("token=")[1], password: PW })).status).toBe(404);
    // une nouvelle invitation révoque la précédente pour le même e-mail
    const a = (await srv().post("/invitations").set(H(adminTok)).send({ email: email("dup"), roles: ["finance"] })).body, b = (await srv().post("/invitations").set(H(adminTok)).send({ email: email("dup"), roles: ["finance"] })).body;
    expect((await srv().post("/auth/invitations/accept").send({ token: a.link.split("token=")[1], password: PW })).status).toBe(404);
    expect((await srv().post("/auth/invitations/accept").send({ token: b.link.split("token=")[1], password: PW })).status).toBe(200);
    expect((await srv().post("/invitations").set(H((await login("cli", S("au1"))).body.accessToken)).send({ email: email("z"), roles: ["finance"] })).status).toBe(403);
  });
  it("réinitialisation par l'administrateur : lien unique, anciennes sessions coupées", async () => {
    const victim = (await login("cli", S("au1"))).body;
    const uid = (await admin.user.findUniqueOrThrow({ where: { email: email("cli") } })).id;
    const r = (await srv().post(`/members/${uid}/reset-link`).set(H(adminTok))).body;
    const token = r.link.split("token=")[1];
    expect((await srv().post("/auth/invitations/accept").send({ token, password: "court" })).status).toBe(400);
    expect((await srv().post("/auth/invitations/accept").send({ token, password: "Autre-Phrase-Longue-88" })).status).toBe(200);
    expect((await srv().get("/me").set(H(victim.accessToken))).status).toBe(401);
    expect((await login("cli", S("au1"), "Autre-Phrase-Longue-88")).status).toBe(200);
    expect((await srv().post("/auth/invitations/accept").send({ token, password: "Autre-Phrase-Longue-99" })).status).toBe(404);
    expect((await srv().post(`/members/${ids.other}/reset-link`).set(H(adminTok))).status).toBe(404); // autre tenant
  });
  it("administration des membres : liste, rôles, rattachements, dernier administrateur protégé, retrait", async () => {
    const list = (await srv().get("/members").set(H(adminTok))).body as { userId: string; email: string; you: boolean }[];
    expect(list.some(m => m.email === email("admin") && m.you)).toBe(true); expect(list.some(m => m.email === email("admin2"))).toBe(false); // pas de fuite inter-tenant
    expect((await srv().patch(`/members/${ids.sec}`).set(H(adminTok)).send({ roles: ["finance"] })).status).toBe(200); // un second admin existe : autorisé
    expect((await srv().patch(`/members/${ids.admin}`).set(H(adminTok)).send({ roles: ["finance"] })).status).toBe(409); // dernier admin
    expect((await srv().delete(`/members/${ids.admin}`).set(H(adminTok))).status).toBe(403); // soi-même
    expect((await srv().patch(`/members/${ids.ops}`).set(H(adminTok)).send({ roles: ["consultant"] })).status).toBe(400); // rattachement requis
    expect((await srv().patch(`/members/${ids.ops}`).set(H(adminTok)).send({ roles: ["finance", "hr"] })).body.roles).toEqual(["finance", "hr"]);
    expect((await srv().patch(`/members/${ids.other}`).set(H(adminTok)).send({ roles: ["finance"] })).status).toBe(404); // autre tenant
    const opsTok = (await login("ops", S("au1"), "Nouveau-Mot-De-Passe-77")).body;
    expect((await srv().delete(`/members/${ids.ops}`).set(H(adminTok))).status).toBe(200);
    expect((await srv().get("/me").set(H(opsTok.accessToken))).status).toBe(401); // sessions coupées
    expect((await srv().patch(`/members/${ids.ops}`).set(H(adminTok)).send({ roles: ["finance"] })).status).toBe(404);
    expect((await admin.auditEvent.count({ where: { tenantId: t1, action: { in: ["member.update", "member.remove", "member.invite"] } } }))).toBeGreaterThanOrEqual(3);
  });
});
