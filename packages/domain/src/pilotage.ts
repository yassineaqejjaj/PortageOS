import Decimal from "decimal.js";

/** Mois AAAA-MM de `from` à `to` inclus. */
export function monthRange(from: string, to: string): string[] {
  const ok = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
  if (!ok(from) || !ok(to)) throw new Error("Période invalide (AAAA-MM)");
  if (from > to) throw new Error("Le début suit la fin");
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  for (;;) {
    const cur = `${y}-${String(m).padStart(2, "0")}`; out.push(cur);
    if (cur === to) break;
    if (out.length > 36) throw new Error("Période trop longue (36 mois max)");
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
export const monthDiff = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));
export function daysInMonths(months: string[]): number {
  return months.reduce((s, m) => s + new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate(), 0);
}

/** Ancienneté depuis l'ÉMISSION (aucune échéance de paiement n'est gérée à ce jour). */
export const AGING_BUCKETS = ["0-30", "31-60", "61-90", "91+"] as const;
export function agingBucket(days: number): (typeof AGING_BUCKETS)[number] {
  if (days < 0) throw new Error("Date d'émission postérieure à la date de référence");
  return days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "91+";
}
export const daysBetween = (fromIso: string, toIso: string) => Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);

/** DSO « simple » = créances ouvertes TTC / facturation TTC de la période × jours de la période. Null si rien n'a été facturé. */
export function dso(receivables: string, invoicedGross: string, days: number): string | null {
  const g = new Decimal(invoicedGross);
  if (g.lte(0)) return null;
  return new Decimal(receivables).div(g).times(days).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toFixed(1);
}

/** Cohortes : consultants regroupés par mois de création ; offset = mois écoulés depuis ce mois ; compte les consultants distincts facturés. */
export function cohortMatrix(consultants: { id: string; createdMonth: string }[], invoiced: { consultantId: string; month: string }[], horizon: number) {
  const cohorts = [...new Set(consultants.map(c => c.createdMonth))].sort();
  return cohorts.map(cohort => {
    const members = consultants.filter(c => c.createdMonth === cohort);
    const active: number[] = Array.from({ length: horizon + 1 }, () => 0);
    for (let off = 0; off <= horizon; off++) {
      active[off] = members.filter(m => invoiced.some(i => i.consultantId === m.id && monthDiff(cohort, i.month) === off)).length;
    }
    return { cohort, size: members.length, billedByOffset: active };
  });
}

/** CSV (séparateur « ; » pour Excel FR) avec protection contre l'injection de formules. */
export function csvCell(v: string | number | null): string {
  let s = v === null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (rows: (string | number | null)[][]) => rows.map(r => r.map(csvCell).join(";")).join("\r\n") + "\r\n";
