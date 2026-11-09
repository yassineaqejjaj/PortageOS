import "reflect-metadata";
import net from "node:net";
import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { INestApplication } from "@nestjs/common";
import { createApp } from "../src/main";
import { hashPassword } from "../src/password";
import { resetLoginThrottle } from "../src/auth.controller";
import { detectMime, safeName } from "../src/file-type";

const admin = new PrismaClient();
let app: INestApplication;
const PW = "correct-horse-battery";
const run = Date.now().toString(36) + "d";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const pdf = (tag: string) => Buffer.from(`%PDF-1.4\n1 0 obj<<>>endobj\n% ${tag}\ntrailer<<>>\n%%EOF\n`);
let t1: string, t2: string, consA: string, consB: string, claimId: string, claim2Id: string, contractId: string;
const tok: Record<string, string> = {}; const uid: Record<string, string> = {};
const S = (n: string) => `${n}-${run}`;
const srv = () => request(app.getHttpServer()); const H = (k: string) => ({ Authorization: `Bearer ${tok[k]}` });

async function mk(key: string, tenantId: string, roles: string[], extra: { companyId?: string; consultantId?: string } = {}) {
  const u = await admin.user.create({ data: { email: `${key.toLowerCase()}-${run}@x.test`, passwordHash: await hashPassword(PW) } });
  uid[key] = u.id; await admin.membership.create({ data: { userId: u.id, tenantId, roles, ...extra } });
}
async function login(key: string, slug: string) { tok[key] = (await srv().post("/auth/login").send({ email: `${key.toLowerCase()}-${run}@x.test`, password: PW, tenantSlug: slug })).body.accessToken; }
const up = (who: string, ownerType: string, ownerId: string, category: string, buf: Buffer, filename = "fichier.pdf", contentType = "application/pdf") =>
  srv().post("/documents").set(H(who)).field("ownerType", ownerType).field("ownerId", ownerId).field("category", category).attach("file", buf, { filename, contentType });
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

beforeAll(async () => {
  t1 = (await admin.tenant.create({ data: { slug: S("d1"), name: "Docs 1" } })).id; t2 = (await admin.tenant.create({ data: { slug: S("d2"), name: "Docs 2" } })).id;
  const co = (await admin.company.create({ data: { tenantId: t1, name: "Client D" } })).id;
  consA = (await admin.consultant.create({ data: { tenantId: t1, firstName: "Alice", lastName: "A", status: "active" } })).id;
  consB = (await admin.consultant.create({ data: { tenantId: t1, firstName: "Bruno", lastName: "B", status: "active" } })).id;
  await mk("admin", t1, ["tenant_admin"]); await mk("hr", t1, ["hr"]); await mk("ops", t1, ["operations"]); await mk("fin", t1, ["finance"]); await mk("compl", t1, ["compliance"]);
  await mk("cons", t1, ["consultant"], { consultantId: consA }); await mk("cons2", t1, ["consultant"], { consultantId: consB }); await mk("client", t1, ["client_user"], { companyId: co }); await mk("admin2", t2, ["tenant_admin"]);
  claimId = (await admin.expenseClaim.create({ data: { tenantId: t1, consultantId: consA, ownerUserId: uid.cons!, title: "Frais docs", status: "draft" } })).id;
  claim2Id = (await admin.expenseClaim.create({ data: { tenantId: t1, consultantId: consA, ownerUserId: uid.cons!, title: "Autre note", status: "draft" } })).id;
  const tpl = await admin.contractTemplate.create({ data: { tenantId: t1, kind: "service", name: "T", version: 1, body: "x", status: "published", createdBy: "u" } });
  contractId = (await admin.contract.create({ data: { tenantId: t1, templateId: tpl.id, kind: "service", companyId: co, renderedBody: "x", variableValues: {}, createdBy: "u" } })).id;
  app = await createApp(); await app.init();
  for (const k of ["admin", "hr", "ops", "fin", "compl", "cons", "cons2", "client"]) await login(k, S("d1")); await login("admin2", S("d2"));
});
beforeEach(() => resetLoginThrottle());
afterAll(async () => { await app.close(); await admin.$disconnect(); });

