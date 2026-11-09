import "reflect-metadata";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { INestApplication } from "@nestjs/common";
import { createApp } from "../src/main";
import { hashPassword } from "../src/password";
import { resetLoginThrottle } from "../src/auth.controller";
import { objectStore, testMemoryStore } from "../src/object-store";

const admin = new PrismaClient();
let app: INestApplication; const PW = "correct-horse-battery"; const run = Date.now().toString(36) + "s";
const pdf = (tag: string) => Buffer.from(`%PDF-1.4\n1 0 obj<<>>endobj\n% ${tag}\ntrailer<<>>\n%%EOF\n`);
let t1: string, consId: string; let tok: string; let uidHr: string;
const srv = () => request(app.getHttpServer()); const H = () => ({ Authorization: `Bearer ${tok}` });
const up = (buf: Buffer) => srv().post("/documents").set(H()).field("ownerType", "consultant").field("ownerId", consId).field("category", "other").attach("file", buf, { filename: "f.pdf", contentType: "application/pdf" });

beforeAll(async () => {
  process.env.STORAGE_DRIVER = "memory";
  t1 = (await admin.tenant.create({ data: { slug: `st-${run}`, name: "Stockage" } })).id;
  consId = (await admin.consultant.create({ data: { tenantId: t1, firstName: "S", lastName: "T", status: "active" } })).id;
  const u = await admin.user.create({ data: { email: `hr-${run}@x.test`, passwordHash: await hashPassword(PW) } }); uidHr = u.id;
  await admin.membership.create({ data: { userId: u.id, tenantId: t1, roles: ["hr"] } });
  app = await createApp(); await app.init();
  tok = (await srv().post("/auth/login").send({ email: `hr-${run}@x.test`, password: PW, tenantSlug: `st-${run}` })).body.accessToken;
});
beforeEach(() => resetLoginThrottle());
afterAll(async () => { delete process.env.STORAGE_DRIVER; await app.close(); await admin.$disconnect(); });

describe("stockage objet", () => {
  it("configuration : refus des valeurs incohérentes et du pilote mémoire en production", () => {
    expect(objectStore({ STORAGE_DRIVER: "db" } as never)).toBeNull(); expect(objectStore({} as never)).toBeNull();
    expect(() => objectStore({ STORAGE_DRIVER: "s3" } as never)).toThrow(/S3_BUCKET/); expect(() => objectStore({ STORAGE_DRIVER: "ftp" } as never)).toThrow(/inconnu/);
    expect(() => objectStore({ STORAGE_DRIVER: "memory", NODE_ENV: "production" } as never)).toThrow(/interdit en production/);
  });
  it("le contenu va dans l'objet (pas en base), l'empreinte est vérifiée au téléchargement, la purge supprime l'objet", async () => {
    const buf = pdf(`objet-${run}`); const r = await up(buf); expect(r.status).toBe(201);
    const doc = await admin.document.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(doc.storageDriver).toBe("s3"); expect(doc.storageKey).toBe(`${t1}/${doc.id}`);
    expect(await admin.documentBlob.count({ where: { documentId: doc.id } })).toBe(0);
    const store = testMemoryStore(); expect(store.objects.get(doc.storageKey!)?.equals(buf)).toBe(true);
    const dl = await srv().get(`/documents/${doc.id}/download`).set(H()); expect(dl.status).toBe(200); expect(createHash("sha256").update(dl.body).digest("hex")).toBe(doc.sha256);
    store.objects.set(doc.storageKey!, pdf("altéré")); // altération de l'objet : l'empreinte ne correspond plus
    expect((await srv().get(`/documents/${doc.id}/download`).set(H())).status).toBe(503);
    store.objects.set(doc.storageKey!, buf);
    expect((await srv().get(`/documents/${doc.id}/download`).set(H())).status).toBe(200);
    expect((await srv().delete(`/documents/${doc.id}`).set(H()).send({ reason: "Test de purge" })).status).toBe(200);
    expect((await srv().post(`/documents/${doc.id}/purge`).set(H()).send({ reason: "Test de purge objet" })).status).toBe(201);
    expect(store.objects.has(doc.storageKey!)).toBe(false);
  });
  it("un document antérieur (stockage en base) reste lisible quand le stockage objet est activé", async () => {
    const buf = pdf(`ancien-${run}`);
    const d = await admin.document.create({ data: { tenantId: t1, ownerType: "consultant", ownerId: consId, category: "other", name: "ancien.pdf", mime: "application/pdf", size: buf.length, sha256: createHash("sha256").update(buf).digest("hex"), scanStatus: "clean", uploadedBy: uidHr } });
    await admin.documentBlob.create({ data: { documentId: d.id, tenantId: t1, data: new Uint8Array(buf) } });
    const dl = await srv().get(`/documents/${d.id}/download`).set(H()); expect(dl.status).toBe(200); expect(Buffer.from(dl.body).equals(buf)).toBe(true);
  });
});
