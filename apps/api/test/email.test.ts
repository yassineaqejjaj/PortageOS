import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { INestApplication } from "@nestjs/common";
import { createApp } from "../src/main";
import { hashPassword } from "../src/password";
import { resetLoginThrottle } from "../src/auth.controller";
import { MailService } from "../src/mail.service";
import { sha256 } from "../src/secretbox";

const admin = new PrismaClient();
let app: INestApplication; let mail: MailService;
const PW = "correct-horse-battery", NEW = "another-long-passphrase-42";
const run = Date.now().toString(36) + "e"; const slug = `em-${run}`;
const srv = () => request(app.getHttpServer());
let tenantId: string; let adminTok: string;

beforeAll(async () => {
  tenantId = (await admin.tenant.create({ data: { slug, name: "Société e-mail" } })).id;
  for (const [k, roles] of [["boss", ["tenant_admin"]], ["staff", ["operations"]]] as const) {
    const u = await admin.user.create({ data: { email: `${k}-${run}@x.test`, passwordHash: await hashPassword(PW) } });
    await admin.membership.create({ data: { userId: u.id, tenantId, roles: [...roles] } });
  }
  app = await createApp(); await app.init(); mail = app.get(MailService);
  adminTok = (await srv().post("/auth/login").send({ email: `boss-${run}@x.test`, password: PW, tenantSlug: slug })).body.accessToken;
});
beforeEach(() => resetLoginThrottle());
afterAll(async () => { await app.close(); await admin.$disconnect(); });

describe("e-mail et mot de passe oublié", () => {
  it("réponse identique que le compte existe ou non, journal sans contenu, lien à usage unique, anciennes sessions révoquées", async () => {
    const sent: { to: string; link: string; template: string }[] = [];
    const spy = vi.spyOn(mail, "send").mockImplementation(async d => { sent.push({ to: d.to, link: d.link, template: d.template }); return "sent"; });
    const forgot = (email: string, tenantSlug = slug) => srv().post("/auth/password/forgot").send({ email, tenantSlug });
    const a = await forgot(`staff-${run}@x.test`); const b = await forgot(`inconnu-${run}@x.test`); const c = await forgot(`staff-${run}@x.test`, "autre-societe");
    expect([a.status, b.status, c.status]).toEqual([202, 202, 202]); expect(b.body).toEqual(a.body); expect(c.body).toEqual(a.body);
    expect(JSON.stringify(a.body)).not.toMatch(/token|invite/);
    await new Promise(r => setTimeout(r, 50));
    expect(sent).toHaveLength(1); expect(sent[0]).toMatchObject({ to: `staff-${run}@x.test`, template: "password_reset" });
    const inv = await admin.invitation.findFirstOrThrow({ where: { tenantId, email: `staff-${run}@x.test`, kind: "reset", acceptedAt: null } });
    expect(inv.expiresAt.getTime() - Date.now()).toBeLessThan(3600_000 + 5000); // 1 h
    const token = new URL(sent[0]!.link, "http://x").searchParams.get("token")!; expect(inv.tokenHash).toBe(sha256(token));
    expect((await srv().post("/auth/login").send({ email: `staff-${run}@x.test`, password: PW, tenantSlug: slug })).status).toBe(200);
    const weak = await srv().post("/auth/invitations/accept").send({ token, password: "court" }); expect(weak.status).toBe(400);
    expect((await srv().post("/auth/invitations/accept").send({ token, password: NEW })).status).toBe(200);
    expect((await srv().post("/auth/invitations/accept").send({ token, password: NEW })).status).toBe(404); // usage unique
    expect((await srv().post("/auth/login").send({ email: `staff-${run}@x.test`, password: PW, tenantSlug: slug })).status).toBe(401);
    expect((await srv().post("/auth/login").send({ email: `staff-${run}@x.test`, password: NEW, tenantSlug: slug })).status).toBe(200);
    expect(await admin.auditEvent.count({ where: { tenantId, action: "auth.password_forgot" } })).toBe(1);
    spy.mockRestore();
  });
  it("limite par adresse; sans fournisseur configuré le journal dit « not_connected » et ne conserve ni adresse ni lien; invitation avec statut d'envoi", async () => {
    const e = `limite-${run}@x.test`;
    const codes: number[] = []; for (let i = 0; i < 5; i++) codes.push((await srv().post("/auth/password/forgot").send({ email: e, tenantSlug: slug })).status);
    expect(codes).toEqual([202, 202, 202, 429, 429]);
    expect(mail.connected).toBe(false);
    const r = await srv().post("/invitations").set({ Authorization: `Bearer ${adminTok}` }).send({ email: `nouveau-${run}@x.test`, roles: ["operations"] });
    expect(r.status).toBe(201); expect(r.body.emailStatus).toBe("not_connected"); expect(r.body.link).toMatch(/^\/invite\?token=/); expect(r.body.note).toMatch(/Aucun e-mail envoyé/);
    const rows = await admin.emailOutbox.findMany({ where: { tenantId, template: "invitation" } });
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ status: "not_connected", toHash: sha256(`nouveau-${run}@x.test`) });
    expect(JSON.stringify(rows)).not.toContain(`nouveau-${run}`); expect(JSON.stringify(rows)).not.toContain("token");
    await expect(admin.emailOutbox.update({ where: { id: rows[0]!.id }, data: { status: "sent" } })).rejects.toThrow(/append-only/);
  });
});
