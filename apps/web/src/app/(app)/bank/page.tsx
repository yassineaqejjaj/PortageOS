"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDate, fmtEUR } from "@/lib/format";
import { ErrorBox, Forbidden, isForbidden } from "@/lib/ui";

type Preview = { id: string; rowsTotal: number; rowsValid: number; rowsInvalid: number; credits: number; debits: number; errors: { line: number; errors: string[] }[]; mapping: Record<string, string | undefined> };
type Tx = { id: string; date: string; label: string; reference: string | null; amount: string; suggestions: { invoiceId: string; number: string; confidence: "reference" | "amount"; fullySettles: boolean }[] };
type Inv = { id: string; number: string | null; status: string; gross: string; paid: string };

export default function BankPage() {
  const qc = useQueryClient();
  const txs = useQuery({ queryKey: ["bank-tx"], queryFn: () => api<Tx[]>("bank/transactions?status=unmatched") });
  const invoices = useQuery({ queryKey: ["invoices-open"], queryFn: () => api<Inv[]>("invoices") });
  const open = invoices.data?.filter(i => (i.status === "issued" || i.status === "partially_paid") && i.number) ?? [];
  const [csv, setCsv] = useState(""); const [fileName, setFileName] = useState(""); const [pv, setPv] = useState<Preview | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({}); const [ignoring, setIgnoring] = useState<{ id: string; v: string } | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["bank-tx"] }); qc.invalidateQueries({ queryKey: ["invoices-open"] }); };
  const prev = useMutation({ mutationFn: () => api<Preview>("bank/imports/preview", { method: "POST", body: { csv, fileName } }), onSuccess: setPv });
  const act = useMutation({ mutationFn: (a: { id: string; ev: "commit" | "cancel" }) => api(`bank/imports/${a.id}/${a.ev}`, { method: "POST", body: {} }), onSuccess: () => { setPv(null); setCsv(""); setFileName(""); refresh(); } });
  const match = useMutation({ mutationFn: (a: { id: string; invoiceId: string }) => api(`bank/transactions/${a.id}/match`, { method: "POST", body: { invoiceId: a.invoiceId } }), onSuccess: refresh });
  const ignore = useMutation({ mutationFn: (a: { id: string; reason: string }) => api(`bank/transactions/${a.id}/ignore`, { method: "POST", body: { reason: a.reason } }), onSuccess: () => { setIgnoring(null); refresh(); } });
  async function onFile(f: File | undefined) { if (!f) return; if (f.size > 1_000_000) { alert("Fichier trop volumineux (1 Mo maximum)."); return; } setFileName(f.name); setCsv(await f.text()); setPv(null); }
  if (isForbidden(txs.error)) return <><h1>Rapprochement bancaire</h1><Forbidden what="le rapprochement bancaire" /></>;
  return (
    <>
      <h1>Rapprochement bancaire</h1>
      <div className="alert a-info" role="note"><span>Aucune banque n'est connectée : vous importez un relevé CSV. Les propositions ne sont jamais appliquées automatiquement ; chaque rapprochement est votre décision et crée l'encaissement et son écriture comptable.</span></div>
      <div className="split">
        <section className="card main" aria-labelledby="b-liste">
          <div className="card-h"><h2 id="b-liste">Crédits à rapprocher</h2>{txs.data && <span className="count">{txs.data.length}</span>}</div>
          <ErrorBox error={isForbidden(txs.error) ? null : txs.error ?? match.error ?? ignore.error} prefix="Opération impossible" />
          {txs.data?.length === 0 && <div className="card-b muted">Aucun crédit en attente. Importez un relevé.</div>}
          {txs.data && txs.data.length > 0 && <div className="tbl-wrap"><table className="tbl compact">
            <thead><tr><th scope="col">Date</th><th scope="col">Libellé</th><th scope="col">Montant</th><th scope="col">Rapprochement</th></tr></thead>
            <tbody>{txs.data.map(t => <tr key={t.id}>
              <td className="num">{fmtDate(t.date)}</td><td>{t.label}{t.reference && <div className="small muted">{t.reference}</div>}</td><td className="num"><b>{fmtEUR(t.amount)}</b></td>
              <td>
                {t.suggestions.map(s => <div key={s.invoiceId} className="row" style={{ gap: 6, marginBottom: 4 }}>
                  <span className="small">Proposition : <b>{s.number}</b> ({s.confidence === "reference" ? "référence trouvée" : "même montant"}{s.fullySettles ? ", solde la facture" : ", encaissement partiel"})</span>
                  <button className="btn btn-secondary btn-sm" disabled={match.isPending} onClick={() => match.mutate({ id: t.id, invoiceId: s.invoiceId })}>Rapprocher</button></div>)}
                <div className="row" style={{ gap: 6 }}>
                  <label className="label" htmlFor={`p-${t.id}`} style={{ position: "absolute", left: -999 }}>Facture à rapprocher</label>
                  <select id={`p-${t.id}`} className="input" style={{ width: 200 }} value={pick[t.id] ?? ""} onChange={e => setPick({ ...pick, [t.id]: e.target.value })}><option value="">Autre facture…</option>{open.map(i => <option key={i.id} value={i.id}>{i.number} — reste {fmtEUR(Number(i.gross) - Number(i.paid))}</option>)}</select>
                  <button className="btn btn-ghost btn-sm" disabled={!pick[t.id] || match.isPending} onClick={() => match.mutate({ id: t.id, invoiceId: pick[t.id]! })}>Rapprocher</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setIgnoring({ id: t.id, v: "" })}>Ignorer</button></div>
                {ignoring?.id === t.id && <form className="row" style={{ marginTop: 6, gap: 6 }} onSubmit={e => { e.preventDefault(); ignore.mutate({ id: t.id, reason: ignoring.v }); }}>
                  <label className="label" htmlFor={`i-${t.id}`} style={{ position: "absolute", left: -999 }}>Motif</label>
                  <input id={`i-${t.id}`} className="input" placeholder="Motif (obligatoire)" value={ignoring.v} onChange={e => setIgnoring({ id: t.id, v: e.target.value })} minLength={3} required />
                  <button className="btn btn-danger btn-sm" type="submit" disabled={ignore.isPending}>Confirmer</button></form>}
              </td></tr>)}</tbody></table></div>}
        </section>
        <div className="side stack" style={{ gap: 16 }}>
          <form className="card" aria-labelledby="b-new" onSubmit={e => { e.preventDefault(); prev.mutate(); }}>
            <div className="card-h"><h2 id="b-new">Importer un relevé</h2></div>
            <div className="card-b stack" style={{ gap: 12 }}>
              <div className="field"><label className="label" htmlFor="bf">Fichier CSV</label><input id="bf" type="file" accept=".csv,text/csv" className="input" onChange={e => onFile(e.target.files?.[0])} /><span className="hint">Colonnes reconnues : date, libellé, montant (ou débit/crédit). 1 Mo maximum.</span></div>
              <ErrorBox error={prev.error} prefix="Aperçu impossible" />
            </div>
            <div className="card-f"><button type="submit" className="btn btn-primary" disabled={prev.isPending || !csv}>Lancer l'aperçu</button></div>
          </form>
          {pv && <section className="card" aria-labelledby="b-prev"><div className="card-h"><h2 id="b-prev">Aperçu</h2></div>
            <div className="card-b stack" style={{ gap: 8 }}>
              <div><b>{pv.rowsValid}</b> ligne(s) retenue(s) ({pv.credits} crédit(s), {pv.debits} débit(s)) · <b>{pv.rowsInvalid}</b> écartée(s)</div>
              {pv.errors.length > 0 && <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{pv.errors.map(e => <li key={e.line}>Ligne {e.line} : {e.errors.join(", ")}</li>)}</ul>}
              <div className="row" style={{ gap: 8 }}><button className="btn btn-primary" disabled={act.isPending || pv.rowsValid === 0} onClick={() => act.mutate({ id: pv.id, ev: "commit" })}>Importer {pv.rowsValid} ligne(s)</button>
                <button className="btn btn-ghost" disabled={act.isPending} onClick={() => act.mutate({ id: pv.id, ev: "cancel" })}>Abandonner</button></div>
              <ErrorBox error={act.error} prefix="Opération impossible" />
            </div></section>}
        </div>
      </div>
    </>
  );
}
