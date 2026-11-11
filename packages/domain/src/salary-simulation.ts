/**
 * Simulation de rémunération « B&G Partner » (règles pures, aucune E/S).
 * Reproduit la feuille de calcul de référence : les TAUX ne sont jamais en dur ici, ils sont fournis par le catalogue de
 * paramètres (datés, sourcés, approuvés). Le résultat est une ESTIMATION NON CONTRACTUELLE, jamais un bulletin de paie.
 *
 *   Rémunération (enveloppe annuelle) = TJM × jours/an × (1 − frais de gestion %)
 *   Frais professionnels (mensuels)   = frais forfaitaires journaliers × jours/mois
 *   Brut mensuel                      = brut annuel ÷ 12
 *   Net avant PAS                     = brut mensuel × ratio net/brut
 *   Taux PAS                          = taux de la première tranche dont le seuil ≥ net avant PAS (au-delà : taux maximal)
 *   Net après PAS                     = net avant PAS × (1 − taux PAS)
 *   Net perçu / mois                  = net après PAS + frais professionnels + mutuelle
 *   Jour de congé non pris            = brut annuel ÷ diviseur (salaire) + frais journaliers (frais)
 *   Taux de rentabilité (INTERNE)     = (CA − brut×(1+charges patronales) − frais×12 − mutuelle×12) ÷ CA, CA = TJM × jours/an
 */
import Decimal from "decimal.js";

export interface PasBracket { upTo: string; ratePercent: string }
export interface SalaryParams {
  workingDaysPerYear: string; managementFeePercent: string; netToGrossPercent: string;
  paidLeaveDays: string; leaveDayDivisor: string; pasGrid: PasBracket[]; pasTopRatePercent: string;
  /** Charges patronales (% du brut) : absent = rentabilité non calculée (jamais de valeur par défaut). */
  employerChargesPercent?: string;
}
export interface SalaryInput { tjm: string; daysPerMonth: string; dailyExpenses: string; mutualMonthly: string; grossAnnual: string }

const D = (v: string | Decimal) => new Decimal(v);
const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

/** Taux de PAS : première tranche (triée par seuil croissant) dont le seuil est ≥ au net ; sinon taux maximal. */
export function pasRate(net: string, grid: PasBracket[], top: string): string {
  const n = D(net);
  const hit = [...grid].sort((a, b) => D(a.upTo).cmp(D(b.upTo))).find(b => n.lte(b.upTo));
  return (hit ? hit.ratePercent : top);
}

export function simulateSalary(i: SalaryInput, p: SalaryParams) {
  const tjm = D(i.tjm), dpm = D(i.daysPerMonth), exp = D(i.dailyExpenses), mut = D(i.mutualMonthly), gross = D(i.grossAnnual);
  if (tjm.lte(0)) throw new Error("TJM invalide");
  if (dpm.lte(0) || dpm.gt(31) || !dpm.mul(2).isInteger()) throw new Error("Jours par mois : multiple de 0,5 entre 0,5 et 31");
  if (exp.lt(0) || mut.lt(0)) throw new Error("Frais et mutuelle ne peuvent pas être négatifs");
  if (gross.lte(0)) throw new Error("Salaire brut annuel invalide");
  if (!p.pasGrid.length) throw new Error("Grille de prélèvement à la source absente");
  const fee = D(p.managementFeePercent); if (fee.lt(0) || fee.gt(100)) throw new Error("Frais de gestion invalides");

  const envelope = tjm.mul(p.workingDaysPerYear).mul(D("100").minus(fee)).div(100);
  const professionalExpenses = exp.mul(dpm);
  const grossMonthly = gross.div(12);
  const netBeforePas = grossMonthly.mul(p.netToGrossPercent).div(100);
  const rate = pasRate(r2(netBeforePas), p.pasGrid, p.pasTopRatePercent);
  const netAfterPas = netBeforePas.mul(D("100").minus(rate)).div(100);
  const netPaid = D(r2(netAfterPas)).plus(r2(professionalExpenses)).plus(mut);
  const salaryPerLeaveDay = gross.div(p.leaveDayDivisor);
  const totalPerLeaveDay = salaryPerLeaveDay.plus(exp);
  const annualCommitted = gross.plus(professionalExpenses.mul(12)).plus(mut.mul(12));
  if (annualCommitted.gt(envelope)) throw new Error("Brut annuel + frais + mutuelle dépassent la rémunération (enveloppe) annuelle : scénario impossible");
  const revenue = tjm.mul(p.workingDaysPerYear);
  const margin = p.employerChargesPercent === undefined ? null : revenue.minus(gross.mul(D("100").plus(p.employerChargesPercent)).div(100)).minus(professionalExpenses.mul(12)).minus(mut.mul(12));
  return {
    variables: { tjm: r2(tjm), daysPerMonth: dpm.toString(), dailyExpenses: r2(exp), mutualMonthly: r2(mut), daysPerYear: String(p.workingDaysPerYear), feePercent: fee.toString() },
    envelope: r2(envelope), professionalExpenses: r2(professionalExpenses), grossAnnual: r2(gross), grossMonthly: r2(grossMonthly),
    netBeforePas: r2(netBeforePas), pasRatePercent: D(rate).toFixed(2), netAfterPas: r2(netAfterPas), netPaidMonthly: r2(netPaid),
    paidLeaveDays: String(p.paidLeaveDays), salaryPerLeaveDay: r2(salaryPerLeaveDay), expensesPerLeaveDay: r2(exp), totalPerLeaveDay: r2(totalPerLeaveDay),
    extraForUntakenLeave: r2(totalPerLeaveDay.mul(p.paidLeaveDays)),
    /** Indicateur interne (jamais transmis au destinataire) : enveloppe restante après brut, frais et mutuelle annuels. */
    internalRemainingEnvelope: r2(envelope.minus(annualCommitted)),
    /** Rentabilité de la société (INTERNE, jamais transmise) : marge annuelle après charges patronales et son taux sur le CA. null si le paramètre de charges est absent. */
    internalMargin: margin ? r2(margin) : null,
    internalProfitabilityPercent: margin ? r2(margin.div(revenue).mul(100)) : null,
  };
}
export type SalarySimulation = ReturnType<typeof simulateSalary>;
