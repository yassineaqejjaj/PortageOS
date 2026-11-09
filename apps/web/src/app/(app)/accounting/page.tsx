"use client";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { download } from "@/lib/download";
import { ErrorBox, Forbidden, isForbidden, nf } from "@/lib/ui";

type Check = { code: string; message: string; count: number };
type Dossier = { period: string; checks: { status: string; blockers: Check[]; warnings: Check[] };
  balance: { rows: { account: string; label: string; movementDebit: string; movementCredit: string; endDebit: string; endCredit: string }[]; totals: { movementDebit: string; movementCredit: string; endDebit: string; endCredit: string }; balanced: boolean };
  vat: { rows: { month: string; baseHt: string; vatCollected: string }[]; totals: { baseHt: string; vatCollected: string }; note: string };
  thirdParties: { rows: { companyId: string; name: string; balance: string }[]; total: string; ledger411: string; match: boolean } };
type P = { period: string; status: string; entries: number };

export default function AccountingPage() {
  const qc = useQueryClient();
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [ack, setAck] = useState(false); const [reason, setReason] = useState(""); const [reopening, setReopening] = useState(false); const [exportErr, setExportErr] = useState<string | null>(null);
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ permissions: string[] }>("me") });
  const d = useQuery({ queryKey: ["dossier", period], queryFn: () => api<Dossier>(`accounting/dossier?period=${period}`), enabled: /^\d{4}-\d{2}$/.test(period) });
  const periods = useQuery({ queryKey: ["periods"], queryFn: () => api<P[]>("accounting/periods") });
  const refresh = () => { setAck(false); setReason(""); setReopening(false); qc.invalidateQueries({ queryKey: ["dossier"] }); qc.invalidateQueries({ queryKey: ["periods"] }); qc.invalidateQueries({ queryKey: ["ledger"] }); };
  const close = useMutation({ mutationFn: () => api(`accounting/periods/${period}/close`, { method: "POST", body: { acknowledgeWarnings: ack } }), onSuccess: refresh });
  const reopen = useMutation({ mutationFn: () => api(`accounting/periods/${period}/reopen`, { method: "POST", body: { reason } }), onSuccess: refresh });
  if (isForbidden(d.error)) return <><h1>Comptabilité</h1><Forbidden what="la comptabilité" /></>;
  const perms = me.data?.permissions ?? []; const c = d.data?.checks;
  async function exp(path: string, name: string) { setExportErr(await download(path, name)); }
  return (
    <>
      <div className="row between"><h1>Comptabilité</h1>
        <div className="row" style={{ gap: 8 }}>
          <Link className="btn btn-secondary" href="/accounting/journal">Journal et écritures</Link><Link className="btn btn-secondary" href="/accounting/chart">Plan comptable</Link>
          <div className="field"><label className="label small" htmlFor="p">Période</label><input id="p" className="input" type="month" value={period} onChange={e => setPeriod(e.target.value)} /></div></div></div>
      <ErrorBox error={d.error ?? close.error ?? reopen.error} prefix="Erreur" />{exportErr && <div className="alert a-danger" role="alert"><span>{exportErr}</span></div>}
      {d.data && c && (<>
        <section className="card" aria-labelledby="c"><div className="card-h"><h2 id="c">Clôture de {period}</h2><span className={`badge ${c.status === "closed" ? "b-success" : "b-warning"}`}>{c.status === "closed" ? "Période close" : "Période ouverte"}</span></div>
          <div className="card-b stack">
            {c.blockers.map(b => <div key={b.code} className="alert a-danger" role="alert"><span><b>Bloquant ({b.count}) :</b> {b.message}</span></div>)}
            {c.warnings.map(w => <div key={w.code} className="alert a-warning"><span><b>À examiner ({w.count}) :</b> {w.message}</span></div>)}
            {!c.blockers.length && !c.warnings.length && <p className="muted">Aucun point à signaler.</p>}
            {c.status === "open" && perms.includes("accounting.close") && (<>
              {!!c.warnings.length && !c.blockers.length && <label className="check"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} /> J’ai pris connaissance des points ci-dessus (ils seront conservés dans le journal d’audit)</label>}
              <div><button className="btn btn-primary" disabled={close.isPending || !!c.blockers.length || (!!c.warnings.length && !ack)} onClick={() => close.mutate()}>Clore la période {period}</button></div></>)}
            {c.status === "closed" && perms.includes("accounting.reopen") && (reopening
              ? <form className="row" style={{ gap: 8 }} onSubmit={e => { e.preventDefault(); reopen.mutate(); }}><label className="label" htmlFor="rr" style={{ position: "absolute", left: -999 }}>Motif de réouverture</label><input id="rr" className="input" style={{ width: 280 }} placeholder="Motif de réouverture (obligatoire)" value={reason} onChange={e => setReason(e.target.value)} required minLength={5} /><button className="btn btn-danger" disabled={reopen.isPending || reason.trim().length < 5}>Confirmer la réouverture</button><button type="button" className="btn btn-ghost" onClick={() => setReopening(false)}>Annuler</button></form>
              : <div><button className="btn btn-secondary" onClick={() => setReopening(true)}>Rouvrir la période</button></div>)}
          </div></section>
        <section className="card" aria-labelledby="b"><div className="card-h"><h2 id="b">Balance de {period}</h2><span className={`badge ${d.data.balance.balanced ? "b-success" : "b-danger"}`}>{d.data.balance.balanced ? "Équilibrée" : "DÉSÉQUILIBRÉE"}</span></div>
          {!d.data.balance.rows.length ? <div className="empty"><h3>Aucune écriture</h3></div> : <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th scope="col">Compte</th><th scope="col">Libellé</th><th scope="col" className="r">Mouvement débit</th><th scope="col" className="r">Mouvement crédit</th><th scope="col" className="r">Solde débiteur</th><th scope="col" className="r">Solde créditeur</th></tr></thead>
            <tbody>{d.data.balance.rows.map(r => <tr key={r.account}><td className="mono">{r.account}</td><td>{r.label}</td><td className="r num">{nf(r.movementDebit)}</td><td className="r num">{nf(r.movementCredit)}</td><td className="r num">{nf(r.endDebit)}</td><td className="r num">{nf(r.endCredit)}</td></tr>)}
              <tr><th scope="row" colSpan={2}>Totaux</th><td className="r num"><b>{nf(d.data.balance.totals.movementDebit)}</b></td><td className="r num"><b>{nf(d.data.balance.totals.movementCredit)}</b></td><td className="r num"><b>{nf(d.data.balance.totals.endDebit)}</b></td><td className="r num"><b>{nf(d.data.balance.totals.endCredit)}</b></td></tr></tbody></table></div>}</section>
        <div className="grid-2" style={{ alignItems: "start" }}>
          <section className="card" aria-labelledby="v"><div className="card-h"><h2 id="v">TVA collectée</h2></div><div className="card-b calc"><div><span>Base HT (compte 706)</span><b className="num">{nf(d.data.vat.totals.baseHt)}</b></div><div><span>TVA collectée (compte 44571)</span><b className="num">{nf(d.data.vat.totals.vatCollected)}</b></div></div><div className="card-b"><p className="small muted">{d.data.vat.note}</p></div></section>
          <section className="card" aria-labelledby="t"><div className="card-h"><h2 id="t">Comptes clients</h2><span className={`badge ${d.data.thirdParties.match ? "b-success" : "b-warning"}`}>{d.data.thirdParties.match ? "Rapprochés du compte 411" : "Écart avec le compte 411"}</span></div>
            {!d.data.thirdParties.rows.length ? <div className="empty"><p className="muted">Aucun solde client.</p></div> : <table className="tbl compact"><thead><tr><th scope="col">Client</th><th scope="col" className="r">Solde (TTC)</th></tr></thead><tbody>{d.data.thirdParties.rows.map(r => <tr key={r.companyId}><td>{r.name}</td><td className="r num">{nf(r.balance)}</td></tr>)}<tr><th scope="row">Total (compte 411 : {nf(d.data.thirdParties.ledger411)})</th><td className="r num"><b>{nf(d.data.thirdParties.total)}</b></td></tr></tbody></table>}</section>
        </div>
        {perms.includes("accounting.export") && <section className="card" aria-labelledby="e"><div className="card-h"><h2 id="e">Exports pour l’expert-comptable</h2></div><div className="card-b stack">
          <div className="alert a-info" role="note"><span>L’export « FEC » reprend les 18 colonnes du Fichier des Écritures Comptables mais <b>n’a pas été validé</b> par l’outil officiel de contrôle de l’administration : à faire valider par votre expert-comptable. Il est marqué « provisoire » tant que la période n’est pas close.</span></div>
          <div className="row"><button className="btn btn-secondary" onClick={() => exp(`accounting/export/fec?from=${period}&to=${period}`, `FEC-${period}.txt`)}>Exporter le FEC de {period}</button><button className="btn btn-secondary" onClick={() => exp(`accounting/export/balance.csv?from=${period}&to=${period}`, `balance-${period}.csv`)}>Exporter la balance (CSV)</button></div></div></section>}
      </>)}
      <section className="card" aria-labelledby="h"><div className="card-h"><h2 id="h">Périodes</h2></div>
        <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th scope="col">Période</th><th scope="col">Statut</th><th scope="col" className="r">Écritures</th><th scope="col"><span style={{ position: "absolute", left: -999 }}>Ouvrir</span></th></tr></thead>
          <tbody>{periods.data?.slice(0, 12).map(p => <tr key={p.period}><td className="num">{p.period}</td><td><span className={`badge ${p.status === "closed" ? "b-success" : "b-neutral"}`}>{p.status === "closed" ? "Close" : "Ouverte"}</span></td><td className="r num">{p.entries}</td><td className="r"><button className="btn btn-ghost btn-sm" onClick={() => setPeriod(p.period)}>Ouvrir</button></td></tr>)}</tbody></table></div></section>
    </>
  );
}
