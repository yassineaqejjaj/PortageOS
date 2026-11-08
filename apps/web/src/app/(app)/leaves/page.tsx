"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { Badge, ErrorBox, Forbidden, LEAVE_STATUS, LEAVE_TYPE, dayFmt, isForbidden, type Leave } from "@/lib/ui";

export default function LeavesPage() {
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState<string | null>(null); const [reason, setReason] = useState("");
  const [adj, setAdj] = useState({ consultantId: "", days: "", reason: "" });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ permissions: string[] }>("me") });
  const list = useQuery({ queryKey: ["leaves"], queryFn: () => api<Leave[]>("leaves") });
  const cons = useQuery({ queryKey: ["consultants"], queryFn: () => api<{ id: string; firstName: string; lastName: string }[]>("consultants"), retry: false });
  const bal = useQuery({ queryKey: ["leave-balance", adj.consultantId], queryFn: () => api<{ paidLeaveDays: string }>(`leave-balances/${adj.consultantId}`), enabled: !!adj.consultantId });
  const refresh = () => { setRejecting(null); setReason(""); qc.invalidateQueries({ queryKey: ["leaves"] }); qc.invalidateQueries({ queryKey: ["leave-balance"] }); };
  const act = useMutation({ mutationFn: (a: { id: string; event: string; rejectReason?: string }) => api(`leaves/${a.id}/transition`, { method: "POST", body: a }), onSuccess: refresh });
  const adjust = useMutation({ mutationFn: () => api("leave-adjustments", { method: "POST", body: { consultantId: adj.consultantId, days: adj.days.replace(",", "."), reason: adj.reason } }), onSuccess: () => { setAdj({ ...adj, days: "", reason: "" }); refresh(); } });
  if (isForbidden(list.error)) return <><h1>Absences et congés</h1><Forbidden what="les absences" /></>;
  const canDecide = me.data?.permissions.includes("leave.write"), canAdjust = me.data?.permissions.includes("leave.adjust");
  return (
    <>
      <h1>Absences et congés</h1>
      <ErrorBox error={list.error ?? act.error ?? adjust.error} prefix="Erreur" />
      <div className="split">
        <section className="card main" aria-labelledby="l"><div className="card-h"><h2 id="l">Demandes</h2></div>
          {list.data?.length === 0 && <div className="empty"><h3>Aucune demande</h3></div>}
          {!!list.data?.length && <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th scope="col">Consultant</th><th scope="col">Type</th><th scope="col">Période</th><th scope="col" className="r">Jours</th><th scope="col">Statut</th><th scope="col">Actions</th></tr></thead>
            <tbody>{list.data.map(r => <tr key={r.id}><td>{r.consultant}</td><td>{LEAVE_TYPE[r.type]}</td><td className="num">{fmtDate(r.startDate)} → {fmtDate(r.endDate)}</td>
              <td className="r num">{dayFmt(r.days)}{!r.holidaysConfigured && <span title="Aucun férié approuvé paramétré : décompte à vérifier" aria-label="Décompte à vérifier"> ⚠</span>}</td>
              <td><Badge map={LEAVE_STATUS} value={r.status} />{r.rejectReason && <div className="small muted">{r.rejectReason}</div>}</td>
              <td>{r.status === "submitted" && canDecide && (rejecting === r.id
                ? <form className="row" style={{ gap: 6 }} onSubmit={e => { e.preventDefault(); act.mutate({ id: r.id, event: "reject", rejectReason: reason }); }}>
                    <label className="label" htmlFor={`r-${r.id}`} style={{ position: "absolute", left: -999 }}>Motif du refus</label>
                    <input id={`r-${r.id}`} className="input" style={{ width: 180 }} placeholder="Motif (obligatoire)" value={reason} onChange={e => setReason(e.target.value)} required minLength={3} />
                    <button className="btn btn-danger btn-sm" disabled={act.isPending || reason.trim().length < 3}>Confirmer</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setRejecting(null)}>Annuler</button></form>
                : <div className="row" style={{ gap: 6 }}><button className="btn btn-primary btn-sm" disabled={act.isPending} onClick={() => act.mutate({ id: r.id, event: "approve" })}>Approuver {dayFmt(r.days)} j</button><button className="btn btn-secondary btn-sm" onClick={() => { setRejecting(r.id); setReason(""); }}>Refuser</button></div>)}</td></tr>)}</tbody></table></div>}
        </section>
        {canAdjust && <form className="card side" onSubmit={e => { e.preventDefault(); adjust.mutate(); }} aria-labelledby="a"><div className="card-h"><h2 id="a">Ajuster un solde</h2></div>
          <div className="card-b stack" style={{ gap: 16 }}>
            <p className="hint">Solde initial, acquisition ou correction : chaque ajustement est motivé et non modifiable. Les taux d’acquisition légaux ne sont pas appliqués automatiquement.</p>
            <div className="field"><label className="label" htmlFor="c">Consultant</label><select id="c" className="input" value={adj.consultantId} onChange={e => setAdj({ ...adj, consultantId: e.target.value })} required><option value="">Choisir…</option>{cons.data?.map(c => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}</select>
              {bal.data && <span className="hint">Solde actuel : {dayFmt(bal.data.paidLeaveDays)} j</span>}</div>
            <div className="field"><label className="label" htmlFor="d">Jours (+ ou −)</label><input id="d" className="input" inputMode="decimal" value={adj.days} onChange={e => setAdj({ ...adj, days: e.target.value })} required /></div>
            <div className="field"><label className="label" htmlFor="m">Motif</label><input id="m" className="input" value={adj.reason} onChange={e => setAdj({ ...adj, reason: e.target.value })} required minLength={5} /></div>
          </div><div className="card-f"><button className="btn btn-primary" disabled={adjust.isPending}>Enregistrer l’ajustement</button></div></form>}
      </div>
    </>
  );
}
