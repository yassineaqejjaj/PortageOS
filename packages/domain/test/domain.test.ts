import { describe, it, expect } from "vitest";
import { Money, invoiceTotals, ParameterCatalog, StateMachine, Ledger, InvoiceNumbering, parseAmount, parseBankDate, parseBankCsv, suggestMatches } from "../src/index";

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

import { isValidAccountCode, accountBalance, journalCode, fecDate, fecAmount, fecRows, toFecText, FEC_COLUMNS } from "../src/index";
describe("comptabilité", () => {
  it("comptes, soldes, formats FEC", () => {
    expect(["411", "44571", "6251", "10", "0411", "41a", "123456789"].map(isValidAccountCode)).toEqual([true, true, true, false, false, false, false]);
    expect(accountBalance("100", "40")).toEqual({ debit: "60.00", credit: "0.00" }); expect(accountBalance("10", "40.5")).toEqual({ debit: "0.00", credit: "30.50" }); expect(accountBalance("5", "5")).toEqual({ debit: "0.00", credit: "0.00" });
    expect([journalCode("invoice"), journalCode("credit_note"), journalCode("payment"), journalCode("expense"), journalCode("manual")]).toEqual(["VT", "VT", "BQ", "BQ", "OD"]);
    expect(fecDate("2026-02-10")).toBe("20260210"); expect(fecAmount("1234.5")).toBe("1234,50"); expect(fecAmount(0)).toBe("0,00");
  });
  it("lignes FEC : 18 colonnes, numérotation, libellés assainis, équilibre", () => {
    const rows = fecRows([{ id: "e1", valueDate: "2026-02-10", createdDate: "2026-02-10", sourceType: "invoice", sourceId: "abcdefghijklmnopqrstuvwxyz", label: "Facture\tFA|1", validDate: "2026-03-05",
      lines: [{ account: "411", debit: "1200", credit: "0" }, { account: "706", debit: "0", credit: "1000" }, { account: "44571", debit: "0", credit: "200" }] }], { "411": "Clients", "706": "Prestations" });
    expect(rows).toHaveLength(3); expect(rows.every(r => r.length === FEC_COLUMNS.length)).toBe(true);
    expect(rows[0]).toEqual(["VT", "Journal des ventes", "1", "20260210", "411", "Clients", "", "", "abcdefghijklmnopqrst", "20260210", "Facture FA 1", "1200,00", "0,00", "", "", "20260305", "", ""]);
    expect(rows[2]![5]).toBe("44571"); // libellé absent => numéro de compte
    const text = toFecText(rows); expect(text.split("\r\n")[0]).toBe(FEC_COLUMNS.join("\t")); expect(text.split("\r\n")).toHaveLength(5);
  });
});