describe("signature binaire et noms de fichiers", () => {
  it("détection par le contenu et assainissement", () => {
    expect(detectMime(pdf("x"))).toBe("application/pdf"); expect(detectMime(PNG)).toBe("image/png"); expect(detectMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe("image/jpeg");
    expect(detectMime(Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 2, 3, 4]), Buffer.from("WEBP")]))).toBe("image/webp");
    expect(detectMime(Buffer.from("MZ\x90\x00"))).toBeNull(); expect(detectMime(Buffer.from("<html><script>"))).toBeNull(); expect(detectMime(Buffer.alloc(0))).toBeNull();
    expect(safeName("../../etc/passwd.pdf", "application/pdf")).toBe("passwd.pdf"); expect(safeName("évil<script>.png", "image/png")).toBe("evil_script_.png"); expect(safeName("..\\..\\x.exe", "image/png")).toBe("x.png"); expect(safeName("", "application/pdf")).toBe("document.pdf");
  });
});

describe("dépôt : validation", () => {
  it("fichier manquant, objet/catégorie invalides, faux types, taille", async () => {
    expect((await srv().post("/documents").set(H("hr")).field("ownerType", "consultant").field("ownerId", consA).field("category", "other")).status).toBe(400);
    expect((await up("hr", "alien", consA, "other", PNG)).status).toBe(400);
    expect((await up("hr", "consultant", consA, "receipt", PNG)).status).toBe(400); // catégorie d'un autre objet
    expect((await up("hr", "consultant", "pas-un-uuid", "other", PNG)).status).toBe(400);
    expect((await up("hr", "consultant", consA, "other", Buffer.from("juste du texte"), "note.pdf")).status).toBe(400); // extension PDF, contenu texte
    expect((await up("hr", "consultant", consA, "other", Buffer.from("MZ\x90\x00\x03\x00\x00\x00"), "image.png", "image/png")).status).toBe(400); // exécutable déguisé
    expect((await up("hr", "consultant", consA, "other", Buffer.from("<script>alert(1)</script>"), "x.png", "image/png")).status).toBe(400);
    const big = Buffer.concat([pdf("gros"), Buffer.alloc(10 * 1024 * 1024)]);
    expect((await up("hr", "consultant", consA, "other", big)).status).toBe(413);
  });
  it("le type réel l'emporte sur le type annoncé; le nom est assaini", async () => {
    const r = await up("hr", "consultant", consA, "other", PNG, "../../etc/<x>.pdf", "text/html");
    expect(r.status).toBe(201); expect(r.body).toMatchObject({ mime: "image/png", name: "_x_.png", scanStatus: expect.stringMatching(/clean|not_scanned/), size: PNG.length });
    const p = (await srv().get("/documents/policy").set(H("cons"))).body; expect(p.maxBytes).toBe(10485760); expect(p.categories.expense_claim).toEqual(["receipt"]);
  });
});

