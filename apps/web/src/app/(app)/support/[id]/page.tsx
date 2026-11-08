"use client";
import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorBox } from "@/lib/ui";

type Ticket = { id: string; subject: string; category: string; priority: string; status: string; requester: string; assigneeUserId?: string | null; messages: { id: string; author: string; mine: boolean; body: string; internal: boolean; createdAt: string }[] };
const ST: Record<string, { label: string; cls: string }> = { open: { label: "Ouverte", cls: "b-info" }, pending_requester: { label: "En attente du demandeur", cls: "b-warning" }, resolved: { label: "Résolue", cls: "b-success" }, closed: { label: "Close", cls: "b-neutral" } };

export default function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [body, setBody] = useState(""); const [internal, setInternal] = useState(false);
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ permissions: string[] }>("me") });
  const staff = !!me.data?.permissions.includes("support.manage");
  const q = useQuery({ queryKey: ["ticket", id], queryFn: () => api<Ticket>(`support/tickets/${id}`) });
  const staffList = useQuery({ queryKey: ["support-staff"], queryFn: () => api<{ id: string; email: string }[]>("support/staff"), enabled: staff });
  const tpls = useQuery({ queryKey: ["support-tpls"], queryFn: () => api<{ id: string; name: string; body: string }[]>("support/templates"), enabled: staff });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["ticket", id] }); qc.invalidateQueries({ queryKey: ["tickets"] }); };
  const send = useMutation({ mutationFn: () => api(`support/tickets/${id}/messages`, { method: "POST", body: { body, internal } }), onSuccess: () => { setBody(""); setInternal(false); refresh(); } });
  const move = useMutation({ mutationFn: (event: string) => api(`support/tickets/${id}/transition`, { method: "POST", body: { event } }), onSuccess: refresh });
  const assign = useMutation({ mutationFn: (userId: string | null) => api(`support/tickets/${id}/assign`, { method: "POST", body: { userId } }), onSuccess: refresh });
  const t = q.data;
  return (
    <>
      <p><Link href="/support">← Support</Link></p>
      <ErrorBox error={q.error ?? send.error ?? move.error ?? assign.error} prefix="Erreur" />
      {t && (
        <section className="card" aria-labelledby="t">
          <div className="card-h"><div><h1 id="t" style={{ fontSize: 22 }}>{t.subject}</h1><div className="small muted">Demandeur : {t.requester}</div></div><span className={`badge ${ST[t.status]?.cls}`}>{ST[t.status]?.label}</span></div>
          <div className="card-b stack" aria-live="polite">
            {t.messages.map(m => (
              <div key={m.id} className="card" style={{ boxShadow: "none", background: m.internal ? "var(--color-status-warning-bg)" : m.mine ? "var(--color-action-primary-soft)" : undefined }}>
                <div className="card-b stack" style={{ gap: 4 }}>
                  <div className="small muted">{m.mine ? "Vous" : m.author} · {new Date(m.createdAt).toLocaleString("fr-FR")}{m.internal && <b> · Note interne (invisible du demandeur)</b>}</div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
                </div></div>))}
          </div>
          {t.status !== "closed" && (
            <form className="card-b stack" onSubmit={e => { e.preventDefault(); send.mutate(); }}>
              {staff && !!tpls.data?.length && <div className="field"><label className="label" htmlFor="tp">Modèle de réponse</label><select id="tp" className="input" defaultValue="" onChange={e => { const x = tpls.data?.find(v => v.id === e.target.value); if (x) setBody(x.body); }}><option value="">Insérer un modèle…</option>{tpls.data.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>}
              <div className="field"><label className="label" htmlFor="rb">Votre réponse</label><textarea id="rb" className="input" style={{ height: 100, padding: 8 }} value={body} onChange={e => setBody(e.target.value)} required /></div>
              {staff && <label className="check"><input type="checkbox" checked={internal} onChange={e => setInternal(e.target.checked)} /> Note interne (non visible du demandeur)</label>}
              <div className="row"><button className="btn btn-primary" disabled={send.isPending || !body.trim()}>{internal ? "Ajouter la note" : "Envoyer"}</button></div>
            </form>)}
          <div className="card-f">
            {staff && <><label className="label" htmlFor="as" style={{ position: "absolute", left: -999 }}>Assigner à</label>
              <select id="as" className="input" style={{ width: 220 }} value={t.assigneeUserId ?? ""} onChange={e => assign.mutate(e.target.value || null)}><option value="">Non assignée</option>{staffList.data?.map(u => <option key={u.id} value={u.id}>{u.email}</option>)}</select>
              {["open", "pending_requester"].includes(t.status) && <button className="btn btn-secondary" disabled={move.isPending} onClick={() => move.mutate("resolve")}>Marquer comme résolue</button>}</>}
            {t.status !== "closed" && <button className="btn btn-ghost" disabled={move.isPending} onClick={() => move.mutate("close")}>Clore la demande</button>}
          </div>
        </section>)}
    </>
  );
}
