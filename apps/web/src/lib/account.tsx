"use client";
import { nf } from "./ui";

export type Statement = { consultant: string; period: string; disclaimer: string; invoicedNet: string; collectedNet: string; managementFee: string | null; expensesReimbursed: string; balanceBeforeSocialAndSalary: string | null; feeStatus: string;
  movements: { invoices: { number: string; issueDate: string; net: string }[]; payments: { invoice: string; receivedOn: string; amount: string }[]; expenses: { title: string; reimbursedAt: string; total: string }[] };
  parametersUsed: { key: string; value: string; unit: string; source: string; validFrom: string }[] };

export function StatementView({ s }: { s: Statement }) {
  return (
    <>
      <div className="alert a-warning" role="note"><span><b>Estimation.</b> {s.disclaimer}</span></div>
      {s.feeStatus === "parameter_missing" && <div className="alert a-danger" role="alert"><span>Frais de gestion non calculés : aucun paramètre approuvé « management_fee_rate_percent » à la date des encaissements. Le solde n’est pas affiché plutôt que d’être estimé à tort.</span></div>}
      <section className="card" aria-label={`Compte d'activité ${s.period}`}>
        <div className="card-h"><h2>{s.consultant} — {s.period}</h2></div>
        <div className="card-b calc">
          <div><span>Chiffre d’affaires facturé HT (factures émises ce mois)</span><b className="num">{nf(s.invoicedNet)}</b></div>
          <div><span>Encaissements HT (quote-part HT des paiements reçus)</span><b className="num">{nf(s.collectedNet)}</b></div>
          <div><span>Frais de gestion</span><b className="num">{s.managementFee === null ? "non calculés" : `− ${nf(s.managementFee)}`}</b></div>
          <div><span>Notes de frais remboursées</span><b className="num">− {nf(s.expensesReimbursed)}</b></div>
          <div className="total"><span>Solde avant charges sociales et salaire (estimation)</span><b className="num">{s.balanceBeforeSocialAndSalary === null ? "—" : nf(s.balanceBeforeSocialAndSalary)}</b></div>
        </div>
      </section>
      <section className="card" aria-labelledby="mv"><div className="card-h"><h2 id="mv">D’où viennent ces montants ?</h2></div>
        <div className="card-b stack small">
          {s.movements.payments.map((p, i) => <div key={i}>Paiement reçu le {p.receivedOn} sur la facture {p.invoice} : {nf(p.amount)} TTC</div>)}
          {s.movements.invoices.map((p, i) => <div key={i}>Facture {p.number} émise le {p.issueDate} : {nf(p.net)} HT</div>)}
          {s.movements.expenses.map((p, i) => <div key={i}>Frais « {p.title} » remboursés le {p.reimbursedAt} : {nf(p.total)}</div>)}
          {!s.movements.payments.length && !s.movements.invoices.length && !s.movements.expenses.length && <span className="muted">Aucun mouvement ce mois-ci.</span>}
          {s.parametersUsed.map((p, i) => <div key={i} className="muted">Paramètre {p.key} = {p.value} {p.unit} (depuis le {p.validFrom}) — source : {p.source}</div>)}
        </div></section>
    </>
  );
}
