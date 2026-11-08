"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { ErrorBox } from "./ui";

export type Finding = { severity: "info" | "warning" | "blocker"; text: string; sources: { entity: string; id: string; label?: string }[]; uncertain?: boolean };
export type Proposal = { id: string; tool: string; summary: string; riskAmount: string | null; requiredApprovals: number; status: string; error: string | null; approvals: { userId: string; decision: string; comment: string | null }[] };
export type Run = { id: string; agentKey: string; playbook: string; status: string; error: string | null; toolCallCount: number; usage: { provider: string }; summary: { findings: Finding[]; proposals: number; skippedDuplicates: number; note: string } | null; toolCalls: { id: string; tool: string; kind: string; status: string }[]; proposals: Proposal[] };

const SEV: Record<string, { label: string; cls: string }> = { blocker: { label: "Bloquant", cls: "b-danger" }, warning: { label: "À traiter", cls: "b-warning" }, info: { label: "Information", cls: "b-info" } };
export const RUN_STATUS: Record<string, { label: string; cls: string }> = { running: { label: "En cours", cls: "b-info" }, awaiting_approval: { label: "En attente d’approbation", cls: "b-warning" }, completed: { label: "Terminée", cls: "b-success" }, failed: { label: "Échec", cls: "b-danger" }, cancelled: { label: "Annulée", cls: "b-neutral" } };
const PROP: Record<string, { label: string; cls: string }> = { pending: { label: "À approuver", cls: "b-warning" }, approved: { label: "Approuvée", cls: "b-info" }, executed: { label: "Exécutée", cls: "b-success" }, failed: { label: "Échec d’exécution", cls: "b-danger" }, rejected: { label: "Rejetée", cls: "b-neutral" } };

export function RunView({ run, canApprove, canCancel }: { run: Run; canApprove: boolean; canCancel: boolean }) {
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState<string | null>(null); const [comment, setComment] = useState("");
  const refresh = () => { setRejecting(null); setComment(""); qc.invalidateQueries({ queryKey: ["agent-runs"] }); qc.invalidateQueries({ queryKey: ["agent-run", run.id] }); qc.invalidateQueries({ queryKey: ["timesheets"] }); qc.invalidateQueries({ queryKey: ["invoices"] }); };
  const decide = useMutation({ mutationFn: (a: { id: string; decision: string; comment?: string }) => api(`agent-proposals/${a.id}/decision`, { method: "POST", body: { decision: a.decision, comment: a.comment } }), onSuccess: refresh });
  const cancel = useMutation({ mutationFn: () => api(`agent-runs/${run.id}/cancel`, { method: "POST" }), onSuccess: refresh });
  const st = RUN_STATUS[run.status];
  return (
    <section className="card" aria-label={`Exécution ${run.playbook}`} aria-live="polite">
      <div className="card-h"><h3>{run.agentKey} · {run.playbook}</h3><span className={`badge ${st?.cls}`}>{st?.label}</span></div>
      <div className="card-b stack">
        <ErrorBox error={decide.error ?? cancel.error} prefix="Action impossible" />
        {run.error && <div className="alert a-danger" role="alert"><span>{run.error}</span></div>}
        {run.summary?.findings.map((f, i) => (
          <div key={i} className="stack" style={{ gap: 4 }}>
            <div className="row" style={{ gap: 8 }}><span className={`badge ${SEV[f.severity]?.cls}`}>{SEV[f.severity]?.label}</span><span>{f.text}</span>{f.uncertain && <span className="tag" title="Aucune source : résultat incertain">Incertain</span>}</div>
            {!!f.sources.length && <div className="small muted">Sources : {f.sources.slice(0, 6).map(s => s.label ?? `${s.entity} ${s.id.slice(0, 8)}`).join(" · ")}{f.sources.length > 6 ? ` … (+${f.sources.length - 6})` : ""}</div>}
          </div>))}
        {!!run.proposals.length && <h4>Actions proposées (rien n’est exécuté sans approbation humaine)</h4>}
        {run.proposals.map(p => (
          <div key={p.id} className="card" style={{ boxShadow: "none" }}>
            <div className="card-b stack" style={{ gap: 8 }}>
              <div className="row between"><b>{p.summary}</b><span className={`badge ${PROP[p.status]?.cls}`}>{PROP[p.status]?.label}</span></div>
              <div className="small muted">Approbations : {p.approvals.filter(a => a.decision === "approve").length} / {p.requiredApprovals}{p.requiredApprovals > 1 ? " (deux personnes distinctes : seuil de montant paramétré dépassé)" : ""}{p.error && ` · ${p.error}`}</div>
              {p.status === "pending" && canApprove && (rejecting === p.id
                ? <form className="row" style={{ gap: 6 }} onSubmit={e => { e.preventDefault(); decide.mutate({ id: p.id, decision: "reject", comment }); }}>
                    <label className="label" htmlFor={`c-${p.id}`} style={{ position: "absolute", left: -999 }}>Motif du rejet</label>
                    <input id={`c-${p.id}`} className="input" style={{ width: 220 }} placeholder="Motif du rejet (obligatoire)" value={comment} onChange={e => setComment(e.target.value)} required minLength={3} />
                    <button className="btn btn-danger btn-sm" disabled={decide.isPending || comment.trim().length < 3}>Confirmer le rejet</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setRejecting(null)}>Annuler</button></form>
                : <div className="row" style={{ gap: 6 }}><button className="btn btn-primary btn-sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: p.id, decision: "approve" })}>Approuver</button><button className="btn btn-secondary btn-sm" onClick={() => { setRejecting(p.id); setComment(""); }}>Rejeter</button></div>)}
            </div>
          </div>))}
        <details><summary className="small muted" style={{ cursor: "pointer" }}>Journal d’exécution ({run.toolCallCount} appel(s) d’outils · fournisseur : {run.usage.provider === "none" ? "aucun (playbook déterministe)" : run.usage.provider})</summary>
          <ul className="small" style={{ margin: "8px 0 0", paddingLeft: 18 }}>{run.toolCalls.map(c => <li key={c.id}><span className="mono">{c.tool}</span> — {c.kind === "read" ? "lecture" : "proposition"} ({c.status})</li>)}</ul></details>
      </div>
      {canCancel && (run.status === "awaiting_approval") && <div className="card-f"><button className="btn btn-ghost" disabled={cancel.isPending} onClick={() => cancel.mutate()}>Annuler l’exécution</button></div>}
    </section>
  );
}
