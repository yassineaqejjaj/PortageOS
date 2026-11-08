"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorBox, Forbidden, isForbidden, nf } from "@/lib/ui";

type TB = { account: string; debit: string; credit: string };
type Rec = { ledger411: string; invoicesOutstanding: string; receivablesMatch: boolean; totalDebit: string; totalCredit: string; journalBalanced: boolean };
const NAMES: Record<string, string> = { "411": "Clients", "706": "Prestations de services", "44571": "TVA collectée", "512": "Banque" };

export default function LedgerPage() {
  const tb = useQuery({ queryKey: ["ledger", "tb"], queryFn: () => api<TB[]>("ledger/trial-balance") });
  const rec = useQuery({ queryKey: ["ledger", "rec"], queryFn: () => api<Rec>("ledger/reconciliation") });
  if (isForbidden(tb.error)) return <><h1>Registre financier</h1><Forbidden what="le registre financier" /></>;
  return (
    <>
      <h1>Registre financier</h1>
      <ErrorBox error={tb.error ?? rec.error} prefix="Erreur" />
      {rec.data && (
        <div className="grid-2">
          <div className={`alert ${rec.data.journalBalanced ? "a-success" : "a-danger"}`} role="status"><span><b>Journal {rec.data.journalBalanced ? "équilibré" : "DÉSÉQUILIBRÉ"}</b> — débit {nf(rec.data.totalDebit)}, crédit {nf(rec.data.totalCredit)}</span></div>
          <div className={`alert ${rec.data.receivablesMatch ? "a-success" : "a-danger"}`} role="status"><span><b>Créances {rec.data.receivablesMatch ? "rapprochées" : "NON rapprochées"}</b> — compte 411 : {nf(rec.data.ledger411)}, factures ouvertes : {nf(rec.data.invoicesOutstanding)}</span></div>
        </div>)}
      <section className="card" aria-labelledby="b"><div className="card-h"><h2 id="b">Balance</h2></div>
        {tb.data?.length === 0 && <div className="empty"><h3>Aucune écriture</h3></div>}
        {!!tb.data?.length && <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th scope="col">Compte</th><th scope="col">Libellé</th><th scope="col" className="r">Débit</th><th scope="col" className="r">Crédit</th></tr></thead>
          <tbody>{tb.data.map(r => <tr key={r.account}><td className="mono">{r.account}</td><td>{NAMES[r.account] ?? ""}</td><td className="r num">{nf(r.debit)}</td><td className="r num">{nf(r.credit)}</td></tr>)}</tbody></table></div>}
      </section>
    </>
  );
}
