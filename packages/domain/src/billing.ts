import Decimal from "decimal.js";
import { Money } from "./money.js";
import { StateMachine } from "./state-machine.js";

// ---------- CRA (workflow 3, début) ----------
export const TIMESHEET_STATES = ["draft", "submitted", "client_approved", "client_rejected", "validated", "invoiced"] as const;
export type TimesheetState = (typeof TIMESHEET_STATES)[number];
export interface TimesheetCtx { totalDays: string; rejectReason?: string; invoiceId?: string }
const OPS = ["tenant_admin", "operations"];

export const timesheetWorkflow = new StateMachine<TimesheetState, TimesheetCtx>([
  { from: "draft", to: "submitted", event: "submit", allowedRoles: [...OPS, "consultant"], guard: c => (new Decimal(c.totalDays).gt(0) ? null : "aucun jour déclaré") },
  { from: "submitted", to: "draft", event: "recall", allowedRoles: [...OPS, "consultant"] },
  { from: "submitted", to: "client_approved", event: "approve", allowedRoles: ["client_user"] },
  { from: "submitted", to: "client_rejected", event: "reject", allowedRoles: ["client_user"], guard: c => (c.rejectReason && c.rejectReason.trim().length >= 3 ? null : "motif de refus obligatoire") },
  { from: "client_rejected", to: "draft", event: "reopen", allowedRoles: [...OPS, "consultant"] },
  { from: "client_approved", to: "validated", event: "validate", allowedRoles: OPS },
  { from: "client_approved", to: "draft", event: "reopen_approved", allowedRoles: ["tenant_admin"] },
  { from: "validated", to: "invoiced", event: "mark_invoiced", allowedRoles: ["tenant_admin", "finance"], guard: c => (c.invoiceId ? null : "facture requise") },
]);

/** Les quantités de jours sont des demi-journées ou journées. */
export function isValidDayQuantity(q: string | number): boolean {
  const d = new Decimal(q);
  return d.eq(0.5) || d.eq(1);
}

// ---------- Facture ----------
export interface InvoiceInput { days: string; unitPrice: string; vatRate: string; currency?: string }
export function computeInvoice(i: InvoiceInput) {
  const cur = i.currency ?? "EUR";
  const net = Money.of(i.unitPrice, cur).mul(i.days).round();
  const vat = net.mul(new Decimal(i.vatRate).div(100)).round();
  return { net, vat, gross: net.add(vat) };
}

export const INVOICE_STATES = ["draft", "issued", "partially_paid", "paid", "cancelled", "credited"] as const;
export type InvoiceState = (typeof INVOICE_STATES)[number];
export interface InvoiceCtx { paid: string }
const FIN = ["tenant_admin", "finance"];
export const invoiceWorkflow = new StateMachine<InvoiceState, InvoiceCtx>([
  { from: "draft", to: "issued", event: "issue", allowedRoles: FIN },
  { from: "issued", to: "credited", event: "credit", allowedRoles: FIN },
  { from: "partially_paid", to: "credited", event: "credit", allowedRoles: FIN },
  { from: "paid", to: "credited", event: "credit", allowedRoles: FIN },
  { from: "issued", to: "cancelled", event: "cancel", allowedRoles: FIN, guard: c => (new Decimal(c.paid).isZero() ? null : "facture encaissée : un avoir est requis (non implémenté)") },
]);

/** Résultat d'un encaissement: jamais de trop-perçu silencieux, jamais d'encaissement sur une facture non émise/annulée. */
export function applyPayment(state: InvoiceState, gross: string, alreadyPaid: string, amount: string): { paid: string; state: InvoiceState } {
  if (state !== "issued" && state !== "partially_paid") throw new Error(`Encaissement impossible sur une facture ${state}`);
  const a = new Decimal(amount);
  if (a.lte(0)) throw new Error("Montant d'encaissement invalide");
  const paid = new Decimal(alreadyPaid).plus(a);
  if (paid.gt(gross)) throw new Error("Encaissement supérieur au solde dû");
  return { paid: paid.toFixed(2), state: paid.eq(gross) ? "paid" : "partially_paid" };
}

/** Numéro de période YYYY-MM: validation stricte. */
export function isValidPeriod(p: string): boolean { return /^\d{4}-(0[1-9]|1[0-2])$/.test(p); }
export function dateInPeriod(isoDate: string, period: string): boolean { return isoDate.slice(0, 7) === period; }

// ---------- Unités de saisie du CRA ----------
export const TIME_UNITS = ["day", "hour", "forfait_jours"] as const;
export type TimeUnit = (typeof TIME_UNITS)[number];
export const TIME_UNIT_LABEL: Record<TimeUnit, string> = { day: "jours", hour: "heures", forfait_jours: "forfait jours" };

/** Jour et forfait jours : demi-journée ou journée. Heures : multiples de 0,25 h, 24 h au plus (borne physique, pas une règle légale). */
export function isValidQuantity(unit: TimeUnit, q: string | number): boolean {
  let d: Decimal;
  try { d = new Decimal(q); } catch { return false; }
  if (!d.isFinite()) return false;
  if (unit === "hour") return d.gt(0) && d.lte(24) && d.times(4).isInteger();
  return d.eq(0.5) || d.eq(1);
}

export interface CsvLines { lines: { date: string; quantity: string }[]; errors: string[] }
/** Import « date;quantité » (ou virgule), une ligne par jour ; en-tête facultatif ; virgule décimale acceptée avec le séparateur « ; ». */
export function parseTimesheetCsv(text: string, unit: TimeUnit, period: string): CsvLines {
  const lines: { date: string; quantity: string }[] = [], errors: string[] = [], seen = new Set<string>();
  const rows = text.replace(/^﻿/, "").split(/\r?\n/).map(r => r.trim()).filter(Boolean);
  if (rows.length > 400) return { lines, errors: ["Fichier trop long (400 lignes au plus)."] };
  rows.forEach((row, i) => {
    const sep = row.includes(";") ? ";" : ",";
    const [d, q, ...rest] = row.split(sep).map(c => c.trim().replace(/^"|"$/g, ""));
    if (i === 0 && !/^\d/.test(d ?? "")) return; // en-tête
    const n = i + 1;
    if (rest.length || d === undefined || q === undefined) { errors.push(`Ligne ${n} : deux colonnes attendues (date, quantité).`); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !dateInPeriod(d, period)) { errors.push(`Ligne ${n} : date « ${d.slice(0, 20)} » absente de la période ${period} (format AAAA-MM-JJ).`); return; }
    const qty = sep === ";" ? q.replace(",", ".") : q;
    if (!isValidQuantity(unit, qty)) { errors.push(`Ligne ${n} : quantité « ${q.slice(0, 12)} » invalide pour l'unité ${TIME_UNIT_LABEL[unit]}.`); return; }
    if (seen.has(d)) { errors.push(`Ligne ${n} : date en double ${d}.`); return; }
    seen.add(d); lines.push({ date: d, quantity: new Decimal(qty).toString() });
  });
  return { lines, errors };
}

// ---------- Avenants de mission ----------
export const AMENDMENT_KINDS = ["rate", "extend", "early_end", "budget"] as const;
export type AmendmentKind = (typeof AMENDMENT_KINDS)[number];
/** Tarif applicable à une période : dernier avenant de tarif dont le mois d'effet est ≤ période, sinon tarif initial. */
export function rateForPeriod(baseRate: string, amendments: { effectiveMonth: string; newRate: string }[], period: string): string {
  const applicable = amendments.filter(a => a.effectiveMonth <= period).sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth));
  return applicable.length ? applicable[applicable.length - 1]!.newRate : baseRate;
}
