"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Badge, ErrorBox, TS_STATUS, dayFmt } from "@/lib/ui";

type M = { id: string; title: string; company: { name: string } };
type T = { id: string; period: string; status: string; missionId: string; missionTitle: string; totalDays: string; rejectReason: string | null; lines: { date: string; quantity: string }[] };

export default function MyTimesheetsPage() {
  const qc = useQueryClient();
  const missions = useQuery({ queryKey: ["me-missions"], queryFn: () => api<M[]>("me/missions") });
  const sheets = useQuery({ queryKey: ["me-ts"], queryFn: () => api<T[]>("me/timesheets") });
  const [missionId, setMissionId] = useState(""); const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [qty, setQty] = useState<Record<string, string>>({});
  const current = sheets.data?.find(t => t.missionId === missionId && t.period === period);
  const editable = !current || current.status === "draft";
  useEffect(() => { if (!missionId && missions.data?.[0]) setMissionId(missions.data[0].id); }, [missions.data, missionId]);
  useEffect(() => { setQty(Object.fromEntries((current?.lines ?? []).map(l => [l.date, l.quantity]))); }, [current?.id, current?.totalDays, period, missionId]);
  const [y, m] = period.split("-").map(Number) as [number, number];
  const nDays = new Date(y, m, 0).getDate();
  const refresh = () => qc.invalidateQueries({ queryKey: ["me-ts"] });
  const save = useMutation({
    mutationFn: () => api(`me/timesheets/missions/${missionId}/${period}`, { method: "PUT", body: { lines: Object.entries(qty).filter(([, v]) => v).map(([date, quantity]) => ({ date, quantity })) } }),
    onSuccess: refresh,
  });
  const move = useMutation({ mutationFn: (a: { id: string; event: string }) => api(`me/timesheets/${a.id}/transition`, { method: "POST", body: { event: a.event } }), onSuccess: refresh });
  const total = Object.values(qty).reduce((s, v) => s + (v ? Number(v) : 0), 0);
  return (
    <>
      <h1>Mes CRA</h1>
      <ErrorBox error={missions.error ?? sheets.error ?? save.error ?? move.error} prefix="Erreur" />
      {missions.data?.length === 0 && <div className="alert a-info" role="note"><span>Aucune mission ne vous est rattachée pour le moment.</span></div>}
      {!!missions.data?.length && (
        <section className="card" aria-labelledby="s">
          <div className="card-h"><h2 id="s">Saisie</h2>{current && <Badge map={TS_STATUS} value={current.status} />}</div>
          <div className="card-b stack">
            <div className="row">
              <div className="field" style={{ minWidth: 260 }}><label className="label" htmlFor="mi">Mission</label><select id="mi" className="input" value={missionId} onChange={e => setMissionId(e.target.value)}>{missions.data.map(x => <option key={x.id} value={x.id}>{x.title} — {x.company.name}</option>)}</select></div>
              <div className="field"><label className="label" htmlFor="pe">Mois</label><input id="pe" className="input" type="month" value={period} onChange={e => setPeriod(e.target.value)} /></div>
            </div>
            {current?.rejectReason && <div className="alert a-danger" role="alert"><span>Refusé par le client : {current.rejectReason}</span></div>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(96px,1fr))", gap: 8 }}>
              {Array.from({ length: nDays }, (_, i) => { const date = `${period}-${String(i + 1).padStart(2, "0")}`; return (
                <div className="field" key={date}><label className="label small" htmlFor={`d${date}`}>{String(i + 1).padStart(2, "0")}</label>
                  <select id={`d${date}`} className="input" disabled={!editable} value={qty[date] ?? ""} onChange={e => setQty(p => ({ ...p, [date]: e.target.value }))}><option value="">—</option><option value="0.5">½ j</option><option value="1">1 j</option></select></div>); })}
            </div>
            <p><b>Total : {dayFmt(total)} jour(s)</b></p>
          </div>
          <div className="card-f">
            {editable && <button className="btn btn-secondary" disabled={save.isPending} onClick={() => save.mutate()}>Enregistrer le brouillon</button>}
            {current?.status === "draft" && <button className="btn btn-primary" disabled={move.isPending} onClick={() => move.mutate({ id: current.id, event: "submit" })}>Soumettre {dayFmt(current.totalDays)} jour(s)</button>}
            {current?.status === "submitted" && <button className="btn btn-ghost" disabled={move.isPending} onClick={() => move.mutate({ id: current.id, event: "recall" })}>Rappeler</button>}
            {current?.status === "client_rejected" && <button className="btn btn-secondary" disabled={move.isPending} onClick={() => move.mutate({ id: current.id, event: "reopen" })}>Rouvrir pour corriger</button>}
          </div>
        </section>)}
      <section className="card" aria-labelledby="h"><div className="card-h"><h2 id="h">Historique</h2></div>
        {sheets.data?.length === 0 && <div className="empty"><p className="muted">Aucun CRA.</p></div>}
        {!!sheets.data?.length && <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th scope="col">Période</th><th scope="col">Mission</th><th scope="col" className="r">Jours</th><th scope="col">Statut</th></tr></thead>
          <tbody>{sheets.data.map(t => <tr key={t.id}><td className="num">{t.period}</td><td>{t.missionTitle}</td><td className="r num">{dayFmt(t.totalDays)}</td><td><Badge map={TS_STATUS} value={t.status} /></td></tr>)}</tbody></table></div>}
      </section>
    </>
  );
}
