"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiText } from "@/lib/api";
import { Badge, ErrorBox, Forbidden, TS_STATUS, UNIT_LABEL, dayFmt, isForbidden } from "@/lib/ui";

type Forfait = { year: string; days: string; cap: number | null; overCap: boolean };
type T = { id: string; period: string; status: string; missionTitle: string; unit: string; forfait: Forfait | null; consultantName: string; totalDays: string; rejectReason: string | null };

export default function TimesheetsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const q = useQuery({ queryKey: ["timesheets", status], queryFn: () => api<T[]>(`timesheets${status ? `?status=${status}` : ""}`) });
  const act = useMutation({
    mutationFn: (a: { id: string; event: string }) => api(`timesheets/${a.id}/transition`, { method: "POST", body: { event: a.event } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["timesheets"] }),
  });
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const remind = useMutation({ mutationFn: () => api<{ concerned: number; sent: number; alreadyRemindedToday: number; channel: string }>("timesheets/reminders", { method: "POST", body: { period } }) });
  const exp = useMutation({ mutationFn: async () => {
    const text = await apiText(`timesheets/export.csv?period=${period}`);
    const url = URL.createObjectURL(new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `cra-${period}.csv`; a.click(); URL.revokeObjectURL(url);
  } });
  if (isForbidden(q.error)) return <><h1>Activité / CRA</h1><Forbidden what="les CRA" /></>;
  return (
    <>
      <div className="row between"><h1>Activité / CRA</h1>
        <div className="field" style={{ minWidth: 240 }}><label className="label" htmlFor="f">Statut</label>
          <select id="f" className="input" value={status} onChange={e => setStatus(e.target.value)}><option value="">Tous</option>{Object.entries(TS_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div></div>
      <section className="card" aria-label="Relances et export">
        <div className="card-b row" style={{ alignItems: "flex-end", gap: 12 }}>
          <div className="field"><label className="label" htmlFor="rp">Mois</label><input id="rp" className="input" type="month" value={period} onChange={e => setPeriod(e.target.value)} /></div>
          <button className="btn btn-secondary" disabled={remind.isPending || !/^\d{4}-\d{2}$/.test(period)} onClick={() => remind.mutate()}>Relancer les CRA manquants</button>
          <button className="btn btn-ghost" disabled={exp.isPending || !/^\d{4}-\d{2}$/.test(period)} onClick={() => exp.mutate()}>Exporter en CSV</button>
        </div>
        <ErrorBox error={remind.error ?? exp.error} prefix="Erreur" />
        {remind.data && <div className="alert a-info" role="status"><span>{remind.data.sent} relance(s) envoyée(s) sur {remind.data.concerned} CRA absent(s) ou en brouillon ({remind.data.alreadyRemindedToday} déjà relancé(s) aujourd'hui). Canal : {remind.data.channel}.</span></div>}
      </section>
      <section className="card" aria-label="CRA">
        {q.isLoading && <div className="card-b muted">Chargement…</div>}
        <ErrorBox error={q.error ?? act.error} prefix="Erreur" />
        {q.data?.length === 0 && <div className="empty"><h3>Aucun CRA</h3><p className="muted">Les CRA sont saisis par les consultants depuis leur portail.</p></div>}
        {!!q.data?.length && <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th scope="col">Période</th><th scope="col">Consultant</th><th scope="col">Mission</th><th scope="col" className="r">Quantité</th><th scope="col">Statut</th><th scope="col">Actions</th></tr></thead>
          <tbody>{q.data.map(t => <tr key={t.id}><td className="num">{t.period}</td><td>{t.consultantName}</td><td>{t.missionTitle}</td><td className="r num">{dayFmt(t.totalDays)} {(UNIT_LABEL[t.unit] ?? UNIT_LABEL.day!).short}{t.forfait?.overCap && <div className="small" style={{ color: "var(--color-status-danger)" }}>Plafond annuel saisi dépassé ({dayFmt(t.forfait.days)}/{t.forfait.cap} j)</div>}</td>
            <td><Badge map={TS_STATUS} value={t.status} />{t.rejectReason && <div className="small muted">{t.rejectReason}</div>}</td>
            <td><div className="row" style={{ gap: 6 }}>
              {t.status === "client_approved" && <button className="btn btn-primary btn-sm" disabled={act.isPending} onClick={() => act.mutate({ id: t.id, event: "validate" })}>Valider {dayFmt(t.totalDays)} {(UNIT_LABEL[t.unit] ?? UNIT_LABEL.day!).short}</button>}
              {t.status === "client_approved" && <button className="btn btn-ghost btn-sm" disabled={act.isPending} onClick={() => act.mutate({ id: t.id, event: "reopen_approved" })}>Rouvrir</button>}
              {t.status === "submitted" && <button className="btn btn-ghost btn-sm" disabled={act.isPending} onClick={() => act.mutate({ id: t.id, event: "recall" })}>Rappeler</button>}
              {t.status === "client_rejected" && <button className="btn btn-secondary btn-sm" disabled={act.isPending} onClick={() => act.mutate({ id: t.id, event: "reopen" })}>Rouvrir en brouillon</button>}
            </div></td></tr>)}</tbody></table></div>}
      </section>
    </>
  );
}
