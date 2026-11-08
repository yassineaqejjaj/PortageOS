"use client";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorBox } from "@/lib/ui";

type N = { id: string; type: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string };
type Prefs = { email: { status: string; note: string }; types: { type: string; label: string; enabled: boolean }[] };

export default function NotificationsPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["notifications"], queryFn: () => api<N[]>("notifications") });
  const prefs = useQuery({ queryKey: ["notif-prefs"], queryFn: () => api<Prefs>("notification-preferences") });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["notifications"] }); qc.invalidateQueries({ queryKey: ["unread"] }); };
  const read = useMutation({ mutationFn: (id: string) => api(`notifications/${id}/read`, { method: "POST" }), onSuccess: refresh });
  const readAll = useMutation({ mutationFn: () => api("notifications/read-all", { method: "POST" }), onSuccess: refresh });
  const pref = useMutation({ mutationFn: (a: { type: string; enabled: boolean }) => api("notification-preferences", { method: "PUT", body: a }), onSuccess: () => qc.invalidateQueries({ queryKey: ["notif-prefs"] }) });
  const unread = list.data?.filter(n => !n.readAt).length ?? 0;
  return (
    <>
      <div className="row between"><h1>Notifications</h1><button className="btn btn-secondary" disabled={!unread || readAll.isPending} onClick={() => readAll.mutate()}>Tout marquer comme lu</button></div>
      <ErrorBox error={list.error ?? read.error ?? pref.error} prefix="Erreur" />
      <div className="split">
        <section className="card main" aria-labelledby="l" aria-live="polite"><div className="card-h"><h2 id="l">Boîte de réception</h2>{unread > 0 && <span className="count">{unread} non lue(s)</span>}</div>
          {list.isLoading && <div className="card-b muted">Chargement…</div>}
          {list.data?.length === 0 && <div className="empty"><h3>Aucune notification</h3></div>}
          <div className="list">{list.data?.map(n => (
            <div key={n.id} className="row between" style={{ background: n.readAt ? undefined : "var(--color-action-primary-soft)" }}>
              <div><div>{n.link ? <Link href={n.link} onClick={() => !n.readAt && read.mutate(n.id)}><b>{n.title}</b></Link> : <b>{n.title}</b>}{!n.readAt && <span className="badge b-info" style={{ marginLeft: 8 }}>Nouvelle</span>}</div>
                {n.body && <div className="small muted">{n.body}</div>}<div className="small muted">{new Date(n.createdAt).toLocaleString("fr-FR")}</div></div>
              {!n.readAt && <button className="btn btn-ghost btn-sm" onClick={() => read.mutate(n.id)}>Marquer comme lue</button>}
            </div>))}</div>
        </section>
        <section className="card side" aria-labelledby="p"><div className="card-h"><h2 id="p">Préférences</h2></div>
          <div className="card-b stack">
            {prefs.data && <div className="alert a-info" role="note"><span>{prefs.data.email.note}</span></div>}
            {prefs.data?.types.map(t => <label key={t.type} className="check"><input type="checkbox" checked={t.enabled} disabled={pref.isPending} onChange={e => pref.mutate({ type: t.type, enabled: e.target.checked })} /> {t.label}</label>)}
          </div></section>
      </div>
    </>
  );
}
