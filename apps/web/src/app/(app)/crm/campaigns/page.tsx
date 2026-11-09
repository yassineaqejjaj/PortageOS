"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtEUR } from "@/lib/format";
import { CAMPAIGN_STATUS, CHANNEL } from "@/lib/crm";
import { Badge, ErrorBox, Forbidden, isForbidden } from "@/lib/ui";

type Campaign = { id: string; name: string; kind: string; channel: string; status: string; budget: string | null };
type Stats = { prospects: number; stages: Record<string, number>; conversionRatePercent: string; costPerConversion: string | null };
export default function CampaignsPage() {
  const qc = useQueryClient(); const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["campaigns"], queryFn: () => api<Campaign[]>("crm/campaigns") });
  const stats = useQuery({ queryKey: ["campaign-stats", open], enabled: !!open, queryFn: () => api<Stats>(`crm/campaigns/${open}/stats`) });
  const [f, setF] = useState({ name: "", kind: "consultants", channel: "email", budget: "" });
  const create = useMutation({ mutationFn: () => api("crm/campaigns", { method: "POST", body: { name: f.name, kind: f.kind, channel: f.channel, ...(f.budget ? { budget: f.budget } : {}) } }), onSuccess: () => { setF({ ...f, name: "", budget: "" }); qc.invalidateQueries({ queryKey: ["campaigns"] }); } });
  const move = useMutation({ mutationFn: (a: { id: string; event: string }) => api(`crm/campaigns/${a.id}/transition`, { method: "POST", body: { event: a.event } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns"] }) });
  if (isForbidden(list.error)) return <><h1>Campagnes</h1><Forbidden what="les campagnes" /></>;
  return (
    <>
      <h1>Campagnes</h1>
      <div className="split">
        <section className="card main" aria-labelledby="c-liste">
          <div className="card-h"><h2 id="c-liste">Campagnes</h2></div>
          <ErrorBox error={list.error ?? move.error} prefix="Opération impossible" />
          {list.data?.length === 0 && <div className="card-b muted">Aucune campagne. Créez-en une pour mesurer le coût par conversion.</div>}
          {list.data && list.data.length > 0 && <div className="tbl-wrap"><table className="tbl compact">
            <thead><tr><th scope="col">Campagne</th><th scope="col">Canal</th><th scope="col">Statut</th><th scope="col">Budget</th><th scope="col">Actions</th></tr></thead>
            <tbody>{list.data.map(c => <tr key={c.id}>
              <td><b>{c.name}</b><div className="small muted">{c.kind === "consultants" ? "Consultants" : "Entreprises"}</div></td>
              <td>{CHANNEL[c.channel] ?? c.channel}</td><td><Badge map={CAMPAIGN_STATUS} value={c.status} /></td>
              <td className="num">{c.budget ? fmtEUR(c.budget) : "—"}</td>
              <td><div className="row" style={{ gap: 6 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>Statistiques</button>
                {c.status === "draft" && <button className="btn btn-secondary btn-sm" disabled={move.isPending} onClick={() => move.mutate({ id: c.id, event: "launch" })}>Lancer</button>}
                {c.status === "active" && <button className="btn btn-ghost btn-sm" disabled={move.isPending} onClick={() => move.mutate({ id: c.id, event: "end" })}>Terminer</button>}</div>
                {open === c.id && stats.data && <dl className="small" style={{ marginTop: 8 }}>
                  <div>Prospects : <b>{stats.data.prospects}</b> · Convertis : <b>{stats.data.stages.converted ?? 0}</b> · Taux : <b>{stats.data.conversionRatePercent} %</b></div>
                  <div>Coût par conversion : <b>{stats.data.costPerConversion ? fmtEUR(stats.data.costPerConversion) : "non calculable (budget ou conversion manquants)"}</b></div></dl>}</td></tr>)}</tbody></table></div>}
        </section>
        <form className="card side" aria-labelledby="c-new" onSubmit={e => { e.preventDefault(); create.mutate(); }}>
          <div className="card-h"><h2 id="c-new">Nouvelle campagne</h2></div>
          <div className="card-b stack" style={{ gap: 16 }}>
            <div className="field"><label className="label" htmlFor="cn">Nom</label><input id="cn" className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} minLength={3} required /></div>
            <div className="field"><label className="label" htmlFor="ck">Cible</label><select id="ck" className="input" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}><option value="consultants">Consultants</option><option value="companies">Entreprises</option></select></div>
            <div className="field"><label className="label" htmlFor="cc">Canal</label><select id="cc" className="input" value={f.channel} onChange={e => setF({ ...f, channel: e.target.value })}>{Object.entries(CHANNEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div className="field"><label className="label" htmlFor="cb">Budget (€)</label><input id="cb" inputMode="decimal" className="input" value={f.budget} onChange={e => setF({ ...f, budget: e.target.value })} /><span className="hint">Sert au calcul du coût par conversion.</span></div>
            <ErrorBox error={create.error} prefix="Création impossible" />
          </div>
          <div className="card-f"><button type="submit" className="btn btn-primary" disabled={create.isPending}>Créer la campagne</button></div>
        </form>
      </div>
    </>
  );
}
