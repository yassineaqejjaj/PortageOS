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

import { timesheetWorkflow, invoiceWorkflow, computeInvoice, applyPayment, isValidDayQuantity, isValidPeriod } from "../src/index";
describe("billing", () => {
  it("quantités de jours et périodes", () => {
    expect(isValidDayQuantity("0.5")).toBe(true); expect(isValidDayQuantity(1)).toBe(true);
    expect(isValidDayQuantity("0.75")).toBe(false); expect(isValidDayQuantity(2)).toBe(false);
    expect(isValidPeriod("2026-10")).toBe(true); expect(isValidPeriod("2026-13")).toBe(false);
  });
  it("calcule HT/TVA/TTC exacts (19 j × 650,00 €, TVA 20 %)", () => {
    const t = computeInvoice({ days: "19", unitPrice: "650.00", vatRate: "20" });
    expect(t.net.toString()).toBe("12350.00 EUR"); expect(t.vat.toString()).toBe("2470.00 EUR"); expect(t.gross.toString()).toBe("14820.00 EUR");
    const r = computeInvoice({ days: "0.5", unitPrice: "333.33", vatRate: "5.5" });
    expect(r.net.toString()).toBe("166.67 EUR"); expect(r.vat.toString()).toBe("9.17 EUR");
  });
  it("CRA: refus client sans motif, approbation réservée au client, facturation exige une facture", () => {
    const ctx = { totalDays: "10" };
    expect(() => timesheetWorkflow.apply("submitted", "approve", { id: "u", role: "operations" }, ctx)).toThrow(/non autorisé/);
    expect(() => timesheetWorkflow.apply("submitted", "reject", { id: "c", role: "client_user" }, ctx)).toThrow(/motif/);
    expect(timesheetWorkflow.apply("submitted", "reject", { id: "c", role: "client_user" }, { ...ctx, rejectReason: "Jours erronés" }).state).toBe("client_rejected");
    expect(() => timesheetWorkflow.apply("draft", "submit", { id: "u", role: "consultant" }, { totalDays: "0" })).toThrow(/aucun jour/);
    expect(() => timesheetWorkflow.apply("validated", "mark_invoiced", { id: "f", role: "finance" }, ctx)).toThrow(/facture requise/);
    expect(() => timesheetWorkflow.apply("invoiced", "reopen_approved", { id: "a", role: "tenant_admin" }, ctx)).toThrow(/interdite/);
  });
  it("encaissements: partiel, solde, trop-perçu et facture non émise refusés", () => {
    expect(applyPayment("issued", "100.00", "0", "40")).toEqual({ paid: "40.00", state: "partially_paid" });
    expect(applyPayment("partially_paid", "100.00", "40.00", "60")).toEqual({ paid: "100.00", state: "paid" });
    expect(() => applyPayment("partially_paid", "100.00", "40.00", "60.01")).toThrow(/supérieur/);
    expect(() => applyPayment("draft", "100.00", "0", "10")).toThrow(/impossible/);
    expect(() => applyPayment("paid", "100.00", "100.00", "1")).toThrow(/impossible/);
  });
  it("annulation: refusée si encaissée", () => {
    expect(invoiceWorkflow.apply("issued", "cancel", { id: "f", role: "finance" }, { paid: "0.00" }).state).toBe("cancelled");
    expect(() => invoiceWorkflow.apply("issued", "cancel", { id: "f", role: "finance" }, { paid: "10.00" })).toThrow(/avoir/);
    expect(() => invoiceWorkflow.apply("draft", "issue", { id: "o", role: "operations" }, { paid: "0" })).toThrow(/non autorisé/);
  });
});

