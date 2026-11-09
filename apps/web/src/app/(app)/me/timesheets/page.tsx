"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Badge, ErrorBox, TS_STATUS, UNIT_LABEL, dayFmt } from "@/lib/ui";

type Forfait = { year: string; days: string; cap: number | null; overCap: boolean; capNote: string };
type M = { id: string; title: string; timeUnit: string; annualDaysCap: number | null; company: { name: string } };
type T = { id: string; period: string; status: string; missionId: string; missionTitle: string; unit: string; forfait: Forfait | null; totalDays: string; rejectReason: string | null; lines: { date: string; quantity: string }[] };

export default function MyTimesheetsPage() {
  const qc = useQueryClient();
  const missions = useQuery({ queryKey: ["me-missions"], queryFn: () => api<M[]>("me/missions") });
  const [missionId, setMissionId] = useState(""); const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const sheets = useQuery({ queryKey: ["me-ts"], queryFn: () => api<T[]>("me/timesheets") });
  // La feuille éditée est chargée par période (la liste d'historique est bornée aux plus récentes).
  const selected = useQuery({ queryKey: ["me-ts", "period", period], queryFn: () => api<T[]>(`me/timesheets?period=${period}`), enabled: /^\d{4}-\d{2}$/.test(period) });
  const [qty, setQty] = useState<Record<string, string>>({});
  const current = selected.data?.find(t => t.missionId === missionId && t.period === period);
  const mission = missions.data?.find(x => x.id === missionId);
  const unit = mission?.timeUnit ?? "day"; const U = UNIT_LABEL[unit] ?? UNIT_LABEL.day!;
  const [csv, setCsv] = useState(""); const [showCsv, setShowCsv] = useState(false);
  const importCsv = useMutation({ mutationFn: () => api(`me/timesheets/missions/${missionId}/${period}/import`, { method: "PUT", body: { csv } }), onSuccess: () => { setCsv(""); setShowCsv(false); refresh(); } });
  const editable = !current || current.status === "draft";
  useEffect(() => { if (!missionId && missions.data?.[0]) setMissionId(missions.data[0].id); }, [missions.data, missionId]);
  useEffect(() => { setQty(Object.fromEntries((current?.lines ?? []).map(l => [l.date, l.quantity]))); }, [current?.id, current?.totalDays, period, missionId]);
  const [y, m] = period.split("-").map(Number) as [number, number];
  const nDays = new Date(y, m, 0).getDate();
  const refresh = () => qc.invalidateQueries({ queryKey: ["me-ts"] }); // invalide aussi la feuille par période (même préfixe)
  const save = useMutation({
    mutationFn: () => api(`me/timesheets/missions/${missionId}/${period}`, { method: "PUT", body: { lines: Object.entries(qty).filter(([, v]) => v).map(([date, quantity]) => ({ date, quantity })) } }),
    onSuccess: refresh,
  });
  const move = useMutation({ mutationFn: (a: { id: string; event: string }) => api(`me/timesheets/${a.id}/transition`, { method: "POST", body: { event: a.event } }), onSuccess: refresh });
  const total = Object.values(qty).reduce((s, v) => s + (v ? Number(v) : 0), 0);
  return (
    <>
      <h1>Mes CRA</h1>
      <ErrorBox error={missions.error ?? sheets.error ?? save.error ?? move.error ?? importCsv.error} prefix="Erreur" />
      {missions.data?.length === 0 && <div className="alert a-info" role="note"><span>Aucune mission ne vous est rattachée pour le moment.</span></div>}
      {!!missions.data?.length && !missionId && <p className="muted" aria-live="polite">Chargement de la saisie…</p>}
      {!!missions.data?.length && !!missionId && (
        <section className="card" aria-labelledby="s">
          <div className="card-h"><h2 id="s">Saisie</h2>{current && <Badge map={TS_STATUS} value={current.status} />}</div>
          <div className="card-b stack">
            <div className="row">
              <div className="field" style={{ minWidth: 260 }}><label className="label" htmlFor="mi">Mission</label><select id="mi" className="input" value={missionId} onChange={e => setMissionId(e.target.value)}>{missions.data.map(x => <option key={x.id} value={x.id}>{x.title} — {x.company.name}</option>)}</select></div>
              <div className="field"><label className="label" htmlFor="pe">Mois</label><input id="pe" className="input" type="month" value={period} onChange={e => setPeriod(e.target.value)} /></div>
            </div>
            <p className="muted small">Unité de cette mission : <b>{unit === "hour" ? "heures" : unit === "forfait_jours" ? "forfait jours" : "jours"}</b>.</p>
            {current?.forfait && <div className={`alert ${current.forfait.overCap ? "a-warning" : "a-info"}`} role={current.forfait.overCap ? "alert" : "note"}><span>Forfait jours {current.forfait.year} : <b>{dayFmt(current.forfait.days)} j</b> déclarés (CRA soumis ou plus avancés){current.forfait.cap !== null ? <> pour un plafond saisi de {current.forfait.cap} j{current.forfait.overCap ? " : dépassé" : ""}</> : " ; aucun plafond saisi"}. {current.forfait.capNote}</span></div>}
            {current?.rejectReason && <div className="alert a-danger" role="alert"><span>Refusé par le client : {current.rejectReason}</span></div>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(96px,1fr))", gap: 8 }}>
              {Array.from({ length: nDays }, (_, i) => { const date = `${period}-${String(i + 1).padStart(2, "0")}`; return (
                <div className="field" key={date}><label className="label small" htmlFor={`d${date}`}>{String(i + 1).padStart(2, "0")}</label>
                  {unit === "hour"
                    ? <input id={`d${date}`} className="input" type="number" inputMode="decimal" min="0" max="24" step="0.25" placeholder="h" disabled={!editable} value={qty[date] ?? ""} onChange={e => setQty(p => ({ ...p, [date]: e.target.value }))} />
                    : <select id={`d${date}`} className="input" disabled={!editable} value={qty[date] ?? ""} onChange={e => setQty(p => ({ ...p, [date]: e.target.value }))}><option value="">—</option><option value="0.5">½ j</option><option value="1">1 j</option></select>}</div>); })}
            </div>
            <p><b>Total : {dayFmt(total)} {U.many}</b></p>
            {editable && <div><button type="button" className="btn btn-ghost btn-sm" aria-expanded={showCsv} onClick={() => setShowCsv(v => !v)}>Importer un CSV</button>
              {showCsv && <div className="stack" style={{ marginTop: 8 }}><label className="label" htmlFor="csv">Une ligne par jour : date (AAAA-MM-JJ) puis quantité, séparées par « ; »</label>
                <textarea id="csv" className="input" rows={5} value={csv} onChange={e => setCsv(e.target.value)} placeholder={"date;quantite\n" + period + "-02;" + (unit === "hour" ? "7,5" : "1")} />
                <div><button type="button" className="btn btn-secondary btn-sm" disabled={!csv.trim() || importCsv.isPending} onClick={() => importCsv.mutate()}>Remplacer le brouillon par ce fichier</button> <span className="hint">Tout ou rien : une erreur n'enregistre aucune ligne. Remplace la saisie du mois.</span></div></div>}</div>}
          </div>
          <div className="card-f">
            {editable && <button className="btn btn-secondary" disabled={save.isPending} onClick={() => save.mutate()}>Enregistrer le brouillon</button>}
            {current?.status === "draft" && <button className="btn btn-primary" disabled={move.isPending} onClick={() => move.mutate({ id: current.id, event: "submit" })}>Soumettre {dayFmt(current.totalDays)} {(UNIT_LABEL[current.unit] ?? U).many}</button>}
            {current?.status === "submitted" && <button className="btn btn-ghost" disabled={move.isPending} onClick={() => move.mutate({ id: current.id, event: "recall" })}>Rappeler</button>}
            {current?.status === "client_rejected" && <button className="btn btn-secondary" disabled={move.isPending} onClick={() => move.mutate({ id: current.id, event: "reopen" })}>Rouvrir pour corriger</button>}
          </div>
        </section>)}
      <section className="card" aria-labelledby="h"><div className="card-h"><h2 id="h">Historique</h2></div>
        {sheets.data?.length === 0 && <div className="empty"><p className="muted">Aucun CRA.</p></div>}
        {!!sheets.data?.length && <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th scope="col">Période</th><th scope="col">Mission</th><th scope="col" className="r">Quantité</th><th scope="col">Statut</th></tr></thead>
          <tbody>{sheets.data.map(t => <tr key={t.id}><td className="num">{t.period}</td><td>{t.missionTitle}</td><td className="r num">{dayFmt(t.totalDays)} {(UNIT_LABEL[t.unit] ?? UNIT_LABEL.day!).short}</td><td><Badge map={TS_STATUS} value={t.status} /></td></tr>)}</tbody></table></div>}
      </section>
    </>
  );
}
