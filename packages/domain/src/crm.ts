import Decimal from "decimal.js";
import { StateMachine } from "./state-machine.js";
import { Money } from "./money.js";

// ---------- Scoring explicable ----------
export const SCORING_KEYS = ["email", "phone", "referred", "campaign", "contacted", "qualified", "interaction", "recentActivity", "overdueTask"] as const;
export type ScoringKey = (typeof SCORING_KEYS)[number];
export type ScoringWeights = Record<ScoringKey, number>;
/** Pondérations par défaut : un choix COMMERCIAL, modifiable par l'administrateur ; aucune valeur légale. */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = { email: 10, phone: 10, referred: 20, campaign: 5, contacted: 10, qualified: 30, interaction: 5, recentActivity: 10, overdueTask: -5 };
export const BAND_THRESHOLDS = { hot: 60, warm: 30 } as const;
export const SCORING_DISCLAIMER = "Indicateur d'aide à la priorisation commerciale, fondé uniquement sur les éléments listés. Il ne constitue pas une décision automatisée : toute décision est prise par une personne.";

export function validateWeights(w: Record<string, unknown>): string[] {
  const errs: string[] = [];
  for (const k of SCORING_KEYS) { const v = w[k]; if (typeof v !== "number" || !Number.isInteger(v) || v < -20 || v > 40) errs.push(`${k} : entier entre -20 et 40`); }
  const extra = Object.keys(w).filter(k => !(SCORING_KEYS as readonly string[]).includes(k)); if (extra.length) errs.push(`critères inconnus : ${extra.join(", ")}`);
  return errs;
}
export interface ScoreInput { stage: string; hasEmail: boolean; hasPhone: boolean; referred: boolean; inCampaign: boolean; interactions: number; lastInteractionAt?: string; overdueTasks: number; now: string }
export function scoreProspect(i: ScoreInput, weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS) {
  const b: { key: ScoringKey; label: string; points: number; detail: string }[] = [];
  const add = (key: ScoringKey, label: string, points: number, detail: string) => { if (points !== 0) b.push({ key, label, points, detail }); };
  if (i.stage === "lost") return { score: 0, band: "cold" as const, breakdown: [{ key: "stage", label: "Prospect perdu", points: 0, detail: "Score ramené à 0 : le prospect est perdu" }], disclaimer: SCORING_DISCLAIMER };
  if (i.hasEmail) add("email", "Email renseigné", weights.email, "Un email est connu");
  if (i.hasPhone) add("phone", "Téléphone renseigné", weights.phone, "Un téléphone est connu");
  if (i.referred) add("referred", "Recommandé", weights.referred, "Le prospect provient d'une recommandation (parrainage ou apporteur)");
  if (i.inCampaign) add("campaign", "Rattaché à une campagne", weights.campaign, "Il a été touché par une campagne");
  if (i.stage === "contacted") add("contacted", "Étape « contacté »", weights.contacted, "Le prospect a été contacté");
  if (i.stage === "qualified" || i.stage === "converted") add("qualified", "Étape « qualifié »", weights.qualified, "Le prospect a été qualifié");
  const n = Math.min(i.interactions, 4); if (n > 0) add("interaction", "Interactions", weights.interaction * n, `${i.interactions} interaction(s) enregistrée(s), plafonnées à 4`);
  if (i.lastInteractionAt) { const days = (Date.parse(i.now) - Date.parse(i.lastInteractionAt)) / 86400000; if (days >= 0 && days <= 14) add("recentActivity", "Activité récente", weights.recentActivity, "Dernière interaction il y a 14 jours ou moins"); }
  if (i.overdueTasks > 0) add("overdueTask", "Tâches en retard", weights.overdueTask * Math.min(i.overdueTasks, 2), `${i.overdueTasks} tâche(s) en retard, plafonnées à 2`);
  const raw = b.reduce((s, x) => s + x.points, 0); const score = Math.max(0, Math.min(100, raw));
  return { score, band: score >= BAND_THRESHOLDS.hot ? ("hot" as const) : score >= BAND_THRESHOLDS.warm ? ("warm" as const) : ("cold" as const), breakdown: b, disclaimer: SCORING_DISCLAIMER };
}