import { scoreProspect, DEFAULT_SCORING_WEIGHTS, validateWeights, parseCsv, suggestMapping, validateProspectRow, simulateOffer, validateRule, percentCommission, withinDuration, commissionWorkflow, campaignWorkflow } from "../src/index";
describe("CRM", () => {
  const base = { stage: "new", hasEmail: false, hasPhone: false, referred: false, inCampaign: false, interactions: 0, overdueTasks: 0, now: "2026-11-09T10:00:00Z" };
  it("scoring explicable : chaque point est justifié, plafonds et bornes", () => {
    const a = scoreProspect({ ...base, stage: "qualified", hasEmail: true, hasPhone: true, referred: true, inCampaign: true, interactions: 6, lastInteractionAt: "2026-11-01T10:00:00Z", overdueTasks: 3 });
    expect(a.breakdown.map(x => [x.key, x.points])).toEqual([["email", 10], ["phone", 10], ["referred", 20], ["campaign", 5], ["qualified", 30], ["interaction", 20], ["recentActivity", 10], ["overdueTask", -10]]);
    expect(a.score).toBe(95); expect(a.band).toBe("hot"); expect(a.breakdown.every(x => x.detail.length > 5)).toBe(true); expect(a.disclaimer).toMatch(/décision automatisée/);
    expect(scoreProspect(base).score).toBe(0); expect(scoreProspect({ ...base, hasEmail: true, hasPhone: true, stage: "contacted" }).band).toBe("warm");
    expect(scoreProspect({ ...base, stage: "lost", hasEmail: true, referred: true }).score).toBe(0);
    expect(scoreProspect({ ...base, lastInteractionAt: "2026-10-01T00:00:00Z", interactions: 1 }).breakdown.some(x => x.key === "recentActivity")).toBe(false);
    expect(scoreProspect({ ...base, stage: "qualified", hasEmail: true, hasPhone: true, referred: true, inCampaign: true, interactions: 4 }, { ...DEFAULT_SCORING_WEIGHTS, referred: 40 }).score).toBe(100); // borné à 100
    expect(validateWeights({ ...DEFAULT_SCORING_WEIGHTS })).toEqual([]); expect(validateWeights({ ...DEFAULT_SCORING_WEIGHTS, email: 99 })).toHaveLength(1); expect(validateWeights({ ...DEFAULT_SCORING_WEIGHTS, extra: 1 })).toHaveLength(1);
  });
  it("CSV : délimiteur, guillemets, BOM, erreurs; mapping et validation de ligne", () => {
    const r = parseCsv('﻿Nom;Email;Téléphone;Type\r\n"Dupont; Jean";jean@example.test;+33 6 12 34 56 78;consultant\r\n"Société ""X""";;;entreprise\r\n');
    expect(r.delimiter).toBe(";"); expect(r.headers).toEqual(["Nom", "Email", "Téléphone", "Type"]); expect(r.rows[0]).toMatchObject({ Nom: "Dupont; Jean" }); expect(r.rows[1]!.Nom).toBe('Société "X"');
    const m = suggestMapping(r.headers); expect(m).toEqual({ name: "Nom", email: "Email", phone: "Téléphone", kind: "Type" });
    expect(validateProspectRow(r.rows[0]!, m, "company")).toEqual({ ok: true, data: { kind: "consultant", name: "Dupont; Jean", email: "jean@example.test", phone: "+33 6 12 34 56 78" } });
    expect(validateProspectRow({ Nom: "", Email: "pas-un-email", "Téléphone": "x", Type: "alien" }, m, "company")).toMatchObject({ ok: false, errors: ["nom manquant", "email invalide", "téléphone invalide", "type inconnu (consultant ou entreprise)"] });
    expect(() => parseCsv('a,b\n"non fermé,1')).toThrow(/Guillemet/); expect(() => parseCsv("a,a\n1,2")).toThrow(/double/); expect(() => parseCsv("")).toThrow(/vide/);
    expect(parseCsv("a,b\n1,2\n\n3,4").rows).toHaveLength(2); expect(parseCsv("a\tb\n1\t2").delimiter).toBe("\t");
  });
  it("simulation : montants exacts, hypothèses restituées, entrées invalides refusées", () => {
    const s = simulateOffer({ dailyRate: "650", daysPerMonth: "19", vatRate: "20", feeRatePercent: "10", monthlyExpenses: "50" });
    expect(s).toMatchObject({ invoicedNet: "12350.00", vat: "2470.00", invoicedGross: "14820.00", managementFee: "1235.00", balanceBeforeSocialAndSalary: "11065.00", annualBalanceBeforeSocialAndSalary: "132780.00" });
    expect(s.hypotheses.join(" ")).toMatch(/NON calculés/);
    for (const bad of [{ daysPerMonth: "0" }, { daysPerMonth: "32" }, { daysPerMonth: "10.3" }, { dailyRate: "0" }, { feeRatePercent: "101" }, { vatRate: "-1" }]) expect(() => simulateOffer({ dailyRate: "650", daysPerMonth: "19", vatRate: "20", feeRatePercent: "10", ...bad })).toThrow();
  });
  it("commissions : règles, durée, arrondi, quatre yeux", () => {
    expect(validateRule({ type: "percent_of_collected_net", value: "5" })).toBeNull(); expect(validateRule({ type: "percent_of_collected_net", value: "101" })).toMatch(/> 100/); expect(validateRule({ type: "fixed_per_conversion", value: "-1" })).toMatch(/invalide/); expect(validateRule({ type: "magic", value: "1" })).toMatch(/inconnu/);
    expect(percentCommission("1625.00", "5")).toBe("81.25"); expect(percentCommission("333.33", "7.5")).toBe("25.00");
    expect(withinDuration("2026-01-15", "2026-07-15", 6)).toBe(true); expect(withinDuration("2026-01-15", "2026-07-16", 6)).toBe(false); expect(withinDuration("2026-01-15", "2026-01-14", 6)).toBe(false);
    expect(() => commissionWorkflow.apply("accrued", "approve", { id: "u", role: "finance" }, { actorUserId: "u", referralCreatedBy: "u" })).toThrow(/quatre yeux/);
    expect(commissionWorkflow.apply("accrued", "approve", { id: "a", role: "finance" }, { actorUserId: "a", referralCreatedBy: "u" }).state).toBe("approved");
    expect(() => commissionWorkflow.apply("accrued", "pay", { id: "a", role: "finance" }, { actorUserId: "a", referralCreatedBy: "u" })).toThrow(/interdite/);
    expect(() => commissionWorkflow.apply("accrued", "approve", { id: "a", role: "commerce" }, { actorUserId: "a", referralCreatedBy: "u" })).toThrow(/non autorisé/);
    expect(campaignWorkflow.apply("draft", "launch", { id: "u", role: "commerce" }, {}).state).toBe("active"); expect(() => campaignWorkflow.apply("ended", "launch", { id: "u", role: "commerce" }, {})).toThrow();
  });
});

