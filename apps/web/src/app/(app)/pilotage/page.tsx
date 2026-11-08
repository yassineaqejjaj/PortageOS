"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorBox, Forbidden, dayFmt, isForbidden, nf } from "@/lib/ui";

type Overview = {
  period: { from: string; to: string; days: number; asOf: string }; definitions: Record<string, string>;
  totals: { invoicedNet: string; invoicedGross: string; collectedNet: string; managementFee: string | null }; feeStatus: string;
  series: { month: string; invoicedNet: string; invoicedGross: string; collectedNet: string; managementFee: string | null }[];
  receivables: { outstanding: string; aging: { bucket: string; amount: string }[]; dso: string | null };
  portfolio: { activeConsultants: number; onboardingConsultants: number; activeMissions: number };
  pipeline: { created: number; stages: Record<string, number>; conversionRatePercent: string | null };
  operations: { timesheets: { submitted: number; clientApproved: number; clientRejected: number; validatedNotInvoiced: number }; pendingExpenses: number; pendingLeaves: number; avgClientApprovalDelayDays: string | null };
  backlog: { toInvoiceNet: string; inProgressNet: string };
  cohorts: { cohort: string; size: number; billedByOffset: number[] }[]; topConsultants: { consultantId: string; name: string; invoicedNet: string }[]; notApplicable: string[];
};
const month = (offset = 0) => { const d = new Date(); d.setMonth(d.getMonth() + offset); return d.toISOString().slice(0, 7); };

function Kpi({ label, value, unit, source, def }: { label: string; value: string; unit?: string; source: string; def: string }) {
  return (
    <div className="card kpi">
      <span className="eyebrow">{label}</span>
      <span className="v">{value}{unit && <span className="muted" style={{ fontSize: 14, fontWeight: 500 }}> {unit}</span>}</span>
      <span className="src">{source}</span>
      <details><summary className="small muted" style={{ cursor: "pointer" }}>Définition</summary><p className="small" style={{ marginTop: 4 }}>{def}</p></details>
    </div>
  );
}

/** Histogramme groupé : valeurs écrites sur les barres (information non portée par la couleur seule) ; le tableau dessous est l'alternative accessible. */
function Chart({ rows }: { rows: Overview["series"] }) {
  const max = Math.max(1, ...rows.flatMap(r => [Number(r.invoicedNet), Number(r.collectedNet)]));
  const W = Math.max(480, rows.length * 110), H = 220, base = 190, bw = 34;
  const fmt = (v: string) => Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 0 });
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Chiffre d'affaires HT facturé et encaissé par mois, de ${rows[0]?.month} à ${rows[rows.length - 1]?.month}. Les valeurs sont dans le tableau ci-dessous.`} style={{ width: "100%", height: "auto" }}>
        <line x1="0" y1={base} x2={W} y2={base} stroke="var(--color-border-strong)" />
        {rows.map((r, i) => { const x = 20 + i * ((W - 40) / rows.length), a = (Number(r.invoicedNet) / max) * 150, b = (Number(r.collectedNet) / max) * 150; return (
          <g key={r.month}>
            <rect x={x} y={base - a} width={bw} height={a} fill="var(--color-action-primary)" /><text x={x + bw / 2} y={base - a - 4} textAnchor="middle" fontSize="10" fill="var(--color-text-primary)">{fmt(r.invoicedNet)}</text>
            <rect x={x + bw + 4} y={base - b} width={bw} height={b} fill="var(--color-action-accent)" /><text x={x + bw + 4 + bw / 2} y={base - b - 4} textAnchor="middle" fontSize="10" fill="var(--color-text-primary)">{fmt(r.collectedNet)}</text>
            <text x={x + bw + 2} y={base + 16} textAnchor="middle" fontSize="11" fill="var(--color-text-secondary)">{r.month}</text>
          </g>); })}
      </svg>
      <figcaption className="small row" style={{ gap: 16 }}><span><span aria-hidden="true" style={{ display: "inline-block", width: 10, height: 10, background: "var(--color-action-primary)", marginRight: 6 }} />CA HT facturé</span><span><span aria-hidden="true" style={{ display: "inline-block", width: 10, height: 10, background: "var(--color-action-accent)", marginRight: 6 }} />Encaissé HT</span><span className="muted">en euros</span></figcaption>
    </figure>
  );
}

