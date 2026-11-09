import Decimal from "decimal.js";

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const isValidAccountCode = (c: string) => /^[1-9]\d{2,7}$/.test(c);
export const periodOf = (isoDate: string) => isoDate.slice(0, 7);

/** Solde d'un compte : débiteur ou créditeur (jamais les deux). */
export function accountBalance(debit: string, credit: string): { debit: string; credit: string } {
  const d = new Decimal(debit).minus(credit);
  return d.gte(0) ? { debit: d.toFixed(2), credit: "0.00" } : { debit: "0.00", credit: d.abs().toFixed(2) };
}

// ---------- Export au format des colonnes du FEC ----------
export const FEC_COLUMNS = ["JournalCode", "JournalLib", "EcritureNum", "EcritureDate", "CompteNum", "CompteLib", "CompAuxNum", "CompAuxLib", "PieceRef", "PieceDate", "EcritureLib", "Debit", "Credit", "EcritureLet", "DateLet", "ValidDate", "Montantdevise", "Idevise"] as const;
export const JOURNALS: Record<string, string> = { VT: "Journal des ventes", BQ: "Journal de banque", OD: "Opérations diverses" };
export function journalCode(sourceType: string): "VT" | "BQ" | "OD" {
  return sourceType === "invoice" || sourceType === "credit_note" ? "VT" : sourceType === "payment" || sourceType === "expense" || sourceType === "commission" ? "BQ" : "OD";
}
export const fecDate = (iso: string) => iso.slice(0, 10).replace(/-/g, "");
export const fecAmount = (v: string | number | Decimal) => new Decimal(v).toFixed(2).replace(".", ",");
const clean = (s: string) => s.replace(/[\t\r\n|]/g, " ").trim(); // séparateurs interdits dans les libellés

export interface FecEntry { id: string; valueDate: string; createdDate: string; sourceType: string; sourceId: string; label: string; lines: { account: string; debit: string; credit: string }[]; validDate?: string }
/** Une ligne FEC par ligne d'écriture ; numérotation séquentielle continue des écritures dans l'ordre fourni. */
export function fecRows(entries: FecEntry[], labels: Record<string, string>): string[][] {
  const rows: string[][] = [];
  entries.forEach((e, i) => {
    const jc = journalCode(e.sourceType);
    for (const l of e.lines) rows.push([jc, JOURNALS[jc]!, String(i + 1), fecDate(e.valueDate), l.account, clean(labels[l.account] ?? l.account), "", "", clean(e.sourceId.slice(0, 20)), fecDate(e.createdDate), clean(e.label), fecAmount(l.debit), fecAmount(l.credit), "", "", e.validDate ? fecDate(e.validDate) : "", "", ""]);
  });
  return rows;
}
export const toFecText = (rows: string[][]) => [FEC_COLUMNS.join("\t"), ...rows.map(r => r.join("\t"))].join("\r\n") + "\r\n";
