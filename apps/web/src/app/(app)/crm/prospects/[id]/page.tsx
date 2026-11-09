"use client";
import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtEUR } from "@/lib/format";
import { Band, COMMISSION_STATUS, INTERACTION, SCORE_NOTE, ScoreBadge } from "@/lib/crm";
import { Badge, ErrorBox, Forbidden, isForbidden } from "@/lib/ui";

type Detail = {
  prospect: { id: string; kind: string; name: string; email: string | null; phone: string | null; stage: string; source: string | null; lostReason: string | null };
  campaign: { id: string; name: string } | null;
  score: { score: number; band: Band; breakdown: { key: string; label: string; points: number }[]; disclaimer: string };
  interactions: { id: string; type: string; summary: string; occurredAt: string }[];
  tasks: { id: string; title: string; dueDate: string; status: string; overdue: boolean }[];
  referral: { id: string; referrer: { name: string; kind: string }; ruleType: string; ruleValue: string; durationMonths: number; convertedAt: string | null; commissions: { id: string; amount: string; status: string; sourceType: string }[] } | null;
  simulations: { id: string; createdAt: string; results: SimResult[] }[];
};
type SimResult = { label: string; invoicedNet: string; managementFee: string; balanceBeforeSocialAndSalary: string; hypotheses: string[] };
type SimOut = { results: SimResult[]; feeSource: { type: string; value?: string; source?: string }; disclaimer: string };
type Referrer = { id: string; name: string; status: string };

