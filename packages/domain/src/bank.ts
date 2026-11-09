import Decimal from "decimal.js";
import { parseCsv } from "./crm";

/** Import de relevés bancaires CSV : analyse pure, sans effet. Aucun format de banque n'est supposé : le mappage est déduit des en-têtes et vérifiable. */
export interface BankMapping { date?: string; label?: string; amount?: string; debit?: string; credit?: string; reference?: string }
export interface BankRow { line: number; date: string; label: string; amount: string; reference?: string }
export interface BankLineError { line: number; errors: string[] }

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
export function suggestBankMapping(headers: string[]): BankMapping {
  const pick = (...keys: string[]) => headers.find(h => keys.some(k => norm(h).includes(k)));
  return { date: pick("datedoperation", "dateoperation", "datevaleur", "date"), label: pick("libelle", "label", "description", "intitule", "motif"), amount: pick("montant", "amount"), debit: pick("debit"), credit: pick("credit"), reference: pick("reference", "ref", "numero") };
}
/** « 1 234,56 », « 1.234,56 », « -12,5 », « 1234.56 » → Decimal, ou null si ambigu/invalide. */
export function parseAmount(raw: string): Decimal | null {
  let s = raw.trim().replace(/[\s €]/g, ""); if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-"); s = s.replace(/^[-+(]|\)$/g, "");
  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) { const dec = Math.max(lastComma, lastDot); s = s.slice(0, dec).replace(/[.,]/g, "") + "." + s.slice(dec + 1); }
  else if (lastComma >= 0) { if (s.split(",").length > 2) return null; s = s.replace(",", "."); }
  else if ((s.match(/\./g) ?? []).length > 1) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const d = new Decimal(s); return neg ? d.neg() : d;
}
export function parseBankDate(raw: string): string | null {
  const s = raw.trim(); let y = "", m = "", d = "";
  const iso8601 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s), fr = /^(\d{2})[/.-](\d{2})[/.-](\d{4})$/.exec(s);
  if (iso8601) { y = iso8601[1]!; m = iso8601[2]!; d = iso8601[3]!; } else if (fr) { d = fr[1]!; m = fr[2]!; y = fr[3]!; } else return null;
  const iso = `${y}-${m}-${d}`; const t = new Date(`${iso}T00:00:00Z`); return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso ? null : iso;
}
export function parseBankCsv(csv: string, mapping?: BankMapping, maxRows = 5000) {
  const p = parseCsv(csv, maxRows); const map = { ...suggestBankMapping(p.headers), ...(mapping ?? {}) } as BankMapping;
  for (const h of Object.values(map)) if (h && !p.headers.includes(h)) throw new Error(`Colonne inconnue dans le mappage : ${h}`);
  if (!map.date || !map.label || !(map.amount || map.credit || map.debit)) throw new Error("Colonnes date, libellé et montant (ou débit/crédit) introuvables : précisez le mappage");
  const rows: BankRow[] = []; const errors: BankLineError[] = [];
  p.rows.forEach((r, i) => {
    const line = i + 2; const errs: string[] = [];
    const date = parseBankDate(r[map.date!] ?? ""); if (!date) errs.push("date invalide (AAAA-MM-JJ ou JJ/MM/AAAA)");
    const label = (r[map.label!] ?? "").trim(); if (!label) errs.push("libellé manquant");
    let amount: Decimal | null = null;
    if (map.amount) amount = parseAmount(r[map.amount] ?? "");
    else { const c = map.credit ? parseAmount(r[map.credit] ?? "") : null, d = map.debit ? parseAmount(r[map.debit] ?? "") : null; amount = c && !c.isZero() ? c.abs() : d && !d.isZero() ? d.abs().neg() : null; }
    if (!amount || amount.isZero()) errs.push("montant invalide ou nul");
    if (errs.length) errors.push({ line, errors: errs }); else rows.push({ line, date: date!, label, amount: amount!.toFixed(2), ...(map.reference && r[map.reference] ? { reference: r[map.reference]!.slice(0, 100) } : {}) });
  });
  return { mapping: map, rows, errors, rowsTotal: p.rows.length };
}

export interface OpenInvoice { id: string; number: string; remaining: string }
export type Confidence = "reference" | "amount";
/** Propositions de rapprochement pour un crédit : jamais appliquées automatiquement. */
export function suggestMatches(tx: { amount: string; label: string; reference?: string | null }, invoices: OpenInvoice[]): { invoiceId: string; number: string; confidence: Confidence; fullySettles: boolean }[] {
  const amt = new Decimal(tx.amount); if (amt.lte(0)) return [];
  const text = `${tx.label} ${tx.reference ?? ""}`.toLowerCase().replace(/\s+/g, "");
  const byRef = invoices.filter(i => i.number && text.includes(i.number.toLowerCase().replace(/\s+/g, "")) && amt.lte(i.remaining));
  if (byRef.length) return byRef.map(i => ({ invoiceId: i.id, number: i.number, confidence: "reference" as const, fullySettles: amt.eq(i.remaining) }));
  const exact = invoices.filter(i => amt.eq(i.remaining));
  return exact.length === 1 ? [{ invoiceId: exact[0]!.id, number: exact[0]!.number, confidence: "amount" as const, fullySettles: true }] : []; // plusieurs factures de même solde : ambigu, aucune proposition
}