describe("relevés bancaires", () => {
  it("montants et dates au format français", () => {
    expect(parseAmount("1 234,56")?.toFixed(2)).toBe("1234.56"); expect(parseAmount("1.234,56")?.toFixed(2)).toBe("1234.56"); expect(parseAmount("-12,5")?.toFixed(2)).toBe("-12.50"); expect(parseAmount("(40,00)")?.toFixed(2)).toBe("-40.00"); expect(parseAmount("1234.56")?.toFixed(2)).toBe("1234.56");
    expect(parseAmount("1,234,56")).toBeNull(); expect(parseAmount("abc")).toBeNull(); expect(parseAmount("12,345")).toBeNull(); expect(parseAmount("")).toBeNull();
    expect(parseBankDate("31/01/2026")).toBe("2026-01-31"); expect(parseBankDate("2026-02-30")).toBeNull(); expect(parseBankDate("31/02/2026")).toBeNull(); expect(parseBankDate("demain")).toBeNull();
  });
  it("analyse CSV : colonnes montant unique ou débit/crédit, erreurs par ligne", () => {
    const a = parseBankCsv("Date;Libellé;Montant\r\n05/01/2026;VIR CLIENT FA-2026-0001;1 200,00\r\n06/01/2026;PRLV ASSURANCE;-45,10\r\nx;;0");
    expect(a.rows.map(r => [r.date, r.amount])).toEqual([["2026-01-05", "1200.00"], ["2026-01-06", "-45.10"]]); expect(a.errors[0]).toMatchObject({ line: 4 });
    const b = parseBankCsv("Date opération,Libellé,Débit,Crédit\n2026-01-05,Frais,10.00,\n2026-01-06,Virement,,500.00");
    expect(b.rows.map(r => r.amount)).toEqual(["-10.00", "500.00"]);
    expect(() => parseBankCsv("A;B\r\n1;2")).toThrow(/introuvables/); expect(() => parseBankCsv("Date;Libellé;Montant\r\n1;2;3", { amount: "Absent" })).toThrow(/inconnue/);
  });
  it("propositions de rapprochement : référence prioritaire, montant seulement si non ambigu", () => {
    const inv = [{ id: "a", number: "FA-2026-0001", remaining: "1200.00" }, { id: "b", number: "FA-2026-0002", remaining: "800.00" }, { id: "c", number: "FA-2026-0003", remaining: "800.00" }];
    expect(suggestMatches({ amount: "1200.00", label: "VIR SEPA fa-2026-0001 merci" }, inv)).toEqual([{ invoiceId: "a", number: "FA-2026-0001", confidence: "reference", fullySettles: true }]);
    expect(suggestMatches({ amount: "500.00", label: "ACOMPTE FA-2026-0001" }, inv)[0]).toMatchObject({ invoiceId: "a", fullySettles: false });
    expect(suggestMatches({ amount: "1300.00", label: "FA-2026-0001" }, inv)).toEqual([]); // dépasse le solde
    expect(suggestMatches({ amount: "800.00", label: "VIR DIVERS" }, inv)).toEqual([]); // deux factures de même solde : ambigu
    expect(suggestMatches({ amount: "1200.00", label: "VIR DIVERS" }, inv)[0]).toMatchObject({ invoiceId: "a", confidence: "amount" });
    expect(suggestMatches({ amount: "-1200.00", label: "FA-2026-0001" }, inv)).toEqual([]);
  });
});