export default function ProspectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const qc = useQueryClient();
  const d = useQuery({ queryKey: ["prospect", id], queryFn: () => api<Detail>(`crm/prospects/${id}`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["prospect", id] }); qc.invalidateQueries({ queryKey: ["prospects"] }); };
  const [it, setIt] = useState({ type: "call", summary: "" });
  const addI = useMutation({ mutationFn: () => api(`crm/prospects/${id}/interactions`, { method: "POST", body: it }), onSuccess: () => { setIt({ ...it, summary: "" }); refresh(); } });
  const [task, setTask] = useState({ title: "", dueDate: "" });
  const addT = useMutation({ mutationFn: () => api("crm/tasks", { method: "POST", body: { prospectId: id, ...task } }), onSuccess: () => { setTask({ title: "", dueDate: "" }); refresh(); } });
  const doneT = useMutation({ mutationFn: (tid: string) => api(`crm/tasks/${tid}/done`, { method: "POST", body: {} }), onSuccess: refresh });
  const referrers = useQuery({ queryKey: ["referrers"], queryFn: () => api<Referrer[]>("crm/referrers") });
  const [rf, setRf] = useState({ referrerId: "", ruleType: "fixed_per_conversion", ruleValue: "", durationMonths: "6" });
  const addR = useMutation({ mutationFn: () => api("crm/referrals", { method: "POST", body: { prospectId: id, referrerId: rf.referrerId, ruleType: rf.ruleType, ruleValue: rf.ruleValue, ...(rf.ruleType === "percent_of_collected_net" ? { durationMonths: Number(rf.durationMonths) } : {}) } }), onSuccess: refresh });
  const [sim, setSim] = useState({ label: "Base", dailyRate: "", daysPerMonth: "18", vatRate: "20", monthlyExpenses: "", feeRatePercent: "" });
  const runSim = useMutation({ mutationFn: () => api<SimOut>("crm/simulations", { method: "POST", body: { prospectId: id, ...(sim.feeRatePercent ? { feeRatePercent: sim.feeRatePercent } : {}), scenarios: [{ label: sim.label, dailyRate: sim.dailyRate, daysPerMonth: sim.daysPerMonth, vatRate: sim.vatRate, ...(sim.monthlyExpenses ? { monthlyExpenses: sim.monthlyExpenses } : {}) }] } }), onSuccess: refresh });
  if (isForbidden(d.error)) return <><h1>Prospect</h1><Forbidden what="cette fiche" /></>;
  if (d.isLoading || !d.data) return <><h1>Prospect</h1><ErrorBox error={d.error} prefix="Chargement impossible" />{d.isLoading && <p>Chargement…</p>}</>;
  const x = d.data, p = x.prospect;
  return (
    <>
      <p className="small"><Link href="/crm/prospects">← Prospects</Link></p>
      <h1>{p.name}</h1>
      <p className="muted">{p.kind === "consultant" ? "Consultant" : "Entreprise"} · {p.email ?? p.phone ?? "aucun contact"}{x.campaign && <> · Campagne : {x.campaign.name}</>}{p.source && <> · Source : {p.source}</>}</p>
      <div className="grid-2">
        <section className="card" aria-labelledby="sc">
          <div className="card-h"><h2 id="sc">Score de priorisation</h2><ScoreBadge score={x.score.score} band={x.score.band} /></div>
          <div className="card-b stack" style={{ gap: 8 }}>
            {x.score.breakdown.length === 0 ? <span className="muted">Aucun critère satisfait.</span> : <ul className="stack" style={{ gap: 4, margin: 0, paddingLeft: 18 }}>{x.score.breakdown.map(b => <li key={b.key}>{b.label} : <b>{b.points > 0 ? "+" : ""}{b.points}</b></li>)}</ul>}
            <p className="small muted">{SCORE_NOTE}</p>
          </div>
        </section>
        <section className="card" aria-labelledby="ref">
          <div className="card-h"><h2 id="ref">Parrainage / apport</h2></div>
          <div className="card-b stack" style={{ gap: 8 }}>
            {x.referral ? <>
              <div>{x.referral.referrer.kind === "sponsor" ? "Parrain" : "Apporteur"} : <b>{x.referral.referrer.name}</b></div>
              <div className="small">{x.referral.ruleType === "percent_of_collected_net" ? `${x.referral.ruleValue} % du HT encaissé pendant ${x.referral.durationMonths} mois` : `Forfait de ${fmtEUR(x.referral.ruleValue)} à la conversion`} (règle figée)</div>
              {x.referral.commissions.map(c => <div key={c.id} className="small">{c.sourceType === "conversion" ? "Conversion" : "Encaissement"} : {fmtEUR(c.amount)} <Badge map={COMMISSION_STATUS} value={c.status} /></div>)}
            </> : <form className="stack" style={{ gap: 8 }} onSubmit={e => { e.preventDefault(); addR.mutate(); }}>
              <div className="field"><label className="label" htmlFor="rr">Apporteur</label><select id="rr" className="input" value={rf.referrerId} onChange={e => setRf({ ...rf, referrerId: e.target.value })} required><option value="">Aucun parrainage — choisir…</option>{referrers.data?.filter(r => r.status === "active").map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
              <div className="field"><label className="label" htmlFor="rt">Règle</label><select id="rt" className="input" value={rf.ruleType} onChange={e => setRf({ ...rf, ruleType: e.target.value })}><option value="fixed_per_conversion">Forfait à la conversion (€)</option><option value="percent_of_collected_net">% du HT encaissé</option></select></div>
              <div className="field"><label className="label" htmlFor="rv">{rf.ruleType === "fixed_per_conversion" ? "Montant (€)" : "Pourcentage"}</label><input id="rv" className="input" inputMode="decimal" value={rf.ruleValue} onChange={e => setRf({ ...rf, ruleValue: e.target.value })} required /></div>
              {rf.ruleType === "percent_of_collected_net" && <div className="field"><label className="label" htmlFor="rd">Durée (mois)</label><input id="rd" className="input" inputMode="numeric" value={rf.durationMonths} onChange={e => setRf({ ...rf, durationMonths: e.target.value })} required /></div>}
              <ErrorBox error={addR.error} prefix="Enregistrement impossible" />
              <div><button className="btn btn-secondary btn-sm" type="submit" disabled={addR.isPending}>Enregistrer le parrainage</button></div></form>}
          </div>
        </section>
        <section className="card" aria-labelledby="int">
          <div className="card-h"><h2 id="int">Interactions</h2></div>
          <div className="card-b stack" style={{ gap: 12 }}>
            <form className="stack" style={{ gap: 8 }} onSubmit={e => { e.preventDefault(); addI.mutate(); }}>
              <div className="row" style={{ gap: 8 }}>
                <label className="label" htmlFor="it" style={{ position: "absolute", left: -999 }}>Type d'interaction</label>
                <select id="it" className="input" style={{ width: 140 }} value={it.type} onChange={e => setIt({ ...it, type: e.target.value })}>{Object.entries(INTERACTION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <label className="label" htmlFor="is" style={{ position: "absolute", left: -999 }}>Résumé</label>
                <input id="is" className="input" placeholder="Résumé de l'échange" value={it.summary} onChange={e => setIt({ ...it, summary: e.target.value })} minLength={3} required />
                <button className="btn btn-secondary btn-sm" type="submit" disabled={addI.isPending}>Journaliser</button></div>
              <ErrorBox error={addI.error} prefix="Enregistrement impossible" />
              <span className="hint">Le journal est en ajout seul : une interaction ne peut être ni modifiée ni supprimée.</span>
            </form>
            {x.interactions.length === 0 ? <span className="muted">Aucune interaction.</span> : <ul className="stack" style={{ gap: 8, margin: 0, padding: 0, listStyle: "none" }}>{x.interactions.map(i => <li key={i.id}><b>{INTERACTION[i.type] ?? i.type}</b> · <span className="small muted">{fmtDateTime(i.occurredAt)}</span><div>{i.summary}</div></li>)}</ul>}
          </div>
        </section>
        <section className="card" aria-labelledby="tk">
          <div className="card-h"><h2 id="tk">Tâches</h2></div>
          <div className="card-b stack" style={{ gap: 12 }}>
            <form className="row" style={{ gap: 8 }} onSubmit={e => { e.preventDefault(); addT.mutate(); }}>
              <label className="label" htmlFor="kt" style={{ position: "absolute", left: -999 }}>Intitulé de la tâche</label><input id="kt" className="input" placeholder="Prochaine action" value={task.title} onChange={e => setTask({ ...task, title: e.target.value })} minLength={3} required />
              <label className="label" htmlFor="kd" style={{ position: "absolute", left: -999 }}>Échéance</label><input id="kd" type="date" className="input" style={{ width: 160 }} value={task.dueDate} onChange={e => setTask({ ...task, dueDate: e.target.value })} required />
              <button className="btn btn-secondary btn-sm" type="submit" disabled={addT.isPending}>Ajouter</button></form>
            <ErrorBox error={addT.error ?? doneT.error} prefix="Opération impossible" />
            {x.tasks.length === 0 ? <span className="muted">Aucune tâche.</span> : <ul className="stack" style={{ gap: 6, margin: 0, padding: 0, listStyle: "none" }}>{x.tasks.map(t => <li key={t.id} className="row" style={{ gap: 8, justifyContent: "space-between" }}>
              <span>{t.title} <span className="small muted">· {fmtDate(t.dueDate)}</span> {t.overdue && <span className="badge b-danger">En retard</span>} {t.status !== "open" && <span className="badge b-neutral">{t.status === "done" ? "Faite" : "Annulée"}</span>}</span>
              {t.status === "open" && <button className="btn btn-ghost btn-sm" disabled={doneT.isPending} onClick={() => doneT.mutate(t.id)}>Terminer</button>}</li>)}</ul>}
          </div>
        </section>
      </div>
      <section className="card" aria-labelledby="sim" style={{ marginTop: 16 }}>
        <div className="card-h"><h2 id="sim">Simulation commerciale</h2><span className="badge b-warning">Estimation</span></div>
        <div className="card-b stack" style={{ gap: 12 }}>
          <div className="alert a-warning" role="note"><span>Illustration commerciale fondée sur vos hypothèses. Ce n'est ni un calcul de rémunération ni un bulletin de paie : cotisations et net salarié ne sont pas calculés.</span></div>
          <form className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-end" }} onSubmit={e => { e.preventDefault(); runSim.mutate(); }}>
            {([["dailyRate", "TJM (€)"], ["daysPerMonth", "Jours / mois"], ["vatRate", "TVA (%)"], ["monthlyExpenses", "Frais mensuels (€)"], ["feeRatePercent", "Frais de gestion (%)"]] as const).map(([k, l]) =>
              <div className="field" key={k}><label className="label" htmlFor={`s-${k}`}>{l}</label><input id={`s-${k}`} className="input" style={{ width: 130 }} inputMode="decimal" value={sim[k]} onChange={e => setSim({ ...sim, [k]: e.target.value })} required={k === "dailyRate" || k === "daysPerMonth" || k === "vatRate"} /></div>)}
            <button className="btn btn-primary" type="submit" disabled={runSim.isPending}>Simuler</button></form>
          <span className="hint">Frais de gestion : laissez vide pour utiliser le paramètre réglementaire approuvé ; sinon la valeur saisie est une hypothèse.</span>
          <ErrorBox error={runSim.error} prefix="Simulation impossible" />
          {(runSim.data ?? null) && <div className="stack" style={{ gap: 4 }}>{runSim.data!.results.map(r => <div key={r.label}><b>{r.label}</b> : facturé HT {fmtEUR(r.invoicedNet)} · frais de gestion {fmtEUR(r.managementFee)} · solde avant charges sociales et salaire {fmtEUR(r.balanceBeforeSocialAndSalary)}</div>)}
            <div className="small muted">Taux de frais : {runSim.data!.feeSource.type === "parameter" ? `paramètre approuvé (${runSim.data!.feeSource.value} %)` : "hypothèse saisie"}. {runSim.data!.results[0]?.hypotheses.join(" ")}</div></div>}
          {x.simulations.length > 0 && <div className="small muted">{x.simulations.length} simulation(s) enregistrée(s) pour ce prospect (dernière : {fmtDateTime(x.simulations[0]!.createdAt)}).</div>}
        </div>
      </section>
    </>
  );
}