describe("contrôle d'accès par objet", () => {
  let idDoc: string, rcDoc: string;
  it("la personne concernée dépose; les autres consultants, clients et la finance sont refusés", async () => {
    const a = await up("cons", "consultant", consA, "identity_document", pdf("id-A"), "cni.pdf"); expect(a.status).toBe(201); idDoc = a.body.id; expect(a.body.sensitive).toBe(true);
    rcDoc = (await up("hr", "consultant", consA, "rc_pro", pdf("rc-A"), "rcpro.pdf")).body.id;
    expect((await up("cons2", "consultant", consA, "other", pdf("intrus"))).status).toBe(403);
    expect((await srv().get(`/documents?ownerType=consultant&ownerId=${consA}`).set(H("cons2"))).status).toBe(403);
    expect((await srv().get(`/documents/${idDoc}`).set(H("cons2"))).status).toBe(403);
    expect((await srv().get(`/documents/${idDoc}/download`).set(H("cons2"))).status).toBe(403);
    for (const who of ["client", "fin"]) { expect((await srv().get(`/documents/${rcDoc}`).set(H(who))).status).toBe(403); expect((await up(who, "consultant", consA, "other", pdf(`x-${who}`))).status).toBe(403); }
    expect((await srv().get(`/documents/${rcDoc}`).set(H("compl"))).status).toBe(200); // lecture non sensible
    expect((await srv().get(`/documents/${idDoc}`).set(H("compl"))).status).toBe(403);
  });
  it("documents sensibles : RH/administration et personne concernée seulement; liste filtrée par catégorie", async () => {
    expect((await srv().get(`/documents/${idDoc}`).set(H("ops"))).status).toBe(403); expect((await srv().get(`/documents/${idDoc}/download`).set(H("ops"))).status).toBe(403);
    expect((await up("ops", "consultant", consA, "bank_details", pdf("rib"))).status).toBe(403);
    expect((await up("ops", "consultant", consA, "rc_pro", pdf("rc-ops"))).status).toBe(201);
    const names = async (who: string) => (await srv().get(`/documents?ownerType=consultant&ownerId=${consA}`).set(H(who))).body.map((d: { category: string }) => d.category);
    expect(await names("hr")).toContain("identity_document"); expect(await names("ops")).not.toContain("identity_document"); expect(await names("ops")).toContain("rc_pro"); expect(await names("cons")).toContain("identity_document");
    expect((await srv().get(`/documents/${idDoc}/download`).set(H("hr"))).status).toBe(200); expect((await srv().get(`/documents/${idDoc}/download`).set(H("cons"))).status).toBe(200);
  });
  it("isolation inter-sociétés", async () => {
    expect((await srv().get(`/documents/${rcDoc}`).set(H("admin2"))).status).toBe(404); expect((await srv().get(`/documents/${rcDoc}/download`).set(H("admin2"))).status).toBe(404);
    expect((await srv().get(`/documents?ownerType=consultant&ownerId=${consA}`).set(H("admin2"))).status).toBe(404);
    expect((await up("admin2", "consultant", consA, "other", pdf("autre-tenant"))).status).toBe(404);
  });
});

describe("justificatifs de frais", () => {
  let rcpt: string;
  it("dépôt par le propriétaire de la note; lecture par le personnel autorisé; autres refusés", async () => {
    const r = await up("cons", "expense_claim", claimId, "receipt", PNG, "ticket.png", "image/png"); expect(r.status).toBe(201); rcpt = r.body.id;
    expect((await up("cons2", "expense_claim", claimId, "receipt", PNG, "t.png")).status).toBe(404); // note d'un autre consultant
    expect((await up("client", "expense_claim", claimId, "receipt", PNG, "t.png")).status).toBe(404);
    for (const who of ["ops", "fin", "cons", "admin"]) expect((await srv().get(`/documents/${rcpt}/download`).set(H(who))).status).toBe(200);
    for (const who of ["cons2", "client"]) expect((await srv().get(`/documents/${rcpt}/download`).set(H(who))).status).toBe(404);
    expect((await srv().get(`/documents/${rcpt}/download`).set(H("admin2"))).status).toBe(404);
  });
  it("référence « doc:<id> » validée dans la ligne de frais; ajout refusé après soumission; suppression par la RH", async () => {
    const line = (receiptRef: string, d = "2031-09-01") => ({ lines: [{ date: d, category: "hotel", description: "Hôtel", amount: "80", receiptRef }] });
    expect((await srv().put(`/me/expenses/${claimId}/lines`).set(H("cons")).send(line("doc:00000000-0000-0000-0000-000000000000"))).status).toBe(400);
    const other = (await up("cons", "expense_claim", claim2Id, "receipt", PNG, "autre.png")).body.id;
    expect((await srv().put(`/me/expenses/${claimId}/lines`).set(H("cons")).send(line(`doc:${other}`))).status).toBe(400); // justificatif d'une autre note
    expect((await srv().put(`/me/expenses/${claimId}/lines`).set(H("cons")).send(line(`doc:${rcpt}`))).status).toBe(200);
    expect((await srv().post(`/me/expenses/${claimId}/transition`).set(H("cons")).send({ event: "submit" })).body.status).toBe("submitted");
    expect((await up("cons", "expense_claim", claimId, "receipt", PNG, "tard.png")).status).toBe(409);
    expect((await srv().delete(`/documents/${rcpt}`).set(H("cons")).send({ reason: "Je veux le retirer" })).status).toBe(403); // pas de suppression par l'auteur
    expect((await srv().delete(`/documents/${rcpt}`).set(H("hr")).send({ reason: "x" })).status).toBe(400);
    expect((await srv().delete(`/documents/${rcpt}`).set(H("hr")).send({ reason: "Pièce erronée" })).status).toBe(200);
    expect((await srv().get(`/documents/${rcpt}/download`).set(H("ops"))).status).toBe(404);
  });
});

