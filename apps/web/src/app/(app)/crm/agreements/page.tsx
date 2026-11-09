"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDate, fmtEUR } from "@/lib/format";
import { AGREEMENT_STATUS } from "@/lib/crm";
import { Badge, ErrorBox, Forbidden, isForbidden } from "@/lib/ui";

type Agreement = { id: string; company: string; name: string; startDate: string; endDate: string; status: string; effectiveStatus: string; daysLeft: number; expiringSoon: boolean; paymentTermsDays: number | null; rates: { id: string; label: string; maxDailyRate: string }[] };
type Company = { id: string; name: string };
export default function AgreementsPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["agreements"], queryFn: () => api<Agreement[]>("crm/agreements?expiringWithin=60") });
  const companies = useQuery({ queryKey: ["companies"], queryFn: () => api<Company[]>("companies") });
  const [f, setF] = useState({ companyId: "", name: "", startDate: "", endDate: "", paymentTermsDays: "", rates: [{ label: "", maxDailyRate: "" }] });
  const create = useMutation({
    mutationFn: () => api("crm/agreements", { method: "POST", body: { companyId: f.companyId, name: f.name, startDate: f.startDate, endDate: f.endDate, ...(f.paymentTermsDays ? { paymentTermsDays: Number(f.paymentTermsDays) } : {}), rates: f.rates } }),
    onSuccess: () => { setF({ ...f, name: "", rates: [{ label: "", maxDailyRate: "" }] }); qc.invalidateQueries({ queryKey: ["agreements"] }); },
  });
  const move = useMutation({ mutationFn: (a: { id: string; event: string }) => api(`crm/agreements/${a.id}/transition`, { method: "POST", body: { event: a.event } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["agreements"] }) });
  const setRate = (i: number, k: "label" | "maxDailyRate", v: string) => setF({ ...f, rates: f.rates.map((r, j) => (j === i ? { ...r, [k]: v } : r)) });
  if (isForbidden(list.error)) return <><h1>Accords-cadres</h1><Forbidden what="les accords-cadres" /></>;
  return (
    <>
      <h1>Accords-cadres</h1>
      <div className="alert a-info" role="note"><span>Un accord actif plafonne le TJM des missions qui s'y rattachent ; les alertes signalent les échéances à moins de 60 jours.</span></div>
      <div className="split">
        <section className="card main" aria-labelledby="a-liste">
          <div className="card-h"><h2 id="a-liste">Accords</h2></div>
          <ErrorBox error={list.error ?? move.error} prefix="Opération impossible" />
          {list.data?.length === 0 && <div className="card-b muted">Aucun accord-cadre.</div>}
          {list.data && list.data.length > 0 && <div className="tbl-wrap"><table className="tbl compact">
            <thead><tr><th scope="col">Accord</th><th scope="col">Validité</th><th scope="col">Grille (TJM plafonds)</th><th scope="col">Statut</th><th scope="col">Actions</th></tr></thead>
            <tbody>{list.data.map(a => <tr key={a.id}>
              <td><b>{a.name}</b><div className="small muted">{a.company}{a.paymentTermsDays != null ? ` · paiement à ${a.paymentTermsDays} j` : ""}</div></td>
              <td className="num">{fmtDate(a.startDate)} → {fmtDate(a.endDate)}{a.expiringSoon && <div><span className="badge b-warning">Échéance dans {a.daysLeft} j</span></div>}</td>
              <td className="small">{a.rates.map(r => <div key={r.id}>{r.label} : {fmtEUR(r.maxDailyRate)}</div>)}</td>
              <td><Badge map={AGREEMENT_STATUS} value={a.effectiveStatus} /></td>
              <td>{a.status === "draft" && <button className="btn btn-secondary btn-sm" disabled={move.isPending} onClick={() => move.mutate({ id: a.id, event: "activate" })}>Activer</button>}
                {a.status === "active" && <button className="btn btn-ghost btn-sm" disabled={move.isPending} onClick={() => move.mutate({ id: a.id, event: "terminate" })}>Résilier</button>}</td></tr>)}</tbody></table></div>}
        </section>
        <form className="card side" aria-labelledby="a-new" onSubmit={e => { e.preventDefault(); create.mutate(); }}>
          <div className="card-h"><h2 id="a-new">Nouvel accord-cadre</h2></div>
          <div className="card-b stack" style={{ gap: 16 }}>
            <div className="field"><label className="label" htmlFor="ac">Client</label><select id="ac" className="input" value={f.companyId} onChange={e => setF({ ...f, companyId: e.target.value })} required><option value="">Choisir…</option>{companies.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div className="field"><label className="label" htmlFor="an">Intitulé</label><input id="an" className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} minLength={2} required /></div>
            <div className="field"><label className="label" htmlFor="as">Début</label><input id="as" type="date" className="input" value={f.startDate} onChange={e => setF({ ...f, startDate: e.target.value })} required /></div>
            <div className="field"><label className="label" htmlFor="ae">Fin</label><input id="ae" type="date" className="input" value={f.endDate} onChange={e => setF({ ...f, endDate: e.target.value })} required /></div>
            <div className="field"><label className="label" htmlFor="ap">Délai de paiement (jours)</label><input id="ap" inputMode="numeric" className="input" value={f.paymentTermsDays} onChange={e => setF({ ...f, paymentTermsDays: e.target.value })} /></div>
            <fieldset className="stack" style={{ gap: 8, border: 0, padding: 0 }}><legend className="label">Grille de TJM plafonds</legend>
              {f.rates.map((r, i) => <div key={i} className="row" style={{ gap: 6 }}>
                <input aria-label={`Profil ${i + 1}`} className="input" placeholder="Profil" value={r.label} onChange={e => setRate(i, "label", e.target.value)} required />
                <input aria-label={`TJM plafond ${i + 1}`} className="input" inputMode="decimal" placeholder="TJM max (€)" value={r.maxDailyRate} onChange={e => setRate(i, "maxDailyRate", e.target.value)} required /></div>)}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setF({ ...f, rates: [...f.rates, { label: "", maxDailyRate: "" }] })}>Ajouter un profil</button></fieldset>
            <ErrorBox error={create.error} prefix="Création impossible" />
          </div>
          <div className="card-f"><button type="submit" className="btn btn-primary" disabled={create.isPending}>Créer l'accord</button></div>
        </form>
      </div>
    </>
  );
}