import { expenseWorkflow, mileageAmount, expenseFingerprint, contractWorkflow, declaredVariables, renderTemplate, activityStatement } from "../src/index";
describe("modules 2", () => {
  const base = { lineCount: 2, missingReceipts: 0, ownerUserId: "own", actorUserId: "act" };
  it("frais : justificatifs requis, pas d'auto-approbation, motif de refus, remboursement réservé", () => {
    expect(() => expenseWorkflow.apply("draft", "submit", { id: "u", role: "consultant" }, { ...base, missingReceipts: 1 })).toThrow(/sans justificatif/);
    expect(() => expenseWorkflow.apply("draft", "submit", { id: "u", role: "consultant" }, { ...base, lineCount: 0 })).toThrow(/aucune ligne/);
    expect(() => expenseWorkflow.apply("submitted", "approve", { id: "own", role: "operations" }, { ...base, actorUserId: "own" })).toThrow(/propres frais/);
    expect(() => expenseWorkflow.apply("submitted", "reject", { id: "a", role: "operations" }, base)).toThrow(/motif/);
    expect(() => expenseWorkflow.apply("approved", "reimburse", { id: "a", role: "operations" }, base)).toThrow(/non autorisé/);
    expect(expenseWorkflow.apply("approved", "reimburse", { id: "a", role: "finance" }, base).state).toBe("reimbursed");
  });
  it("kilométrage exact, empreinte stable", () => {
    expect(mileageAmount("123.4", "0.606").toString()).toBe("74.78 EUR");
    expect(() => mileageAmount("0", "0.5")).toThrow();
    expect(expenseFingerprint("c", "2026-10-01", "meal", "12.5")).toBe("c|2026-10-01|meal|12.50");
  });
  it("contrats : variables, signature déclarée, immuabilité du flux", () => {
    expect(declaredVariables("Bonjour {{ nom }}, {{ref}} {{nom}}")).toEqual(["nom", "ref"]);
    expect(renderTemplate("A {{x}} B", { x: "1" })).toBe("A 1 B");
    expect(() => renderTemplate("A {{x}}", {})).toThrow(/manquantes/);
    expect(() => renderTemplate("A {{x}}", { x: "1", y: "2" })).toThrow(/inconnues/);
    expect(() => contractWorkflow.apply("sent", "sign", { id: "h", role: "hr" }, { signatureDeclaration: "court" })).toThrow(/déclaration/);
    expect(() => contractWorkflow.apply("signed", "cancel", { id: "h", role: "hr" }, {})).toThrow(/interdite/);
  });
  it("compte d'activité : jamais de frais de gestion inventés si le paramètre manque", () => {
    const ok = activityStatement({ payments: [{ amount: "1950.00", invoiceNet: "1625.00", invoiceGross: "1950.00", feeRatePercent: "10" }], invoicedNet: "1625", expensesReimbursed: "50" });
    expect(ok).toMatchObject({ collectedNet: "1625.00", managementFee: "162.50", balanceBeforeSocialAndSalary: "1412.50" });
    const missing = activityStatement({ payments: [{ amount: "100", invoiceNet: "100", invoiceGross: "120", feeRatePercent: null }], invoicedNet: "0", expensesReimbursed: "0" });
    expect(missing.managementFee).toBeNull(); expect(missing.balanceBeforeSocialAndSalary).toBeNull();
  });
});

import { leaveDays, totalDays as ltotal, leaveBalance, leaveWorkflow } from "../src/index";
describe("congés", () => {
  it("jours ouvrés, week-ends et fériés paramétrés exclus, demi-journées", () => {
    const w = leaveDays({ start: "2031-03-03", end: "2031-03-09" }); // lun → dim
    expect(w).toHaveLength(5); expect(ltotal(w).toString()).toBe("5");
    expect(ltotal(leaveDays({ start: "2031-03-03", end: "2031-03-07" }, new Set(["2031-03-05"]))).toString()).toBe("4");
    expect(ltotal(leaveDays({ start: "2031-03-03", end: "2031-03-05", halfStart: true, halfEnd: true })).toString()).toBe("2");
    expect(ltotal(leaveDays({ start: "2031-03-08", end: "2031-03-09" })).toString()).toBe("0"); // week-end
    expect(ltotal(leaveDays({ start: "2031-03-08", end: "2031-03-10", halfStart: true })).toString()).toBe("1"); // demi-jour sur un samedi ignoré
    expect(() => leaveDays({ start: "2031-03-05", end: "2031-03-03" })).toThrow(/précède/);
    expect(() => leaveDays({ start: "2031-03-03", end: "2031-03-03", halfStart: true, halfEnd: true })).toThrow(/demi-jour/);
  });
  it("solde et workflow : pas d'auto-approbation, solde insuffisant, annulation après début interdite", () => {
    expect(leaveBalance(["10", "-1.5"], ["3", "0.5"])).toBe("5.0");
    const ctx = { ownerUserId: "o", actorUserId: "a", startsInFuture: true, consumes: true, balanceAfter: "2" };
    expect(leaveWorkflow.apply("submitted", "approve", { id: "a", role: "hr" }, ctx).state).toBe("approved");
    expect(() => leaveWorkflow.apply("submitted", "approve", { id: "o", role: "hr" }, { ...ctx, actorUserId: "o" })).toThrow(/propre/);
    expect(() => leaveWorkflow.apply("submitted", "approve", { id: "a", role: "hr" }, { ...ctx, balanceAfter: "-0.5" })).toThrow(/insuffisant/);
    expect(leaveWorkflow.apply("submitted", "approve", { id: "a", role: "hr" }, { ...ctx, consumes: false, balanceAfter: "-5" }).state).toBe("approved");
    expect(() => leaveWorkflow.apply("approved", "cancel", { id: "c", role: "consultant" }, { ...ctx, startsInFuture: false })).toThrow(/déjà commencée/);
    expect(() => leaveWorkflow.apply("submitted", "reject", { id: "a", role: "hr" }, ctx)).toThrow(/motif/);
  });
});

