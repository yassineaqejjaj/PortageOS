"use client";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";

type Ev = { id: string; at: string; action: string; entity: string; entityId: string | null; actorId: string | null };

export default function AuditPage() {
  const q = useQuery({ queryKey: ["audit"], queryFn: () => api<Ev[]>("audit") });
  const forbidden = q.error instanceof ApiError && q.error.status === 403;
  return (
    <>
      <h1>Journal d’audit</h1>
      {forbidden && <div className="alert a-warning" role="alert"><span>Accès refusé : la consultation du journal d’audit n’est pas autorisée pour votre rôle.</span></div>}
      {q.isLoading && <p className="muted" aria-live="polite">Chargement du journal…</p>}
      {q.error && !forbidden && <div className="alert a-danger" role="alert"><span>Impossible de charger le journal : {(q.error as Error).message}</span></div>}
      {q.data && (
        <section className="card" aria-label="Événements d’audit">
          {q.data.length === 0 ? <div className="empty"><h3>Aucun événement</h3></div> : (
            <div className="tbl-wrap"><table className="tbl compact">
              <thead><tr><th scope="col">Date</th><th scope="col">Action</th><th scope="col">Objet</th><th scope="col">Acteur</th></tr></thead>
              <tbody>{q.data.map(e => (<tr key={e.id}><td className="num">{fmtDateTime(e.at)}</td><td className="mono">{e.action}</td><td>{e.entity}</td><td className="mono muted">{e.actorId?.slice(0, 8) ?? "—"}</td></tr>))}</tbody>
            </table></div>
          )}
        </section>
      )}
    </>
  );
}
