"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { ErrorBox, Forbidden, isForbidden } from "@/lib/ui";

type Task = { id: string; title: string; dueDate: string; status: string; overdue: boolean; assigneeUserId: string | null; prospect: { id: string; name: string } | null };
export default function CrmTasksPage() {
  const qc = useQueryClient(); const [mine, setMine] = useState(true);
  const list = useQuery({ queryKey: ["crm-tasks", mine], queryFn: () => api<Task[]>(`crm/tasks${mine ? "?mine=1" : ""}`) });
  const act = useMutation({ mutationFn: (a: { id: string; ev: "done" | "cancel" }) => api(`crm/tasks/${a.id}/${a.ev}`, { method: "POST", body: {} }), onSuccess: () => qc.invalidateQueries({ queryKey: ["crm-tasks"] }) });
  const [title, setTitle] = useState(""); const [due, setDue] = useState("");
  const create = useMutation({ mutationFn: () => api("crm/tasks", { method: "POST", body: { title, dueDate: due } }), onSuccess: () => { setTitle(""); setDue(""); qc.invalidateQueries({ queryKey: ["crm-tasks"] }); } });
  if (isForbidden(list.error)) return <><h1>Tâches commerciales</h1><Forbidden what="les tâches commerciales" /></>;
  return (
    <>
      <h1>Tâches commerciales</h1>
      <div className="split">
        <section className="card main" aria-labelledby="t-liste">
          <div className="card-h"><h2 id="t-liste">Tâches ouvertes</h2>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} /> Seulement les miennes</label></div>
          <ErrorBox error={list.error ?? act.error} prefix="Opération impossible" />
          {list.isLoading && <div className="card-b">Chargement…</div>}
          {list.data?.length === 0 && <div className="card-b muted">Aucune tâche ouverte.</div>}
          {list.data && list.data.length > 0 && <div className="tbl-wrap"><table className="tbl compact">
            <thead><tr><th scope="col">Tâche</th><th scope="col">Prospect</th><th scope="col">Échéance</th><th scope="col">Actions</th></tr></thead>
            <tbody>{list.data.map(t => <tr key={t.id}>
              <td><b>{t.title}</b></td>
              <td>{t.prospect ? <Link href={`/crm/prospects/${t.prospect.id}`}>{t.prospect.name}</Link> : <span className="muted">—</span>}</td>
              <td className="num">{fmtDate(t.dueDate)} {t.overdue && <span className="badge b-danger">En retard</span>}</td>
              <td><div className="row" style={{ gap: 6 }}>
                <button className="btn btn-secondary btn-sm" disabled={act.isPending} onClick={() => act.mutate({ id: t.id, ev: "done" })}>Terminer</button>
                <button className="btn btn-ghost btn-sm" disabled={act.isPending} onClick={() => act.mutate({ id: t.id, ev: "cancel" })}>Annuler</button></div></td></tr>)}</tbody></table></div>}
        </section>
        <form className="card side" aria-labelledby="t-new" onSubmit={e => { e.preventDefault(); create.mutate(); }}>
          <div className="card-h"><h2 id="t-new">Nouvelle tâche</h2></div>
          <div className="card-b stack" style={{ gap: 16 }}>
            <div className="field"><label className="label" htmlFor="tt">Intitulé</label><input id="tt" className="input" value={title} onChange={e => setTitle(e.target.value)} minLength={3} required /></div>
            <div className="field"><label className="label" htmlFor="td">Échéance</label><input id="td" type="date" className="input" value={due} onChange={e => setDue(e.target.value)} required /></div>
            <ErrorBox error={create.error} prefix="Création impossible" />
          </div>
          <div className="card-f"><button type="submit" className="btn btn-primary" disabled={create.isPending}>Ajouter la tâche</button></div>
        </form>
      </div>
    </>
  );
}
