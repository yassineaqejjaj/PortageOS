import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { createApp } from "../src/main";
import { routeLabel } from "../src/observability";

let app: INestApplication; const srv = () => request(app.getHttpServer());
beforeAll(async () => { app = await createApp(); await app.init(); });
afterAll(async () => { delete process.env.METRICS_TOKEN; await app.close(); });

describe("observabilité", () => {
  it("les identifiants ne sont jamais dans les libellés de route", () => {
    expect(routeLabel("/invoices/3f2c1a9e-1111-4222-8333-444455556666/issue")).toBe("/invoices/:id/issue");
    expect(routeLabel("/accounting/periods/2026-11/close")).toBe("/accounting/periods/:period/close");
  });
  it("identifiant de requête : repris s'il est sain, régénéré sinon", async () => {
    expect((await srv().get("/health").set("x-request-id", "abcdef12-test")).headers["x-request-id"]).toBe("abcdef12-test");
    const r = await srv().get("/health").set("x-request-id", "<script>x"); expect(r.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("disponibilité : la base est réellement interrogée, sans détail interne", async () => {
    const r = await srv().get("/health/ready"); expect(r.status).toBe(200); expect(r.body).toMatchObject({ status: "ready", checks: { database: "ok" } }); expect(JSON.stringify(r.body)).not.toMatch(/postgres|password|railway\.internal/i);
  });
  it("métriques : introuvables sans jeton configuré, protégées par jeton sinon", async () => {
    delete process.env.METRICS_TOKEN; expect((await srv().get("/metrics")).status).toBe(404);
    process.env.METRICS_TOKEN = "metrics-token-for-tests-0123456789";
    expect((await srv().get("/metrics")).status).toBe(401); expect((await srv().get("/metrics").set("authorization", "Bearer faux")).status).toBe(401);
    await srv().get("/health");
    const m = await srv().get("/metrics").set("authorization", `Bearer ${process.env.METRICS_TOKEN}`); expect(m.status).toBe(200);
    expect(m.text).toContain("portage_http_requests_total"); expect(m.text).toContain("portage_uptime_seconds"); expect(m.text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});