// ---------- Import CSV ----------
export function detectDelimiter(headerLine: string): string { const c = [";", ",", "\t"].map(d => [d, headerLine.split(d).length - 1] as const).sort((a, b) => b[1] - a[1]); return c[0]![1] > 0 ? c[0]![0] : ","; }
/** Analyseur CSV (RFC 4180 minimal : guillemets, doubles guillemets, CRLF). */
export function parseCsv(text: string, maxRows = 2000): { headers: string[]; rows: Record<string, string>[]; delimiter: string } {
  const src = text.replace(/^﻿/, ""); const delimiter = detectDelimiter(src.split(/\r?\n/, 1)[0] ?? "");
  const records: string[][] = []; let cur: string[] = [], field = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (q) { if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === delimiter) { cur.push(field); field = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i++; cur.push(field); field = ""; if (cur.some(x => x.trim() !== "")) records.push(cur); cur = []; if (records.length > maxRows + 1) throw new Error(`Trop de lignes (${maxRows} maximum)`); }
    else field += c;
  }
  if (q) throw new Error("Guillemet non fermé");
  if (field !== "" || cur.length) { cur.push(field); if (cur.some(x => x.trim() !== "")) records.push(cur); }
  if (!records.length) throw new Error("Fichier vide");
  const headers = records[0]!.map(h => h.trim());
  if (new Set(headers.map(h => h.toLowerCase())).size !== headers.length) throw new Error("En-têtes en double");
  return { headers, delimiter, rows: records.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()]))) };
}
const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const SYN: Record<string, string[]> = { name: ["nom", "name", "nomcomplet", "raisonsociale", "societe", "entreprise"], email: ["email", "mail", "courriel", "adresseemail"], phone: ["telephone", "tel", "phone", "mobile"], kind: ["type", "kind", "categorie"], source: ["source", "origine"] };
export type CsvMapping = { name?: string; email?: string; phone?: string; kind?: string; source?: string };
export function suggestMapping(headers: string[]): CsvMapping { const out: CsvMapping = {}; for (const [field, syn] of Object.entries(SYN)) { const h = headers.find(x => syn.includes(norm(x))); if (h) (out as Record<string, string>)[field] = h; } return out; }
export interface ProspectRow { kind: "consultant" | "company"; name: string; email?: string; phone?: string; source?: string }
export function validateProspectRow(row: Record<string, string>, m: CsvMapping, defaultKind: "consultant" | "company"): { ok: true; data: ProspectRow } | { ok: false; errors: string[] } {
  const get = (k?: string) => (k ? (row[k] ?? "").trim() : ""); const errors: string[] = [];
  const name = get(m.name); if (!name) errors.push("nom manquant"); else if (name.length > 200) errors.push("nom trop long");
  const email = get(m.email).toLowerCase(); if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) errors.push("email invalide");
  const phone = get(m.phone); if (phone && !/^[+()\d .-]{5,30}$/.test(phone)) errors.push("téléphone invalide");
  const k = norm(get(m.kind)); let kind = defaultKind;
  if (k) { if (["consultant", "consultante", "candidat", "freelance"].includes(k)) kind = "consultant"; else if (["entreprise", "company", "client", "societe"].includes(k)) kind = "company"; else errors.push("type inconnu (consultant ou entreprise)"); }
  if (errors.length) return { ok: false, errors };
  return { ok: true, data: { kind, name, ...(email ? { email } : {}), ...(phone ? { phone } : {}), ...(get(m.source) ? { source: get(m.source).slice(0, 100) } : {}) } };
}

