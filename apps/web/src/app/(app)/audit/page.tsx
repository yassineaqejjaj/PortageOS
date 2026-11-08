"use client";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";

type Ev = { id: string; at: string; action: string; entity: string; entityId: string | null; actorId: string | null };

export default function AuditPage() {
  const q = useQuery({ queryKey: ["audit"], queryFn: () => api<Ev[]>("audit") });
  const forbidden = q.error instanceof ApiError && q.error.status === 403;
  return (
    <>
      <h1>Journal d&apos;audit</h1>
      {forbidden && <p role="alert" className="card">Vous n&apos;avez pas la permission de consulter le journal.</p>}
      {q.isLoading && <p>Chargement…</p>}
      {q.data && (
        <div className="card"><table><thead><tr><th>Date</th><th>Action</th><th>Objet</th><th>Acteur</th></tr></thead>
          <tbody>{q.data.map(e => (<tr key={e.id}><td>{new Date(e.at).toLocaleString("fr-FR")}</td><td>{e.action}</td><td>{e.entity}</td><td className="muted">{e.actorId?.slice(0, 8) ?? "—"}</td></tr>))}</tbody></table></div>
      )}
    </>
  );
}
