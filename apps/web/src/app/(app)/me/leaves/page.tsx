"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { Badge, ErrorBox, LEAVE_STATUS, LEAVE_TYPE, dayFmt, type Leave } from "@/lib/ui";

export default function MyLeavesPage() {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ type: "paid_leave", startDate: today, endDate: today, halfStart: false, halfEnd: false, reason: "" });
  const list = useQuery({ queryKey: ["me-leaves"], queryFn: () => api<Leave[]>("me/leaves") });
  const bal = useQuery({ queryKey: ["me-leave-balance"], queryFn: () => api<{ paidLeaveDays: string }>("me/leave-balance") });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["me-leaves"] }); qc.invalidateQueries({ queryKey: ["me-leave-balance"] }); };
  const create = useMutation({ mutationFn: () => api<Leave>("me/leaves", { method: "POST", body: { ...f, reason: f.reason || undefined } }), onSuccess: refresh });
  const cancel = useMutation({ mutationFn: (id: string) => api(`me/leaves/${id}/cancel`, { method: "POST" }), onSuccess: refresh });
  return (
    <>
      <h1>Mes absences</h1>
      <div className="kpi card" style={{ maxWidth: 320 }}><span className="eyebrow">Solde de congés payés</span><span className="v">{bal.data ? `${dayFmt(bal.data.paidLeaveDays)} j` : "…"}</span><span className="src">Ajustements saisis par la RH − congés approuvés. L’acquisition n’est pas automatique.</span></div>
      <ErrorBox error={list.error ?? create.error ?? cancel.error} prefix="Erreur" />
      {create.data && !create.data.holidaysConfigured && <div className="alert a-warning" role="status"><span>Aucun jour férié approuvé n’est paramétré pour cette année : le décompte ({dayFmt(create.data.days)} j) peut compter des jours fériés.</span></div>}
      <div className="split">
        <section className="card main" aria-labelledby="l"><div className="card-h"><h2 id="l">Mes demandes</h2></div>
          {list.data?.length === 0 && <div className="empty"><h3>Aucune demande</h3></div>}
          {!!list.data?.length && <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th scope="col">Type</th><th scope="col">Période</th><th scope="col" className="r">Jours</th><th scope="col">Statut</th><th scope="col">Actions</th></tr></thead>
            <tbody>{list.data.map(r => <tr key={r.id}><td>{LEAVE_TYPE[r.type]}</td><td className="num">{fmtDate(r.startDate)} → {fmtDate(r.endDate)}</td><td className="r num">{dayFmt(r.days)}</td>
              <td><Badge map={LEAVE_STATUS} value={r.status} />{r.rejectReason && <div className="small muted">{r.rejectReason}</div>}</td>
              <td>{["submitted", "approved"].includes(r.status) && <button className="btn btn-ghost btn-sm" disabled={cancel.isPending} onClick={() => cancel.mutate(r.id)}>Annuler</button>}</td></tr>)}</tbody></table></div>}
        </section>
        <form className="card side" onSubmit={e => { e.preventDefault(); create.mutate(); }} aria-labelledby="n"><div className="card-h"><h2 id="n">Nouvelle demande</h2></div>
          <div className="card-b stack" style={{ gap: 16 }}>
            <div className="field"><label className="label" htmlFor="t">Type</label><select id="t" className="input" value={f.type} onChange={e => setF({ ...f, type: e.target.value })}>{Object.entries(LEAVE_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div className="field"><label className="label" htmlFor="s">Du</label><input id="s" className="input" type="date" value={f.startDate} onChange={e => setF({ ...f, startDate: e.target.value })} required /></div>
            <div className="field"><label className="label" htmlFor="e">Au</label><input id="e" className="input" type="date" value={f.endDate} onChange={e => setF({ ...f, endDate: e.target.value })} required /></div>
            <label className="check"><input type="checkbox" checked={f.halfStart} onChange={e => setF({ ...f, halfStart: e.target.checked })} /> Premier jour : demi-journée</label>
            <label className="check"><input type="checkbox" checked={f.halfEnd} onChange={e => setF({ ...f, halfEnd: e.target.checked })} /> Dernier jour : demi-journée</label>
            <p className="hint">Les week-ends et jours fériés paramétrés ne sont pas décomptés.</p>
          </div>
          <div className="card-f"><button className="btn btn-primary" disabled={create.isPending}>Soumettre la demande</button></div></form>
      </div>
    </>
  );
}