// ---------- Simulation commerciale ----------
export interface OfferInput { dailyRate: string; daysPerMonth: string; vatRate: string; feeRatePercent: string; monthlyExpenses?: string }
/** Simulation de facturation et de solde AVANT charges sociales et salaire : jamais une rémunération. Toutes les hypothèses sont fournies par l'appelant et restituées. */
export function simulateOffer(i: OfferInput) {
  const days = new Decimal(i.daysPerMonth); if (days.lte(0) || days.gt(31) || !days.mul(2).isInteger()) throw new Error("Jours par mois : multiple de 0,5 entre 0,5 et 31");
  const rate = new Decimal(i.dailyRate); if (rate.lte(0)) throw new Error("TJM invalide");
  const fee = new Decimal(i.feeRatePercent); if (fee.lt(0) || fee.gt(100)) throw new Error("Taux de frais de gestion invalide");
  const vatRate = new Decimal(i.vatRate); if (vatRate.lt(0) || vatRate.gt(100)) throw new Error("Taux de TVA invalide");
  const net = Money.of(rate).mul(days).round(); const vat = net.mul(vatRate.div(100)).round(); const managementFee = net.mul(fee.div(100)).round();
  const expenses = Money.of(i.monthlyExpenses ?? "0"); const balance = net.sub(managementFee).sub(expenses);
  return { invoicedNet: net.amount.toFixed(2), vat: vat.amount.toFixed(2), invoicedGross: net.add(vat).amount.toFixed(2), managementFee: managementFee.amount.toFixed(2), expenses: expenses.amount.toFixed(2),
    balanceBeforeSocialAndSalary: balance.amount.toFixed(2), annualBalanceBeforeSocialAndSalary: balance.mul(12).amount.toFixed(2),
    hypotheses: ["Facturation et encaissement intégral chaque mois", "Mêmes jours chaque mois (aucun congé ni intermission)", "Taux de frais de gestion et de TVA fournis ci-dessus", "Charges sociales, impositions, indemnités et salaire NON calculés (prestataire de paie)"] };
}

// ---------- Commissions ----------
export type CommissionRule = { type: "percent_of_collected_net"; value: string } | { type: "fixed_per_conversion"; value: string };
export function validateRule(r: { type: string; value: string }): string | null {
  const v = new Decimal(r.value); if (v.isNaN() || v.lt(0)) return "valeur invalide";
  if (r.type === "percent_of_collected_net") return v.gt(100) ? "pourcentage > 100" : null;
  if (r.type === "fixed_per_conversion") return v.gt(100000) ? "montant excessif" : null;
  return "type de règle inconnu";
}
export const percentCommission = (netShare: string, percent: string) => new Decimal(netShare).times(percent).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
export const withinDuration = (convertedAt: string, paymentDate: string, months: number) => { const a = new Date(`${convertedAt.slice(0, 10)}T00:00:00Z`), b = new Date(`${paymentDate.slice(0, 10)}T00:00:00Z`); const end = new Date(a); end.setUTCMonth(end.getUTCMonth() + months); return b >= a && b <= end; };

export const COMMISSION_STATES = ["accrued", "approved", "paid", "cancelled"] as const;
export type CommissionState = (typeof COMMISSION_STATES)[number];
export interface CommissionCtx { actorUserId: string; referralCreatedBy: string }
export const commissionWorkflow = new StateMachine<CommissionState, CommissionCtx>([
  { from: "accrued", to: "approved", event: "approve", allowedRoles: ["tenant_admin", "finance"], guard: c => (c.actorUserId === c.referralCreatedBy ? "quatre yeux : l'auteur du parrainage ne peut pas approuver sa commission" : null) },
  { from: "approved", to: "paid", event: "pay", allowedRoles: ["tenant_admin", "finance"] },
  { from: "accrued", to: "cancelled", event: "cancel", allowedRoles: ["tenant_admin", "finance"] },
  { from: "approved", to: "cancelled", event: "cancel", allowedRoles: ["tenant_admin", "finance"] },
]);

// ---------- Campagnes ----------
export const CAMPAIGN_STATES = ["draft", "active", "ended"] as const;
export type CampaignState = (typeof CAMPAIGN_STATES)[number];
export const campaignWorkflow = new StateMachine<CampaignState, Record<string, never>>([
  { from: "draft", to: "active", event: "launch", allowedRoles: ["tenant_admin", "commerce"] },
  { from: "active", to: "ended", event: "end", allowedRoles: ["tenant_admin", "commerce"] },
  { from: "draft", to: "ended", event: "end", allowedRoles: ["tenant_admin", "commerce"] },
]);