import { ticketWorkflow } from "../src/index";
describe("support", () => {
  const a = (s: "open" | "pending_requester" | "resolved" | "closed", ev: string, role: string) => ticketWorkflow.apply(s, ev, { id: "u", role }, {} as Record<string, never>).state;
  it("workflow des tickets : réponses, résolution, réouverture, clôture définitive", () => {
    expect(a("open", "staff_reply", "staff")).toBe("pending_requester");
    expect(a("pending_requester", "requester_reply", "requester")).toBe("open");
    expect(a("resolved", "requester_reply", "requester")).toBe("open");
    expect(a("resolved", "close", "requester")).toBe("closed");
    expect(() => a("open", "resolve", "requester")).toThrow(/non autorisé/);
    expect(() => a("closed", "requester_reply", "requester")).toThrow(/interdite/);
    expect(() => a("resolved", "staff_reply", "staff")).toThrow(/interdite/);
  });
});

import { monthRange, monthDiff, daysInMonths, agingBucket, daysBetween, dso, cohortMatrix, csvCell, toCsv } from "../src/index";
describe("pilotage", () => {
  it("périodes et jours", () => {
    expect(monthRange("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(() => monthRange("2026-03", "2026-01")).toThrow(); expect(() => monthRange("2026-13", "2026-14")).toThrow(); expect(() => monthRange("2020-01", "2026-12")).toThrow(/trop longue/);
    expect(daysInMonths(["2026-01", "2026-02"])).toBe(59); expect(daysInMonths(["2028-02"])).toBe(29);
    expect(monthDiff("2026-11", "2027-02")).toBe(3); expect(daysBetween("2026-02-10", "2026-03-01")).toBe(19);
  });
  it("ancienneté des créances et DSO", () => {
    expect([0, 30, 31, 60, 61, 90, 91, 400].map(agingBucket)).toEqual(["0-30", "0-30", "31-60", "31-60", "61-90", "61-90", "91+", "91+"]);
    expect(() => agingBucket(-1)).toThrow();
    expect(dso("2400", "4200", 59)).toBe("33.7"); expect(dso("0", "1000", 30)).toBe("0.0"); expect(dso("100", "0", 30)).toBeNull();
  });
  it("cohortes : consultants distincts facturés par mois d'écart", () => {
    const m = cohortMatrix([{ id: "A", createdMonth: "2026-01" }, { id: "B", createdMonth: "2026-02" }, { id: "C", createdMonth: "2026-01" }],
      [{ consultantId: "A", month: "2026-01" }, { consultantId: "A", month: "2026-01" }, { consultantId: "A", month: "2026-02" }, { consultantId: "B", month: "2026-02" }], 2);
    expect(m).toEqual([{ cohort: "2026-01", size: 2, billedByOffset: [1, 1, 0] }, { cohort: "2026-02", size: 1, billedByOffset: [1, 0, 0] }]);
  });
  it("CSV : guillemets, séparateurs, injection de formule neutralisée, nombres négatifs conservés", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\""); expect(csvCell("@cmd")).toBe("'@cmd"); expect(csvCell("-12,5")).toBe("-12,5"); expect(csvCell("a;b")).toBe("\"a;b\"");
    expect(toCsv([["mois", "ca"], ["2026-01", 1000]])).toBe("mois;ca\r\n2026-01;1000\r\n");
  });
});

import { checkPassword } from "../src/index";
describe("politique de mot de passe", () => {
  it("accepte une phrase longue ou un mot de passe varié, refuse l'évident", () => {
    expect(checkPassword("Cheval-Agrafe-Lune-42")).toEqual([]);
    expect(checkPassword("Xk9#mQ2vLp7!")).toEqual([]);
    expect(checkPassword("court1A!")).toContain("12 caractères minimum");
    expect(checkPassword("camille.moreau-2026!", { email: "camille.moreau@x.test" })).toContain("ne doit pas contenir votre identifiant email");
    expect(checkPassword("MonPassword12345!")).toContain("contient un mot ou une suite trop courants");
    expect(checkPassword("aaaaaaaaaaaaaaaa")).toContain("caractère répété");
    expect(checkPassword("abcdefghijkl")).toContain("mélangez au moins 3 types de caractères (ou allongez à 16)");
    expect(checkPassword("phrase de passe très longue et unique")).toEqual([]);
  });
});
