"use client";
import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDate, fmtEUR } from "@/lib/format";
import { ErrorBox, Forbidden, isForbidden } from "@/lib/ui";

type Amd = { id: string; kind: string; effective: string; before: Record<string, string | null>; after: Record<string, string | null>; reason: string; createdAt: string };
type Mission = { id: string; title: string; timeUnit: string; status: string; startDate: string; endDate: string | null; initialRate: string; currentRate: string; annualDaysCap: number | null;
  consultant: { firstName: string; lastName: string }; company: { name: string }; amendments: Amd[];
  budget: { amount: string; consumed: string; remaining: string; overBudget: boolean; note: string } | null };
const KIND: Record<string, string> = { rate: "Tarif", extend: "Prolongation", early_end: "Fin anticipée", budget: "Budget" };
const describe = (a: Amd) => a.kind === "rate" ? `${fmtEUR(a.before.rate ?? "0")} → ${fmtEUR(a.after.rate ?? "0")} à compter de ${a.effective}`
  : a.kind === "budget" ? `${a.before.budget ? fmtEUR(a.before.budget) : "aucun"} → ${fmtEUR(a.after.budget ?? "0")}` : `${a.before.endDate ? fmtDate(a.before.endDate) : "—"} → ${fmtDate(a.after.endDate ?? "")}`;

export default function MissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const qc = useQueryClient();
  const q = useQuery({ queryKey: ["mission", id], queryFn: () => api<Mission>(`missions/${id}`) });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ permissions: string[] }>("me") });
  const canWrite = !!me.data?.permissions.includes("mission.write");
  const [kind, setKind] = useState("rate"); const [v, setV] = useState({ newRate: "", effectiveMonth: "", newEndDate: "", budgetAmount: "", reason: "" });
  const amend = useMutation({
    mutationFn: () => api(`missions/${id}/amendments`, { method: "POST", body: { kind, reason: v.reason, ...(kind === "rate" ? { newRate: v.newRate.replace(",", "."), effectiveMonth: v.effectiveMonth } : kind === "budget" ? { budgetAmount: v.budgetAmount.replace(",", ".") } : { newEndDate: v.newEndDate }) } }),
    onSuccess: () => { setV({ newRate: "", effectiveMonth: "", newEndDate: "", budgetAmount: "", reason: "" }); qc.invalidateQueries({ queryKey: ["mission", id] }); qc.invalidateQueries({ queryKey: ["missions"] }); },
  });
  if (isForbidden(q.error)) return <><h1>Mission</h1><Forbidden what="cette mission" /></>;
  if (!q.data) return <><h1>Mission</h1><ErrorBox error={q.error} prefix="Chargement impossible" />{q.isLoading && <p>Chargement…</p>}</>;
  const m = q.data; const hourly = m.timeUnit === "hour";
  const field = (k: keyof typeof v, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => <div className="field"><label className="label" htmlFor={`a-${k}`}>{label}</label><input id={`a-${k}`} className="input" value={v[k]} onChange={e => setV({ ...v, [k]: e.target.value })} {...props} /></div>;
  return (
    <>
      <p className="small"><Link href="/missions">← Missions</Link></p>
      <h1>{m.title}</h1>
      <p className="muted">{m.consultant.firstName} {m.consultant.lastName} · {m.company.name} · {fmtDate(m.startDate)} → {m.endDate ? fmtDate(m.endDate) : "sans fin"} · {m.status === "active" ? "Active" : "Terminée"}</p>
      <section className="card" aria-labelledby="r"><div className="card-h"><h2 id="r">Tarif et budget</h2></div>
        <div className="card-b stack">
          <p>Tarif {hourly ? "horaire" : "journalier"} actuel : <b>{fmtEUR(m.currentRate)}</b>{m.currentRate !== m.initialRate && <span className="muted"> (initial {fmtEUR(m.initialRate)})</span>}. Chaque CRA est facturé au tarif en vigueur le mois concerné.</p>
          {m.budget ? <div className={`alert ${m.budget.overBudget ? "a-warning" : "a-info"}`} role={m.budget.overBudget ? "alert" : "note"}><span>Budget {fmtEUR(m.budget.amount)} HT · consommé {fmtEUR(m.budget.consumed)} · reste {fmtEUR(m.budget.remaining)}{m.budget.overBudget ? " : dépassé" : ""}. {m.budget.note}</span></div> : <p className="muted">Aucun budget défini.</p>}
          {m.annualDaysCap !== null && <p className="muted">Plafond annuel du forfait jours (saisi) : {m.annualDaysCap} j.</p>}
        </div></section>
      {canWrite && m.status === "active" && <form className="card" onSubmit={e => { e.preventDefault(); amend.mutate(); }} aria-labelledby="n">
        <div className="card-h"><h2 id="n">Nouvel avenant</h2></div>
        <div className="card-b row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field"><label className="label" htmlFor="a-kind">Type d’avenant</label>
            <select id="a-kind" className="input" value={kind} onChange={e => setKind(e.target.value)}><option value="rate">Changement de tarif</option><option value="extend">Prolongation (renouvellement)</option><option value="early_end">Fin anticipée</option><option value="budget">Budget</option></select></div>
          {kind === "rate" && <>{field("newRate", hourly ? "Nouveau tarif horaire HT (€)" : "Nouveau TJM HT (€)", { inputMode: "decimal", required: true })}{field("effectiveMonth", "À compter du mois", { type: "month", required: true })}</>}
          {(kind === "extend" || kind === "early_end") && field("newEndDate", "Nouvelle date de fin", { type: "date", required: true })}
          {kind === "budget" && field("budgetAmount", "Budget HT (€)", { inputMode: "decimal", required: true })}
          {field("reason", "Motif (obligatoire)", { required: true, minLength: 3, maxLength: 500 })}
          <button className="btn btn-primary" disabled={amend.isPending}>Enregistrer l’avenant</button>
        </div>
        <ErrorBox error={amend.error} prefix="Avenant refusé" />
        <p className="hint card-b">Un avenant est définitif et journalisé : on le corrige par un nouvel avenant. Un tarif ne peut pas être modifié rétroactivement sur une période déjà facturée.</p>
      </form>}
      <section className="card" aria-labelledby="h"><div className="card-h"><h2 id="h">Historique des avenants</h2></div>
        {m.amendments.length === 0 ? <div className="card-b muted">Aucun avenant.</div> : <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Changement</th><th scope="col">Motif</th></tr></thead>
          <tbody>{m.amendments.map(a => <tr key={a.id}><td className="num">{fmtDate(a.createdAt)}</td><td>{KIND[a.kind] ?? a.kind}</td><td>{describe(a)}</td><td>{a.reason}</td></tr>)}</tbody></table></div>}
      </section>
    </>
  );
}