describe("téléchargement, journal d'accès, suppression et purge", () => {
  let doc: string; const content = pdf("contenu-exact");
  it("contenu identique, en-têtes défensifs, accès journalisé", async () => {
    doc = (await up("hr", "consultant", consA, "contract_copy", content, "contrat.pdf")).body.id;
    const r = await srv().get(`/documents/${doc}/download`).set(H("ops")).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on("data", d => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); });
    expect(r.status).toBe(200); expect(sha(r.body as Buffer)).toBe(sha(content));
    expect(r.headers["content-disposition"]).toBe('attachment; filename="contrat.pdf"'); expect(r.headers["x-content-type-options"]).toBe("nosniff"); expect(r.headers["content-security-policy"]).toMatch(/sandbox/); expect(r.headers["cache-control"]).toMatch(/no-store/); expect(r.headers["content-type"]).toMatch(/application\/pdf/);
    const ev = await admin.auditEvent.findFirstOrThrow({ where: { tenantId: t1, action: "document.download", entityId: doc } }); expect(ev.actorId).toBe(uid.ops);
  });
  it("suppression logique (droit dédié, motif), puis purge physique; métadonnées et audit conservés", async () => {
    expect((await srv().post(`/documents/${doc}/purge`).set(H("hr")).send({ reason: "Effacement demandé" })).status).toBe(409); // pas encore supprimé
    expect((await srv().delete(`/documents/${doc}`).set(H("ops")).send({ reason: "Pas le droit" })).status).toBe(403);
    expect((await srv().delete(`/documents/${doc}`).set(H("hr")).send({ reason: "Document remplacé" })).status).toBe(200);
    expect((await srv().delete(`/documents/${doc}`).set(H("hr")).send({ reason: "Encore une fois" })).status).toBe(409);
    expect((await srv().get(`/documents?ownerType=consultant&ownerId=${consA}`).set(H("hr"))).body.some((d: { id: string }) => d.id === doc)).toBe(false);
    expect((await srv().post(`/documents/${doc}/purge`).set(H("ops")).send({ reason: "Effacement demandé" })).status).toBe(403);
    expect((await srv().post(`/documents/${doc}/purge`).set(H("hr")).send({ reason: "Effacement demandé" })).status).toBe(201);
    expect(await admin.documentBlob.count({ where: { documentId: doc } })).toBe(0);
    const meta = await admin.document.findUniqueOrThrow({ where: { id: doc } }); expect(meta.purgedAt).toBeTruthy(); expect(meta.sha256).toBe(sha(content));
    expect((await srv().post(`/documents/${doc}/purge`).set(H("hr")).send({ reason: "Encore une fois" })).status).toBe(409);
    expect(await admin.auditEvent.count({ where: { tenantId: t1, entityId: doc, action: { in: ["document.upload", "document.delete", "document.purge"] } } })).toBe(3);
  });
});

