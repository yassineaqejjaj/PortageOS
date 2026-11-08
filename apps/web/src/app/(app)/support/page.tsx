"use client";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { ErrorBox } from "@/lib/ui";

type T = { id: string; subject: string; category: string; priority: string; status: string; updatedAt: string };
const T_STATUS: Record<string, { label: string; cls: string }> = { open: { label: "Ouverte", cls: "b-info" }, pending_requester: { label: "En attente de votre réponse", cls: "b-warning" }, resolved: { label: "Résolue", cls: "b-success" }, closed: { label: "Close", cls: "b-neutral" } };
const CAT: Record<string, string> = { question: "Question", incident: "Incident", request: "Demande", other: "Autre" };

export default function SupportPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState(""); const [q, setQ] = useState("");
  const [f, setF] = useState({ subject: "", category: "question", priority: "normal", body: "" });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ permissions: string[] }>("me") });
  const staff = !!me.data?.permissions.includes("support.manage");
  const list = useQuery({ queryKey: ["tickets", status, q], queryFn: () => api<T[]>(`support/tickets?${new URLSearchParams({ ...(status ? { status } : {}), ...(q ? { q } : {}) })}`) });
  const create = useMutation({ mutationFn: () => api("support/tickets", { method: "POST", body: f }), onSuccess: () => { setF({ subject: "", category: "question", priority: "normal", body: "" }); qc.invalidateQueries({ queryKey: ["tickets"] }); } });
  return (
    <>
      <h1>Support</h1>
      <ErrorBox error={list.error ?? create.error} prefix="Erreur" />
      <div className="split">
        <section className="card main" aria-labelledby="l"><div className="card-h"><h2 id="l">{staff ? "Toutes les demandes" : "Mes demandes"}</h2>
          <div className="row" style={{ gap: 8 }}>
            <label className="label" htmlFor="q" style={{ position: "absolute", left: -999 }}>Rechercher</label><input id="q" className="input" style={{ width: 180 }} placeholder="Rechercher un sujet" value={q} onChange={e => setQ(e.target.value)} />
            <label className="label" htmlFor="s" style={{ position: "absolute", left: -999 }}>Statut</label><select id="s" className="input" style={{ width: 170 }} value={status} onChange={e => setStatus(e.target.value)}><option value="">Tous les statuts</option>{Object.entries(T_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div></div>
          {list.isLoading && <div className="card-b muted">Chargement…</div>}
          {list.data?.length === 0 && <div className="empty"><h3>Aucune demande</h3><p className="muted">Utilisez le formulaire pour contacter le support.</p></div>}
          {!!list.data?.length && <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th scope="col">Sujet</th><th scope="col">Type</th><th scope="col">Statut</th><th scope="col">Mise à jour</th></tr></thead>
            <tbody>{list.data.map(t => <tr key={t.id}><td><Link href={`/support/${t.id}`}><b>{t.subject}</b></Link>{t.priority === "high" && <span className="badge b-danger" style={{ marginLeft: 8 }}>Prioritaire</span>}</td><td>{CAT[t.category]}</td><td><span className={`badge ${T_STATUS[t.status]?.cls}`}>{T_STATUS[t.status]?.label}</span></td><td className="num">{fmtDate(t.updatedAt)}</td></tr>)}</tbody></table></div>}
        </section>
        <form className="card side" onSubmit={e => { e.preventDefault(); create.mutate(); }} aria-labelledby="n"><div className="card-h"><h2 id="n">Nouvelle demande</h2></div>
          <div className="card-b stack" style={{ gap: 16 }}>
            <div className="field"><label className="label" htmlFor="sj">Sujet</label><input id="sj" className="input" value={f.subject} onChange={e => setF({ ...f, subject: e.target.value })} required minLength={3} /></div>
            <div className="field"><label className="label" htmlFor="ct">Type</label><select id="ct" className="input" value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>{Object.entries(CAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div className="field"><label className="label" htmlFor="pr">Priorité</label><select id="pr" className="input" value={f.priority} onChange={e => setF({ ...f, priority: e.target.value })}><option value="low">Basse</option><option value="normal">Normale</option><option value="high">Haute</option></select></div>
            <div className="field"><label className="label" htmlFor="bd">Message</label><textarea id="bd" className="input" style={{ height: 120, padding: 8 }} value={f.body} onChange={e => setF({ ...f, body: e.target.value })} required /><span className="hint">Ne saisissez ni mot de passe ni donnée de santé. Les pièces jointes ne sont pas encore disponibles.</span></div>
          </div><div className="card-f"><button className="btn btn-primary" disabled={create.isPending}>Envoyer la demande</button></div></form>
      </div>
    </>
  );
}
