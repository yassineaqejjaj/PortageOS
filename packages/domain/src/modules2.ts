import Decimal from "decimal.js";
import { StateMachine } from "./state-machine.js";
import { Money } from "./money.js";

// ---------- Notes de frais ----------
export const EXPENSE_STATES = ["draft", "submitted", "approved", "rejected", "reimbursed"] as const;
export type ExpenseState = (typeof EXPENSE_STATES)[number];
export interface ExpenseCtx { lineCount: number; missingReceipts: number; ownerUserId: string; actorUserId: string; rejectReason?: string }
const INTERNAL = ["tenant_admin", "operations", "finance"];
export const expenseWorkflow = new StateMachine<ExpenseState, ExpenseCtx>([
  { from: "draft", to: "submitted", event: "submit", allowedRoles: ["consultant", "tenant_admin", "operations"],
    guard: c => (c.lineCount === 0 ? "aucune ligne de frais" : c.missingReceipts > 0 ? `${c.missingReceipts} ligne(s) sans justificatif` : null) },
  { from: "submitted", to: "draft", event: "recall", allowedRoles: ["consultant", "tenant_admin", "operations"] },
  // séparation des tâches : on n'approuve pas ses propres frais
  { from: "submitted", to: "approved", event: "approve", allowedRoles: INTERNAL, guard: c => (c.ownerUserId === c.actorUserId ? "on ne peut pas approuver ses propres frais" : null) },
  { from: "submitted", to: "rejected", event: "reject", allowedRoles: INTERNAL, guard: c => (c.rejectReason && c.rejectReason.trim().length >= 3 ? null : "motif de refus obligatoire") },
  { from: "rejected", to: "draft", event: "reopen", allowedRoles: ["consultant", "tenant_admin", "operations"] },
  { from: "approved", to: "reimbursed", event: "reimburse", allowedRoles: ["tenant_admin", "finance"] },
]);

/** Indemnité kilométrique = km × barème (paramètre daté fourni par l'appelant), arrondie au centime. Aucun barème par défaut. */
export function mileageAmount(km: string, ratePerKm: string): Money {
  const k = new Decimal(km);
  if (k.lte(0)) throw new Error("Kilométrage invalide");
  return Money.of(ratePerKm).mul(k).round();
}

export function expenseFingerprint(consultantId: string, date: string, category: string, amount: string): string {
  return [consultantId, date, category, new Decimal(amount).toFixed(2)].join("|");
}

// ---------- Avoirs ----------
/** Avoir total d'une facture : montants identiques, de signe opposé dans le journal. */
export const CREDITABLE_STATES = ["issued", "partially_paid", "paid"] as const;

// ---------- Contrats ----------
export const CONTRACT_STATES = ["draft", "sent", "signed", "cancelled"] as const;
export type ContractState = (typeof CONTRACT_STATES)[number];
export interface ContractCtx { signatureDeclaration?: string }
const LEGAL = ["tenant_admin", "hr"];
export const contractWorkflow = new StateMachine<ContractState, ContractCtx>([
  { from: "draft", to: "sent", event: "send", allowedRoles: LEGAL },
  { from: "sent", to: "signed", event: "sign", allowedRoles: LEGAL, guard: c => (c.signatureDeclaration && c.signatureDeclaration.trim().length >= 10 ? null : "déclaration de signature obligatoire (10 caractères min.)") },
  { from: "draft", to: "cancelled", event: "cancel", allowedRoles: LEGAL },
  { from: "sent", to: "cancelled", event: "cancel", allowedRoles: LEGAL },
]);

/** Rendu d'un modèle : toutes les variables déclarées doivent être fournies, aucune variable inconnue n'est acceptée. */
export function declaredVariables(body: string): string[] {
  return [...new Set([...body.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map(m => m[1]!))].sort();
}
export function renderTemplate(body: string, values: Record<string, string>): string {
  const declared = declaredVariables(body);
  const missing = declared.filter(v => !(v in values) || values[v]!.trim() === "");
  if (missing.length) throw new Error(`Variables manquantes : ${missing.join(", ")}`);
  const unknown = Object.keys(values).filter(k => !declared.includes(k));
  if (unknown.length) throw new Error(`Variables inconnues : ${unknown.join(", ")}`);
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k: string) => values[k]!);
}

// ---------- Compte d'activité (estimation, jamais un bulletin) ----------
export interface ActivityInput {
  payments: { amount: string; invoiceNet: string; invoiceGross: string; feeRatePercent: string | null }[];
  invoicedNet: string; expensesReimbursed: string;
}
export function activityStatement(i: ActivityInput) {
  let collectedNet = new Decimal(0), fee: Decimal | null = new Decimal(0);
  for (const p of i.payments) {
    const net = new Decimal(p.amount).times(p.invoiceNet).div(p.invoiceGross).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    collectedNet = collectedNet.plus(net);
    if (p.feeRatePercent === null) fee = null;
    else if (fee) fee = fee.plus(net.times(p.feeRatePercent).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
  }
  const exp = new Decimal(i.expensesReimbursed);
  const balance = fee === null ? null : collectedNet.minus(fee).minus(exp);
  return { invoicedNet: new Decimal(i.invoicedNet).toFixed(2), collectedNet: collectedNet.toFixed(2), managementFee: fee?.toFixed(2) ?? null,
    expensesReimbursed: exp.toFixed(2), balanceBeforeSocialAndSalary: balance?.toFixed(2) ?? null };
}