describe("liens temporaires signés", () => {
  let doc: string;
  const bytes = pdf("partage");
  it("lien valide sans authentification, journalisé; durée bornée; sensibles et rôles non habilités refusés", async () => {
    doc = (await up("hr", "consultant", consA, "other", bytes, "partage.pdf")).body.id;
    const l = await srv().post(`/documents/${doc}/link`).set(H("hr")).send({ minutes: 5 }); expect(l.status).toBe(201); expect(l.body.path).toMatch(/^\/documents\/shared\/ey/);
    const r = await srv().get(l.body.path).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on("data", d => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); });
    expect(r.status).toBe(200); expect(sha(r.body as Buffer)).toBe(sha(bytes)); expect(r.headers["content-disposition"]).toMatch(/^attachment/);
    expect(await admin.auditEvent.count({ where: { tenantId: t1, action: "document.shared_access", entityId: doc } })).toBe(1);
    expect((await srv().post(`/documents/${doc}/link`).set(H("hr")).send({ minutes: 16 })).status).toBe(400);
    expect((await srv().post(`/documents/${doc}/link`).set(H("hr")).send({ minutes: 0 })).status).toBe(400);
    expect((await srv().post(`/documents/${doc}/link`).set(H("ops")).send({ minutes: 5 })).status).toBe(403); // pas de droit de partage
    expect((await srv().post(`/documents/${doc}/link`).set(H("fin")).send({ minutes: 5 })).status).toBe(403); // droit de partage mais pas de lecture de ce dossier
    const sens = (await up("hr", "consultant", consA, "bank_details", pdf("rib2"))).body.id;
    expect((await srv().post(`/documents/${sens}/link`).set(H("hr")).send({ minutes: 5 })).status).toBe(403);
  });
  it("lien falsifié, expiré, d'un autre usage; document supprimé après création", async () => {
    const secret = process.env.JWT_SECRET!; const good = (await srv().post(`/documents/${doc}/link`).set(H("hr")).send({ minutes: 5 })).body.path as string;
    expect((await srv().get(good.slice(0, -3) + "abc")).status).toBe(401);
    const expired = jwt.sign({ purpose: "doc-share", sub: doc, tid: t1, by: uid.hr, exp: Math.floor(Date.now() / 1000) - 10 }, secret, { algorithm: "HS256" });
    expect((await srv().get(`/documents/shared/${expired}`)).status).toBe(401);
    const wrong = jwt.sign({ sub: doc, tid: t1, exp: Math.floor(Date.now() / 1000) + 300 }, secret, { algorithm: "HS256" });
    expect((await srv().get(`/documents/shared/${wrong}`)).status).toBe(401);
    const forged = jwt.sign({ purpose: "doc-share", sub: doc, tid: t1, exp: Math.floor(Date.now() / 1000) + 300 }, "autre-secret-autre-secret-autre-secret-xx", { algorithm: "HS256" });
    expect((await srv().get(`/documents/shared/${forged}`)).status).toBe(401);
    const crossTenant = jwt.sign({ purpose: "doc-share", sub: doc, tid: t2, by: uid.admin2, exp: Math.floor(Date.now() / 1000) + 300 }, secret, { algorithm: "HS256" });
    expect((await srv().get(`/documents/shared/${crossTenant}`)).status).toBe(410); // l'identifiant d'un autre tenant n'ouvre rien
    expect((await srv().get(good)).status).toBe(200);
    await srv().delete(`/documents/${doc}`).set(H("hr")).send({ reason: "Retrait après partage" });
    expect((await srv().get(good)).status).toBe(410);
  });
});

