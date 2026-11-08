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
const H = (t: string) => ({ Authorization: `Bearer ${t}` });

async function mk(email: string, tenantId: string, roles: string[]) {
  const u = await admin.user.create({ data: { email, passwordHash: await hashPassword(PW) } });
  await admin.membership.create({ data: { userId: u.id, tenantId, roles } });
}
async function tok(email: string, slug: string) {
  const r = await request(app.getHttpServer()).post("/auth/login").send({ email, password: PW, tenantSlug: slug });
  return r.body.accessToken as string;
}
beforeAll(async () => {
  t1 = (await admin.tenant.create({ data: { slug: `p1-${run}`, name: "P1" } })).id;
  t2 = (await admin.tenant.create({ data: { slug: `p2-${run}`, name: "P2" } })).id;
  await mk(`com-${run}@a.test`, t1, ["commerce"]);
  await mk(`ops-${run}@a.test`, t1, ["operations"]);
  await mk(`dir-${run}@a.test`, t1, ["direction"]);
  await mk(`com2-${run}@b.test`, t2, ["commerce"]);
  app = await createApp(); await app.init();
});
beforeEach(() => resetLoginThrottle());
afterAll(async () => { await app.close(); await admin.$disconnect(); });

describe("CRM prospects", () => {
  it("parcours nominal avec audit, étapes imposées par la machine d'état", async () => {
    const t = await tok(`com-${run}@a.test`, `p1-${run}`);
    const c = await request(app.getHttpServer()).post("/prospects").set(H(t)).send({ kind: "consultant", name: "Camille Test", email: "camille@example.test" });
    expect(c.status).toBe(201); expect(c.body.stage).toBe("new");
    const id = c.body.id;
    // saut d'étape interdit
    expect((await request(app.getHttpServer()).post(`/prospects/${id}/transition`).set(H(t)).send({ event: "convert" })).status).toBe(400);
    for (const [ev, stage] of [["contact", "contacted"], ["qualify", "qualified"], ["convert", "converted"]] as const) {
      const r = await request(app.getHttpServer()).post(`/prospects/${id}/transition`).set(H(t)).send({ event: ev });
      expect(r.status).toBe(201); expect(r.body.stage).toBe(stage);
    }
    expect((await request(app.getHttpServer()).post(`/prospects/${id}/transition`).set(H(t)).send({ event: "reopen" })).status).toBe(400);
    const ev = await admin.auditEvent.findMany({ where: { entityId: id }, orderBy: { at: "asc" } });
    expect(ev.map(e => e.action)).toEqual(["prospect.create", "prospect.contact", "prospect.qualify", "prospect.convert"]);
  });
  it("préconditions: contact requis, motif de perte obligatoire", async () => {
    const t = await tok(`com-${run}@a.test`, `p1-${run}`);
    const p = (await request(app.getHttpServer()).post("/prospects").set(H(t)).send({ kind: "company", name: "Sans contact" })).body.id;
    expect((await request(app.getHttpServer()).post(`/prospects/${p}/transition`).set(H(t)).send({ event: "contact" })).status).toBe(400);
    expect((await request(app.getHttpServer()).post(`/prospects/${p}/transition`).set(H(t)).send({ event: "lose" })).status).toBe(400);
    const l = await request(app.getHttpServer()).post(`/prospects/${p}/transition`).set(H(t)).send({ event: "lose", lostReason: "Budget gelé" });
    expect(l.body.stage).toBe("lost"); expect(l.body.lostReason).toBe("Budget gelé");
  });
  it("concurrence: deux transitions simultanées, une seule gagne", async () => {
    const t = await tok(`com-${run}@a.test`, `p1-${run}`);
    const p = (await request(app.getHttpServer()).post("/prospects").set(H(t)).send({ kind: "company", name: "Race", email: "r@example.test" })).body.id;
    const res = await Promise.all([1, 2].map(() => request(app.getHttpServer()).post(`/prospects/${p}/transition`).set(H(t)).send({ event: "contact" })));
    const codes = res.map(r => r.status);
    expect(codes.filter(c => c === 201)).toHaveLength(1);
    expect(codes.filter(c => c === 400 || c === 409)).toHaveLength(1);
  });
  it("droits: operations en lecture seule refusé en écriture; direction lit", async () => {
    const o = await tok(`ops-${run}@a.test`, `p1-${run}`);
    expect((await request(app.getHttpServer()).get("/prospects").set(H(o))).status).toBe(403);
    const d = await tok(`dir-${run}@a.test`, `p1-${run}`);
    expect((await request(app.getHttpServer()).get("/prospects").set(H(d))).status).toBe(200);
    expect((await request(app.getHttpServer()).post("/prospects").set(H(d)).send({ kind: "company", name: "x" })).status).toBe(403);
  });
  it("isolation: un autre tenant ne voit ni ne modifie le prospect (404)", async () => {
    const t1t = await tok(`com-${run}@a.test`, `p1-${run}`);
    const t2t = await tok(`com2-${run}@b.test`, `p2-${run}`);
    const p = (await request(app.getHttpServer()).post("/prospects").set(H(t1t)).send({ kind: "company", name: "Secret", email: "s@example.test" })).body.id;
    expect((await request(app.getHttpServer()).get("/prospects").set(H(t2t))).body).toEqual([]);
    expect((await request(app.getHttpServer()).patch(`/prospects/${p}`).set(H(t2t)).send({ name: "pwn" })).status).toBe(404);
    expect((await request(app.getHttpServer()).post(`/prospects/${p}/transition`).set(H(t2t)).send({ event: "contact" })).status).toBe(404);
  });
  it("validation: kind/étape inconnus, email invalide", async () => {
    const t = await tok(`com-${run}@a.test`, `p1-${run}`);
    expect((await request(app.getHttpServer()).post("/prospects").set(H(t)).send({ kind: "alien", name: "x" })).status).toBe(400);
    expect((await request(app.getHttpServer()).post("/prospects").set(H(t)).send({ kind: "company", name: "x", email: "pas-un-email" })).status).toBe(400);
    expect((await request(app.getHttpServer()).get("/prospects?stage=inconnu").set(H(t))).status).toBe(400);
  });
});
