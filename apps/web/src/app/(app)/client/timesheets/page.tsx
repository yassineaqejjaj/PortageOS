"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorBox, TS_STATUS, Badge, dayFmt } from "@/lib/ui";

type T = { id: string; period: string; status: string; missionTitle: string; consultantName: string; totalDays: string; lines: { date: string; quantity: string }[] };

export default function ClientTimesheetsPage() {
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const q = useQuery({ queryKey: ["client-ts"], queryFn: () => api<T[]>("client/timesheets") });
  const done = () => { setRejecting(null); setReason(""); qc.invalidateQueries({ queryKey: ["client-ts"] }); };
  const act = useMutation({ mutationFn: (a: { id: string; event: "approve" | "reject"; rejectReason?: string }) => api(`client/timesheets/${a.id}/transition`, { method: "POST", body: { event: a.event, rejectReason: a.rejectReason } }), onSuccess: done });
  return (
    <>
      <h1>CRA à valider</h1>
      <p className="muted">Vous voyez uniquement les jours déclarés pour votre entreprise. Aucune donnée de rémunération n’est affichée.</p>
      {q.isLoading && <p className="muted">Chargement…</p>}
      <ErrorBox error={q.error ?? act.error} prefix="Erreur" />
      {q.data?.length === 0 && <div className="card empty"><h3>Aucun CRA en attente</h3></div>}
      {q.data?.map(t => (
        <section key={t.id} className="card" aria-label={`CRA ${t.period}`}>
          <div className="card-h"><h2>{t.consultantName} — {t.period}</h2><Badge map={TS_STATUS} value={t.status} /></div>
          <div className="card-b stack"><p>{t.missionTitle} · <b>{dayFmt(t.totalDays)} jour(s)</b></p>
            <p className="small muted">{t.lines.map(l => `${l.date.slice(8)}${l.quantity === "0.5" ? "½" : ""}`).join(" · ")}</p>
            {rejecting === t.id && (
              <div className="field"><label className="label" htmlFor={`r-${t.id}`}>Motif du refus (obligatoire)</label><input id={`r-${t.id}`} className="input" value={reason} onChange={e => setReason(e.target.value)} /></div>)}
          </div>
          <div className="card-f">
            {rejecting === t.id ? <>
              <button className="btn btn-ghost" onClick={() => setRejecting(null)}>Annuler</button>
              <button className="btn btn-danger" disabled={act.isPending || reason.trim().length < 3} onClick={() => act.mutate({ id: t.id, event: "reject", rejectReason: reason })}>Confirmer le refus</button></> : <>
              <button className="btn btn-secondary" onClick={() => { setRejecting(t.id); setReason(""); }}>Refuser</button>
              <button className="btn btn-primary" disabled={act.isPending} onClick={() => act.mutate({ id: t.id, event: "approve" })}>Valider {dayFmt(t.totalDays)} jour(s)</button></>}
          </div>
        </section>))}
    </>
  );
}