export default function PilotagePage() {
  const [from, setFrom] = useState(month(-5)); const [to, setTo] = useState(month());
  const q = useQuery({ queryKey: ["pilotage", from, to], queryFn: () => api<Overview>(`pilotage/overview?from=${from}&to=${to}`), enabled: /^\d{4}-\d{2}$/.test(from) && /^\d{4}-\d{2}$/.test(to) });
  const [exportErr, setExportErr] = useState<string | null>(null);
  async function exportCsv() {
    setExportErr(null);
    const r = await fetch(`/api/proxy/pilotage/export.csv?from=${from}&to=${to}`);
    if (!r.ok) { setExportErr("Export impossible"); return; }
    const url = URL.createObjectURL(await r.blob()); const a = document.createElement("a"); a.href = url; a.download = `pilotage-${from}-${to}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  if (isForbidden(q.error)) return <><h1>Pilotage</h1><Forbidden what="le pilotage" /></>;
  const o = q.data; const src = o ? `Période ${o.period.from} → ${o.period.to}` : "";
  return (
    <>
      <div className="row between"><h1>Pilotage</h1>
        <div className="row" style={{ gap: 8 }}>
          <div className="field"><label className="label small" htmlFor="f">Du</label><input id="f" className="input" type="month" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div className="field"><label className="label small" htmlFor="t">Au</label><input id="t" className="input" type="month" value={to} onChange={e => setTo(e.target.value)} /></div>
          <button className="btn btn-secondary" onClick={exportCsv} style={{ alignSelf: "flex-end" }} disabled={!o}>Exporter en CSV</button>
        </div></div>
      <ErrorBox error={q.error} prefix="Erreur" />{exportErr && <div className="alert a-danger" role="alert"><span>{exportErr}</span></div>}
      {q.isLoading && <p className="muted" aria-live="polite">Calcul des indicateurs…</p>}
      {o && (<>
        <p className="muted small">Chiffres calculés à la date du {o.period.asOf} à partir des factures, encaissements et dossiers enregistrés. Montants en euros ; HT sauf mention contraire.</p>
        {o.feeStatus === "parameter_missing" && <div className="alert a-warning" role="alert"><span>Frais de gestion non calculés : aucun paramètre approuvé « management_fee_rate_percent » à la date de certains encaissements.</span></div>}
        <div className="grid-4">
          <Kpi label="CA HT facturé" value={nf(o.totals.invoicedNet)} source={`${src} · factures émises`} def={o.definitions.invoicedNet!} />
          <Kpi label="Encaissé HT" value={nf(o.totals.collectedNet)} source={`${src} · encaissements`} def={o.definitions.collectedNet!} />
          <Kpi label="Frais de gestion" value={o.totals.managementFee === null ? "non calculés" : nf(o.totals.managementFee)} source={`${src} · paramètre daté`} def={o.definitions.managementFee!} />
          <Kpi label="Créances ouvertes TTC" value={nf(o.receivables.outstanding)} source={`au ${o.period.asOf} · factures`} def={o.definitions.outstanding!} />
          <Kpi label="DSO" value={o.receivables.dso === null ? "—" : dayFmt(o.receivables.dso)} unit={o.receivables.dso === null ? undefined : "jours"} source={`${src} (${o.period.days} j)`} def={o.definitions.dso!} />
          <Kpi label="Consultants actifs" value={String(o.portfolio.activeConsultants)} source={`au ${o.period.asOf} · ${o.portfolio.onboardingConsultants} en onboarding`} def={o.definitions.activeConsultants!} />
          <Kpi label="Conversion des prospects" value={o.pipeline.conversionRatePercent === null ? "—" : dayFmt(o.pipeline.conversionRatePercent)} unit={o.pipeline.conversionRatePercent === null ? undefined : "%"} source={`${src} · ${o.pipeline.created} prospect(s)`} def={o.definitions.conversion!} />
          <Kpi label="Délai d’approbation client" value={o.operations.avgClientApprovalDelayDays === null ? "—" : dayFmt(o.operations.avgClientApprovalDelayDays)} unit={o.operations.avgClientApprovalDelayDays === null ? undefined : "jours"} source={`${src} · journal d’audit`} def={o.definitions.clientApprovalDelay!} />
        </div>
        <section className="card" aria-labelledby="s"><div className="card-h"><h2 id="s">Facturation et encaissements par mois</h2></div>
          <div className="card-b stack"><Chart rows={o.series} />
            <div className="tbl-wrap"><table className="tbl compact"><caption className="small muted" style={{ textAlign: "left", padding: "0 0 8px" }}>Données du graphique</caption><thead><tr><th scope="col">Mois</th><th scope="col" className="r">CA HT</th><th scope="col" className="r">CA TTC</th><th scope="col" className="r">Encaissé HT</th><th scope="col" className="r">Frais de gestion</th></tr></thead>
              <tbody>{o.series.map(r => <tr key={r.month}><td className="num">{r.month}</td><td className="r num">{nf(r.invoicedNet)}</td><td className="r num">{nf(r.invoicedGross)}</td><td className="r num">{nf(r.collectedNet)}</td><td className="r num">{r.managementFee === null ? "—" : nf(r.managementFee)}</td></tr>)}</tbody></table></div></div></section>
        <div className="grid-2" style={{ alignItems: "start" }}>
          <section className="card" aria-labelledby="a"><div className="card-h"><h2 id="a">Ancienneté des créances</h2></div><div className="card-b stack"><p className="small muted">{o.definitions.aging}</p>
            <table className="tbl compact"><thead><tr><th scope="col">Tranche (jours depuis l’émission)</th><th scope="col" className="r">Montant TTC</th></tr></thead><tbody>{o.receivables.aging.map(a => <tr key={a.bucket}><td>{a.bucket}</td><td className="r num">{nf(a.amount)}</td></tr>)}</tbody></table></div></section>
          <section className="card" aria-labelledby="b"><div className="card-h"><h2 id="b">À facturer et en cours</h2></div><div className="card-b stack">
            <div className="calc"><div><span>CRA validés à facturer (HT)</span><b className="num">{nf(o.backlog.toInvoiceNet)}</b></div><div><span>CRA en cours de validation (HT)</span><b className="num">{nf(o.backlog.inProgressNet)}</b></div></div>
            <p className="small muted">{o.definitions.backlog}</p></div></section>
          <section className="card" aria-labelledby="o"><div className="card-h"><h2 id="o">Opérations en attente</h2></div><div className="card-b calc">
            <div><span>CRA soumis (attente client)</span><b className="num">{o.operations.timesheets.submitted}</b></div><div><span>CRA approuvés (attente validation interne)</span><b className="num">{o.operations.timesheets.clientApproved}</b></div>
            <div><span>CRA refusés par le client</span><b className="num">{o.operations.timesheets.clientRejected}</b></div><div><span>CRA validés non facturés</span><b className="num">{o.operations.timesheets.validatedNotInvoiced}</b></div>
            <div><span>Notes de frais à approuver</span><b className="num">{o.operations.pendingExpenses}</b></div><div><span>Absences à traiter</span><b className="num">{o.operations.pendingLeaves}</b></div></div></section>
          <section className="card" aria-labelledby="c"><div className="card-h"><h2 id="c">Consultants par CA HT facturé</h2></div>
            {!o.topConsultants.length ? <div className="empty"><p className="muted">Aucune facture sur la période.</p></div> : <table className="tbl compact"><thead><tr><th scope="col">Consultant</th><th scope="col" className="r">CA HT</th></tr></thead><tbody>{o.topConsultants.map(t => <tr key={t.consultantId}><td>{t.name}</td><td className="r num">{nf(t.invoicedNet)}</td></tr>)}</tbody></table>}</section>
        </div>
        <section className="card" aria-labelledby="co"><div className="card-h"><h2 id="co">Cohortes de consultants</h2></div><div className="card-b stack"><p className="small muted">{o.definitions.cohorts}</p>
          {!o.cohorts.length ? <p className="muted">Aucun consultant.</p> : <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th scope="col">Mois de création</th><th scope="col" className="r">Taille</th>{o.cohorts[0]!.billedByOffset.map((_, i) => <th key={i} scope="col" className="r">M+{i}</th>)}</tr></thead>
            <tbody>{o.cohorts.map(c => <tr key={c.cohort}><td className="num">{c.cohort}</td><td className="r num">{c.size}</td>{c.billedByOffset.map((n, i) => <td key={i} className="r num">{n}</td>)}</tr>)}</tbody></table></div>}</div></section>
        <div className="alert a-info" role="note"><span><b>Non disponible :</b> {o.notApplicable.join(" ; ")}.</span></div>
      </>)}
    </>
  );
}
