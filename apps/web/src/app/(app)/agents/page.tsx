"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorBox, Forbidden, isForbidden } from "@/lib/ui";
import { RUN_STATUS, Run, RunView } from "@/lib/agents";

type Agent = { key: string; name: string; description: string; available: boolean; unavailableReason?: string; allowedTools: string[];
  playbooks: { key: string; label: string; description: string; permissions: string[]; selfService: boolean }[]; config: { enabled: boolean; maxToolCallsPerRun: number; maxRunsPerDay: number }; runsToday: number };
type Catalog = { orchestrator: string; llm: { status: string; note: string }; agents: Agent[] };

export default function AgentsPage() {
  const qc = useQueryClient();
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ permissions: string[] }>("me") });
  const cat = useQuery({ queryKey: ["agents"], queryFn: () => api<Catalog>("agents") });
  const runs = useQuery({ queryKey: ["agent-runs"], queryFn: () => api<{ id: string; agentKey: string; playbook: string; status: string; startedAt: string; proposals: number; pending: number }[]>("agent-runs") });
  const detail = useQuery({ queryKey: ["agent-run", openRun], queryFn: () => api<Run>(`agent-runs/${openRun}`), enabled: !!openRun });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["agents"] }); qc.invalidateQueries({ queryKey: ["agent-runs"] }); };
  const launch = useMutation({ mutationFn: (a: { agentKey: string; playbook: string; params?: object }) => api<Run>("agent-runs", { method: "POST", body: a }), onSuccess: r => { setOpenRun(r.id); qc.setQueryData(["agent-run", r.id], r); refresh(); } });
  const config = useMutation({ mutationFn: (a: { key: string; enabled: boolean; maxToolCallsPerRun: number; maxRunsPerDay: number }) => api(`agents/${a.key}/config`, { method: "PUT", body: { enabled: a.enabled, maxToolCallsPerRun: a.maxToolCallsPerRun, maxRunsPerDay: a.maxRunsPerDay } }), onSuccess: refresh });
  if (isForbidden(cat.error)) return <><h1>Agents</h1><Forbidden what="les agents" /></>;
  const perms = me.data?.permissions ?? [];
  const canRun = perms.includes("agent.run"), canApprove = perms.includes("agent.approve"), isAdmin = perms.includes("agent.admin");
  const paramsFor = (pb: string): object => pb === "closing_check" ? (params.period ? { period: params.period } : {}) : pb === "followup" ? { olderThanDays: Number(params.days || 7) } : {};
  return (
    <>
      <h1>Agents</h1>
      {cat.data && <div className="alert a-info" role="note"><span><b>Playbooks déterministes — planificateur LLM non connecté.</b> {cat.data.llm.note} Chaque agent lit les données avec <b>vos</b> permissions, journalise ses appels d’outils, et ne peut qu’<b>exécuter des lectures</b> : toute écriture est une proposition soumise à approbation humaine.</span></div>}
      <ErrorBox error={cat.error ?? launch.error ?? config.error} prefix="Erreur" />
      <div className="grid-2" style={{ alignItems: "start" }}>
        {cat.data?.agents.map(a => (
          <section key={a.key} className="card" aria-labelledby={`a-${a.key}`}>
            <div className="card-h"><h2 id={`a-${a.key}`}>{a.name}</h2>{!a.available ? <span className="badge b-neutral">Indisponible</span> : a.config.enabled ? <span className="badge b-success">Actif</span> : <span className="badge b-danger">Coupé</span>}</div>
            <div className="card-b stack">
              <p className="muted">{a.description}</p>
              {a.unavailableReason && <div className="alert a-warning"><span>{a.unavailableReason}</span></div>}
              <div className="small muted">Outils autorisés : {a.allowedTools.length ? a.allowedTools.map(t => <span key={t} className="mono"> {t}</span>) : "aucun"}</div>
              {a.playbooks.filter(p => !p.selfService).map(p => (
                <div key={p.key} className="row" style={{ gap: 8 }}>
                  {p.key === "closing_check" && <div className="field"><label className="label small" htmlFor={`p-${a.key}`}>Période (facultatif)</label><input id={`p-${a.key}`} className="input" type="month" value={params.period ?? ""} onChange={e => setParams({ ...params, period: e.target.value })} /></div>}
                  {p.key === "followup" && <div className="field"><label className="label small" htmlFor={`d-${a.key}`}>Depuis plus de (jours)</label><input id={`d-${a.key}`} className="input" style={{ width: 90 }} type="number" min={0} max={365} value={params.days ?? "7"} onChange={e => setParams({ ...params, days: e.target.value })} /></div>}
                  <button className="btn btn-primary btn-sm" disabled={!a.available || !a.config.enabled || !canRun || !p.permissions.every(x => perms.includes(x)) || launch.isPending} title={!p.permissions.every(x => perms.includes(x)) ? "Permissions insuffisantes pour ce playbook" : p.description} onClick={() => launch.mutate({ agentKey: a.key, playbook: p.key, params: paramsFor(p.key) })}>{p.label}</button>
                </div>))}
              <div className="small muted">Aujourd’hui : {a.runsToday} exécution(s) sur {a.config.maxRunsPerDay} · max {a.config.maxToolCallsPerRun} appels d’outils par exécution</div>
            </div>
            {isAdmin && a.available && <div className="card-f"><button className="btn btn-secondary btn-sm" disabled={config.isPending} onClick={() => config.mutate({ key: a.key, ...a.config, enabled: !a.config.enabled })}>{a.config.enabled ? "Couper l’agent (coupe-circuit)" : "Réactiver l’agent"}</button></div>}
          </section>))}
      </div>
      {openRun && detail.data && <RunView run={detail.data} canApprove={!!canApprove} canCancel={!!canRun} />}
      <section className="card" aria-labelledby="h"><div className="card-h"><h2 id="h">Historique</h2></div>
        {runs.data?.length === 0 && <div className="empty"><h3>Aucune exécution</h3></div>}
        {!!runs.data?.length && <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th scope="col">Agent</th><th scope="col">Playbook</th><th scope="col">Statut</th><th scope="col" className="r">Propositions</th><th scope="col"><span style={{ position: "absolute", left: -999 }}>Ouvrir</span></th></tr></thead>
          <tbody>{runs.data.map(r => <tr key={r.id}><td>{r.agentKey}</td><td className="mono">{r.playbook}</td><td><span className={`badge ${RUN_STATUS[r.status]?.cls}`}>{RUN_STATUS[r.status]?.label}</span></td><td className="r num">{r.proposals}{r.pending ? ` (${r.pending} à approuver)` : ""}</td><td className="r"><button className="btn btn-ghost btn-sm" onClick={() => setOpenRun(r.id)}>Ouvrir</button></td></tr>)}</tbody></table></div>}
      </section>
    </>
  );
}
