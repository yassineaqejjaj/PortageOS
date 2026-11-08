"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { ErrorBox, Forbidden, isForbidden, nf, EXP_STATUS, type Claim } from "@/lib/ui";

const CAT: Record<string, string> = { meal: "Repas", transport: "Transport", hotel: "Hôtel", mileage: "Kilométrage", other: "Autre" };

export default function ExpensesPage() {
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState<string | null>(null); const [reason, setReason] = useState("");
  const q = useQuery({ queryKey: ["expenses"], queryFn: () => api<Claim[]>("expenses") });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ permissions: string[] }>("me") });
  const act = useMutation({ mutationFn: (a: { id: string; event: string; rejectReason?: string }) => api(`expenses/${a.id}/transition`, { method: "POST", body: { event: a.event, rejectReason: a.rejectReason } }), onSuccess: () => { setRejecting(null); setReason(""); qc.invalidateQueries({ queryKey: ["expenses"] }); qc.invalidateQueries({ queryKey: ["ledger"] }); } });
  if (isForbidden(q.error)) return <><h1>Notes de frais</h1><Forbidden what="les notes de frais" /></>;
  const canDecide = me.data?.permissions.includes("expense.write"), canPay = me.data?.permissions.includes("expense.reimburse");
  return (
    <>
      <h1>Notes de frais</h1>
      {q.isLoading && <p className="muted">Chargement…</p>}
      <ErrorBox error={q.error ?? act.error} prefix="Erreur" />
      {q.data?.length === 0 && <div className="card empty"><h3>Aucune note de frais</h3></div>}
      {q.data?.filter(c => c.status !== "draft").map(c => (
        <section key={c.id} className="card" aria-label={c.title}>
          <div className="card-h"><h2>{c.title} — {nf(c.total)}</h2><span className={`badge ${EXP_STATUS[c.status]?.cls}`}>{EXP_STATUS[c.status]?.label}</span></div>
          <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th scope="col">Date</th><th scope="col">Nature</th><th scope="col">Description</th><th scope="col">Justificatif</th><th scope="col" className="r">Montant</th></tr></thead>
            <tbody>{c.lines.map(l => <tr key={l.id}><td className="num">{fmtDate(l.date)}</td><td>{CAT[l.category]}{l.km && <span className="muted small"> ({l.km} km)</span>}</td><td>{l.description}{l.policyFlag && <div className="small" style={{ color: "var(--color-status-warning)" }}>⚠ {l.policyFlag}</div>}</td><td className="mono">{l.receiptRef ?? "—"}</td><td className="r num">{nf(l.amount)}</td></tr>)}</tbody></table></div>
          {c.rejectReason && <div className="card-b"><div className="alert a-danger"><span>Refusée : {c.rejectReason}</span></div></div>}
          {rejecting === c.id && <div className="card-b field"><label className="label" htmlFor={`r-${c.id}`}>Motif du refus (obligatoire)</label><input id={`r-${c.id}`} className="input" value={reason} onChange={e => setReason(e.target.value)} /></div>}
          <div className="card-f">
            {c.status === "submitted" && canDecide && (rejecting === c.id
              ? <><button className="btn btn-ghost" onClick={() => setRejecting(null)}>Annuler</button><button className="btn btn-danger" disabled={act.isPending || reason.trim().length < 3} onClick={() => act.mutate({ id: c.id, event: "reject", rejectReason: reason })}>Confirmer le refus</button></>
              : <><button className="btn btn-secondary" onClick={() => { setRejecting(c.id); setReason(""); }}>Refuser</button><button className="btn btn-primary" disabled={act.isPending} onClick={() => act.mutate({ id: c.id, event: "approve" })}>Approuver {nf(c.total)}</button></>)}
            {c.status === "approved" && canPay && <button className="btn btn-primary" disabled={act.isPending} onClick={() => act.mutate({ id: c.id, event: "reimburse" })}>Marquer remboursée</button>}
          </div>
        </section>))}
    </>
  );
}
