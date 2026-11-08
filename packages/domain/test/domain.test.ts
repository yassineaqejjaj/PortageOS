import { describe, it, expect } from "vitest";
import { Money, invoiceTotals, ParameterCatalog, StateMachine, Ledger, InvoiceNumbering } from "../src/index";

describe("Money", () => {
  it("évite les erreurs flottantes", () => {
    expect(Money.of("0.1").add(Money.of("0.2")).eq(Money.of("0.3"))).toBe(true);
  });
  it("refuse de mélanger les devises", () => {
    expect(() => Money.of(1, "EUR").add(Money.of(1, "USD"))).toThrow();
  });
  it("TVA arrondie par ligne", () => {
    const t = invoiceTotals([{ net: Money.of("10.05"), rate: "20" }, { net: Money.of("10.05"), rate: "20" }]);
    expect(t.vat.toString()).toBe("4.02 EUR"); // 2.01 x 2
    expect(t.gross.toString()).toBe("24.12 EUR");
  });
});

describe("ParameterCatalog", () => {
  const mk = () => new ParameterCatalog();
  it("choisit la version en vigueur à la date", () => {
    const c = mk();
    c.add({ key: "x", value: "1", validFrom: "2025-01-01", validTo: "2025-12-31", source: "src", status: "approved", approvedBy: "u" });
    c.add({ key: "x", value: "2", validFrom: "2026-01-01", source: "src", status: "approved", approvedBy: "u" });
    expect(c.at("x", "2025-06-01").value).toBe("1");
    expect(c.at("x", "2026-06-01").value).toBe("2");
  });
  it("jamais de repli silencieux ni de brouillon", () => {
    const c = mk();
    c.add({ key: "y", value: "1", validFrom: "2025-01-01", source: "src", status: "draft" });
    expect(() => c.at("y", "2025-06-01")).toThrow();
    expect(() => c.at("zzz", "2025-06-01")).toThrow();
  });
  it("refuse chevauchement et approbation sans approbateur", () => {
    const c = mk();
    c.add({ key: "x", value: "1", validFrom: "2025-01-01", source: "s", status: "approved", approvedBy: "u" });
    expect(() => c.add({ key: "x", value: "2", validFrom: "2025-06-01", source: "s", status: "approved", approvedBy: "u" })).toThrow();
    expect(() => c.add({ key: "k", value: "1", validFrom: "2025-01-01", source: "s", status: "approved" })).toThrow();
  });
});

describe("StateMachine", () => {
  const sm = new StateMachine<"declared" | "client_ok" | "validated", { locked: boolean }>([
    { from: "declared", to: "client_ok", event: "client_approve", allowedRoles: ["client"] },
    { from: "client_ok", to: "validated", event: "validate", allowedRoles: ["ops"], guard: c => c.locked ? "CRA verrouillé" : null },
  ]);
  it("applique et audite", () => {
    const r = sm.apply("declared", "client_approve", { id: "u1", role: "client" }, { locked: false });
    expect(r.state).toBe("client_ok");
    expect(r.audit.actor).toBe("u1");
  });
  it("refuse rôle, transition et précondition", () => {
    expect(() => sm.apply("declared", "client_approve", { id: "u", role: "ops" }, { locked: false })).toThrow(/non autorisé/);
    expect(() => sm.apply("declared", "validate", { id: "u", role: "ops" }, { locked: false })).toThrow(/interdite/);
    expect(() => sm.apply("client_ok", "validate", { id: "u", role: "ops" }, { locked: true })).toThrow(/Précondition/);
  });
});

describe("Ledger", () => {
  const line = (account: string, d: number, c: number) => ({ account, debit: Money.of(d), credit: Money.of(c) });
  it("refuse déséquilibre et doublons, contrepasse sans écraser", () => {
    const l = new Ledger();
    expect(() => l.post({ id: "e0", tenantId: "t", valueDate: "2026-01-01", lines: [line("411", 100, 0), line("706", 0, 99)] })).toThrow(/déséquilibrée/);
    l.post({ id: "e1", tenantId: "t", consultantId: "c", valueDate: "2026-01-01", lines: [line("411", 100, 0), line("706", 0, 100)] });
    expect(() => l.post({ id: "e1", tenantId: "t", valueDate: "2026-01-01", lines: [line("411", 1, 0), line("706", 0, 1)] })).toThrow(/idempotence/);
    expect(l.balance("411", "t", "c").toString()).toBe("100.00 EUR");
    l.reverse("e1", "e2", "2026-01-02");
    expect(l.balance("411", "t", "c").isZero()).toBe(true);
    expect(l.all()).toHaveLength(2);
    expect(() => l.reverse("e1", "e3", "2026-01-03")).toThrow(/contrepassée/);
  });
  it("isole les tenants", () => {
    const l = new Ledger();
    l.post({ id: "a", tenantId: "t1", valueDate: "2026-01-01", lines: [line("411", 5, 0), line("706", 0, 5)] });
    expect(l.balance("411", "t2").isZero()).toBe(true);
  });
});

describe("InvoiceNumbering", () => {
  it("séquence sans trou par tenant/série/année", () => {
    const n = new InvoiceNumbering();
    expect(n.next("t", "FA", 2026)).toBe("FA-2026-000001");
    expect(n.next("t", "FA", 2026)).toBe("FA-2026-000002");
    expect(n.next("t2", "FA", 2026)).toBe("FA-2026-000001");
  });
});

import { prospectPipeline } from "../src/index";
describe("prospectPipeline", () => {
  const u = { id: "u", role: "commerce" };
  it("suit le parcours nominal avec audit", () => {
    let s = prospectPipeline.apply("new", "contact", u, { kind: "consultant", hasContact: true });
    s = prospectPipeline.apply(s.state, "qualify", u, { kind: "consultant", hasContact: true });
    expect(prospectPipeline.apply(s.state, "convert", u, { kind: "consultant", hasContact: true }).state).toBe("converted");
  });
  it("refuse sans contact, sans motif de perte, rôle non commercial, converti->autre", () => {
    expect(() => prospectPipeline.apply("new", "contact", u, { kind: "company", hasContact: false })).toThrow(/Précondition/);
    expect(() => prospectPipeline.apply("new", "lose", u, { kind: "company", hasContact: true })).toThrow(/motif/);
    expect(() => prospectPipeline.apply("new", "contact", { id: "x", role: "consultant" }, { kind: "company", hasContact: true })).toThrow(/non autorisé/);
    expect(() => prospectPipeline.apply("converted", "reopen", u, { kind: "company", hasContact: true })).toThrow(/interdite/);
  });
});
