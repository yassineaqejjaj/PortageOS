"use client";
import { use } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorBox } from "@/lib/ui";
import { DocumentsPanel } from "@/lib/documents";

type Task = { id: string; key: string; label: string; required: boolean; doneAt: string | null };
type C = { id: string; firstName: string; lastName: string; email: string | null; status: string; tasks: Task[] };

export default function ConsultantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["consultant", id], queryFn: () => api<C>(`consultants/${id}`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["consultant", id] }); qc.invalidateQueries({ queryKey: ["consultants"] }); };
  const toggle = useMutation({ mutationFn: (a: { key: string; done: boolean }) => api(`consultants/${id}/tasks/${a.key}`, { method: "POST", body: { done: a.done } }), onSuccess: refresh });
  const activate = useMutation({ mutationFn: () => api(`consultants/${id}/activate`, { method: "POST" }), onSuccess: refresh });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ permissions: string[] }>("me") });
  const perms = me.data?.permissions ?? [];
  const c = q.data;
  return (
    <>
      <p><Link href="/consultants">← Consultants</Link></p>
      {q.isLoading && <p className="muted">Chargement…</p>}
      <ErrorBox error={q.error} prefix="Dossier introuvable" />
      {c && (
        <section className="card" aria-labelledby="t">
          <div className="card-h"><h1 id="t" style={{ fontSize: 22 }}>{c.firstName} {c.lastName}</h1><span className={`badge ${c.status === "active" ? "b-success" : "b-warning"}`}>{c.status === "active" ? "Actif" : "Onboarding"}</span></div>
          <div className="card-b stack">
            <p className="muted small">Les cases sont cochées par un humain : aucune vérification externe n’est effectuée (DPAE, signature électronique et pièces ne sont pas connectées).</p>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {c.tasks.map(t => (
                <li key={t.id}><label className="check"><input type="checkbox" checked={!!t.doneAt} disabled={c.status !== "onboarding" || toggle.isPending} onChange={e => toggle.mutate({ key: t.key, done: e.target.checked })} /> {t.label}</label></li>
              ))}
            </ul>
            <ErrorBox error={toggle.error ?? activate.error} prefix="Action impossible" />
          </div>
          {c.status === "onboarding" && <div className="card-f"><button className="btn btn-primary" onClick={() => activate.mutate()} disabled={activate.isPending}>Activer le consultant</button></div>}
        </section>
      )}
      {c && perms.includes("document.read") && <DocumentsPanel ownerType="consultant" ownerId={c.id} categories={["identity_document", "bank_details", "rc_pro", "contract_copy", "other"]} canUpload={perms.includes("document.write")} canDelete={perms.includes("document.delete")} canShare={perms.includes("document.share")} title="Documents du dossier" />}
    </>
  );
}