describe("garanties en base", () => {
  it("métadonnées et contenu immuables, contraintes de taille/type, suppression physique interdite", async () => {
    const d = await admin.document.findFirstOrThrow({ where: { tenantId: t1, deletedAt: null } });
    await expect(admin.document.update({ where: { id: d.id }, data: { name: "falsifié.pdf" } })).rejects.toThrow(/immuables/);
    await expect(admin.document.update({ where: { id: d.id }, data: { sha256: "0".repeat(64) } })).rejects.toThrow(/immuables/);
    await expect(admin.document.delete({ where: { id: d.id } })).rejects.toThrow(/append-only/);
    await expect(admin.documentBlob.update({ where: { documentId: d.id }, data: { data: new Uint8Array([1, 2, 3]) } })).rejects.toThrow(/immuable/);
    const base = { tenantId: t1, ownerType: "general", ownerId: "x", category: "other", name: "x.pdf", mime: "application/pdf", sha256: "a".repeat(64), scanStatus: "not_scanned", uploadedBy: "u" };
    await expect(admin.document.create({ data: { ...base, size: 0 } })).rejects.toThrow();
    await expect(admin.document.create({ data: { ...base, size: 10_485_761 } })).rejects.toThrow();
    await expect(admin.document.create({ data: { ...base, size: 10, mime: "text/html" } })).rejects.toThrow();
    await expect(admin.document.create({ data: { ...base, size: 10, scanStatus: "unknown" } })).rejects.toThrow();
  });
});

describe("antivirus ClamAV (démon simulé : teste notre client du protocole INSTREAM, pas le moteur)", () => {
  let server: net.Server; let port = 0;
  const startFake = () => new Promise<void>(resolve => {
    server = net.createServer(sock => {
      let buf = Buffer.alloc(0);
      sock.on("data", d => {
        buf = Buffer.concat([buf, d]); let off = 10, body = Buffer.alloc(0); // "zINSTREAM\0"
        if (buf.length < off) return;
        for (;;) { if (buf.length < off + 4) return; const len = buf.readUInt32BE(off); off += 4; if (len === 0) break; if (buf.length < off + len) return; body = Buffer.concat([body, buf.subarray(off, off + len)]); off += len; }
        sock.end(body.includes("EICAR") ? "stream: Eicar-Test-Signature FOUND\0" : "stream: OK\0");
      });
    }).listen(0, "127.0.0.1", () => { port = (server.address() as net.AddressInfo).port; resolve(); });
  });
  it("fichier sain : marqué analysé; fichier infecté : refusé, rien n'est stocké, événement d'audit; démon indisponible : envoi refusé", async () => {
    await startFake(); process.env.CLAMAV_HOST = "127.0.0.1"; process.env.CLAMAV_PORT = String(port);
    expect((await srv().get("/documents/policy").set(H("hr"))).body.scanner).toBe("clamav");
    const ok = await up("hr", "consultant", consA, "other", pdf("sain")); expect(ok.status).toBe(201); expect(ok.body.scanStatus).toBe("clean");
    expect((await admin.document.findUniqueOrThrow({ where: { id: ok.body.id } })).scanEngine).toBe("clamav");
    const before = await admin.document.count({ where: { tenantId: t1 } });
    const bad = await up("hr", "consultant", consA, "other", Buffer.from("%PDF-1.4\nX5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*\n%%EOF"));
    expect(bad.status).toBe(422); expect(bad.body.error.message).toMatch(/Eicar-Test-Signature/);
    expect(await admin.document.count({ where: { tenantId: t1 } })).toBe(before);
    expect(await admin.auditEvent.count({ where: { tenantId: t1, action: "document.infected_rejected" } })).toBe(1);
    await new Promise<void>(r => server.close(() => r()));
    expect((await up("hr", "consultant", consA, "other", pdf("démon-éteint"))).status).toBe(503); // fail-closed
    expect(await admin.document.count({ where: { tenantId: t1 } })).toBe(before);
    delete process.env.CLAMAV_HOST; delete process.env.CLAMAV_PORT;
    const un = await up("hr", "consultant", consA, "other", pdf("non-analysé")); expect(un.status).toBe(201); expect(un.body.scanStatus).toBe("not_scanned");
    expect((await srv().get("/documents/policy").set(H("hr"))).body.scanner).toBe("not_connected");
  });
});
