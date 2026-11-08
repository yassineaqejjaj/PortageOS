import { BadRequestException, Injectable } from "@nestjs/common";
import Decimal from "decimal.js";
import { AGING_BUCKETS, agingBucket, cohortMatrix, daysBetween, daysInMonths, dso, monthRange } from "@portage/domain";
import { Tx } from "./prisma.service";
import { ParametersService } from "./parameters.service";
import { parisToday } from "./workflow";

const FEE_KEY = "management_fee_rate_percent";
const D = (v: unknown) => new Decimal(String(v));
const f2 = (d: Decimal) => d.toFixed(2);

export const DEFINITIONS = {
  invoicedNet: "Somme des montants HT des factures émises (hors annulées et avoirées) dont la date d'émission est dans le mois. Source : factures.",
  invoicedGross: "Même périmètre, montants TTC.",
  collectedNet: "Quote-part HT de chaque encaissement reçu dans le mois (montant × HT/TTC de la facture, arrondi au centime), hors factures annulées ou avoirées. Source : encaissements saisis.",
  managementFee: "Pour chaque encaissement : quote-part HT × taux de frais de gestion approuvé à la date de réception. Indisponible si le paramètre « management_fee_rate_percent » manque à une date.",
  outstanding: "Créances ouvertes TTC à la date de référence : TTC − encaissé des factures émises ou partiellement payées. Source : factures.",
  aging: "Ancienneté depuis la date d'ÉMISSION (aucune échéance de paiement n'est gérée à ce jour), par tranche 0-30, 31-60, 61-90, 91+ jours.",
  dso: "DSO simple = créances ouvertes à la date de référence / facturation TTC de la période × nombre de jours de la période. Non calculé si rien n'a été facturé.",
  conversion: "Prospects convertis / prospects créés dans la période (par date de création).",
  clientApprovalDelay: "Délai moyen en jours entre la soumission d'un CRA et son approbation par le client, mesuré dans le journal d'audit (approbations de la période).",
  backlog: "Valeur HT à partir du TJM de la mission × jours déclarés : « à facturer » = CRA validés sans facture ; « en cours » = CRA soumis ou approuvés par le client, non encore validés. Ce n'est pas une prévision de chiffre d'affaires.",
  cohorts: "Consultants regroupés par mois de création du dossier ; chaque case = nombre de consultants distincts ayant au moins une facture émise N mois après le mois de création.",
  activeConsultants: "Dossiers consultants au statut actif à la date de référence.",
} as const;

@Injectable()
export class PilotageService {
  constructor(private params: ParametersService) {}

  async overview(tx: Tx, tenantId: string, from: string, to: string, asOfIn?: string) {
    let months: string[]; try { months = monthRange(from, to); } catch (e) { throw new BadRequestException((e as Error).message); }
    const asOf = asOfIn ?? parisToday();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new BadRequestException("asOf : AAAA-MM-JJ");
    const days = daysInMonths(months);
    const start = new Date(`${from}-01`); const endEx = new Date(`${months[months.length - 1]}-01`); endEx.setUTCMonth(endEx.getUTCMonth() + 1);
    const monthOf = (d: Date) => d.toISOString().slice(0, 7);

    const missions = await tx.mission.findMany({ select: { id: true, consultantId: true, dailyRate: true, status: true } });
    const consultantOf = new Map(missions.map(m => [m.id, m.consultantId]));
    const billable = { in: ["issued", "partially_paid", "paid"] };

    // --- facturation par mois
    const inv = await tx.invoice.findMany({ where: { status: billable, issueDate: { gte: start, lt: endEx } } });
    const series = new Map(months.map(m => [m, { month: m, invoicedNet: D(0), invoicedGross: D(0), collectedNet: D(0), managementFee: D(0) as Decimal | null }]));
    for (const i of inv) { const s = series.get(monthOf(i.issueDate!))!; s.invoicedNet = s.invoicedNet.plus(i.net.toString()); s.invoicedGross = s.invoicedGross.plus(i.gross.toString()); }

    // --- encaissements et frais de gestion (par encaissement, au taux en vigueur à sa date)
    const pays = await tx.payment.findMany({ where: { receivedOn: { gte: start, lt: endEx }, invoice: { status: { notIn: ["credited", "cancelled"] } } }, include: { invoice: true } });
    let feeMissing = false;
    for (const p of pays) {
      const s = series.get(monthOf(p.receivedOn))!;
      const net = D(p.amount).times(p.invoice.net.toString()).div(p.invoice.gross.toString()).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      s.collectedNet = s.collectedNet.plus(net);
      const rate = await this.params.at(tx, FEE_KEY, p.receivedOn.toISOString().slice(0, 10));
      if (!rate) { feeMissing = true; s.managementFee = null; }
      else if (s.managementFee) s.managementFee = s.managementFee.plus(net.times(rate.value).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
    }
    const rows = [...series.values()].map(s => ({ month: s.month, invoicedNet: f2(s.invoicedNet), invoicedGross: f2(s.invoicedGross), collectedNet: f2(s.collectedNet), managementFee: s.managementFee ? f2(s.managementFee) : null }));
    const sum = (k: "invoicedNet" | "invoicedGross" | "collectedNet") => f2(rows.reduce((t, r) => t.plus(r[k]), D(0)));

    // --- créances et ancienneté (toutes périodes, à la date de référence)
    const open = await tx.invoice.findMany({ where: { status: { in: ["issued", "partially_paid"] }, issueDate: { lte: new Date(asOf) } } });
    let outstanding = D(0); const aging = new Map<string, Decimal>(AGING_BUCKETS.map(b => [b, D(0)]));
    for (const i of open) { const due = D(i.gross.toString()).minus(i.paid.toString()); outstanding = outstanding.plus(due); const b = agingBucket(daysBetween(i.issueDate!.toISOString().slice(0, 10), asOf)); aging.set(b, aging.get(b)!.plus(due)); }

    // --- portefeuille, pipeline, opérations
    const cons = await tx.consultant.findMany({ select: { id: true, firstName: true, lastName: true, status: true, createdAt: true }, take: 1000 });
    const byStatus = (s: string) => cons.filter(c => c.status === s).length;
    const prospects = await tx.prospect.findMany({ where: { createdAt: { gte: start, lt: endEx } }, select: { stage: true } });
    const stages = Object.fromEntries(["new", "contacted", "qualified", "converted", "lost"].map(s => [s, prospects.filter(p => p.stage === s).length]));
    const conversion = prospects.length ? D(stages.converted!).div(prospects.length).times(100).toDecimalPlaces(1).toFixed(1) : null;
    const tsAll = await tx.timesheet.findMany({ where: { status: { in: ["submitted", "client_approved", "client_rejected", "validated"] } }, include: { lines: true } });
    const tsCount = (s: string) => tsAll.filter(t => t.status === s).length;
    const value = (ts: typeof tsAll) => f2(ts.reduce((t, x) => t.plus(x.lines.reduce((d, l) => d.plus(l.quantity.toString()), D(0)).times(missions.find(m => m.id === x.missionId)?.dailyRate.toString() ?? "0")), D(0)));
    const uninvoicedValidated = (await Promise.all(tsAll.filter(t => t.status === "validated").map(async t => ({ t, inv: await tx.invoice.findUnique({ where: { timesheetId: t.id }, select: { id: true } }) })))).filter(x => !x.inv).map(x => x.t);
    const delay = await tx.$queryRaw<{ avg: unknown }[]>`
      SELECT AVG(EXTRACT(EPOCH FROM (a."at" - s.submitted)) / 86400) AS avg
      FROM "AuditEvent" a
      JOIN LATERAL (SELECT MAX(x."at") AS submitted FROM "AuditEvent" x WHERE x."entityId" = a."entityId" AND x.action = 'timesheet.submit' AND x."at" <= a."at") s ON s.submitted IS NOT NULL
      WHERE a.action = 'timesheet.approve' AND a."tenantId" = ${tenantId} AND a."at" >= ${start} AND a."at" < ${endEx}`;
    const avgDelay = delay[0]?.avg === null || delay[0]?.avg === undefined ? null : D(delay[0].avg).toDecimalPlaces(1).toFixed(1);

    // --- cohortes et classement consultants
    const billedAll = await tx.invoice.findMany({ where: { status: billable, issueDate: { not: null } }, select: { missionId: true, issueDate: true } });
    const cohorts = cohortMatrix(cons.map(c => ({ id: c.id, createdMonth: monthOf(c.createdAt) })), billedAll.filter(b => consultantOf.has(b.missionId)).map(b => ({ consultantId: consultantOf.get(b.missionId)!, month: monthOf(b.issueDate!) })), 6);
    const per = new Map<string, Decimal>();
    for (const i of inv) { const c = consultantOf.get(i.missionId); if (c) per.set(c, (per.get(c) ?? D(0)).plus(i.net.toString())); }
    const top = [...per.entries()].sort((a, b) => b[1].comparedTo(a[1])).slice(0, 5).map(([id, v]) => { const c = cons.find(x => x.id === id); return { consultantId: id, name: c ? `${c.firstName} ${c.lastName}` : id, invoicedNet: f2(v) }; });

    return {
      period: { from, to, days, asOf }, definitions: DEFINITIONS,
      totals: { invoicedNet: sum("invoicedNet"), invoicedGross: sum("invoicedGross"), collectedNet: sum("collectedNet"), managementFee: feeMissing ? null : f2(rows.reduce((t, r) => t.plus(r.managementFee ?? 0), D(0))) },
      feeStatus: feeMissing ? "parameter_missing" : pays.length ? "computed" : "no_collection",
      series: rows,
      receivables: { outstanding: f2(outstanding), aging: AGING_BUCKETS.map(b => ({ bucket: b, amount: f2(aging.get(b)!) })), dso: dso(f2(outstanding), sum("invoicedGross"), days) },
      portfolio: { activeConsultants: byStatus("active"), onboardingConsultants: byStatus("onboarding"), activeMissions: missions.filter(m => m.status === "active").length },
      pipeline: { created: prospects.length, stages, conversionRatePercent: conversion },
      operations: { timesheets: { submitted: tsCount("submitted"), clientApproved: tsCount("client_approved"), clientRejected: tsCount("client_rejected"), validatedNotInvoiced: uninvoicedValidated.length },
        pendingExpenses: await tx.expenseClaim.count({ where: { status: "submitted" } }), pendingLeaves: await tx.leaveRequest.count({ where: { status: "submitted" } }), avgClientApprovalDelayDays: avgDelay },
      backlog: { toInvoiceNet: value(uninvoicedValidated), inProgressNet: value(tsAll.filter(t => ["submitted", "client_approved"].includes(t.status))), note: DEFINITIONS.backlog },
      cohorts, topConsultants: top,
      notApplicable: ["MRR SaaS (aucune facturation d'abonnement n'existe)", "Performance des équipes (indicateur non défini)", "Prévisions statistiques (non implémentées)"],
    };
  }
}
