"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { ErrorBox, Forbidden, isForbidden } from "@/lib/ui";

type T = { id: string; slug: string; name: string; status: string; plan: string | null; maxMembers: number | null; isPlatform: boolean; createdAt: string; suspendedReason: string | null; members: number };
type Created = { tenant: T; invitation: { link: string; emailStatus: string; note: string } };

export default function OperatorPage() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ permissions: string[] }>("me") });
  const isOp = !!me.data?.permissions.includes("platform.manage");
  const list = useQuery({ queryKey: ["operator-tenants"], queryFn: () => api<T[]>("operator/tenants"), enabled: isOp });
  const refresh = () => qc.invalidateQueries({ queryKey: ["operator-tenants"] });
  const [f, setF] = useState({ slug: "", name: "", plan: "", maxMembers: "", adminEmail: "" });
  const [link, setLink] = useState<Created["invitation"] | null>(null);
  const create = useMutation({
    mutationFn: () => api<Created>("operator/tenants", { method: "POST", body: { slug: f.slug, name: f.name, adminEmail: f.adminEmail, ...(f.plan ? { plan: f.plan } : {}), ...(f.maxMembers ? { maxMembers: Number(f.maxMembers) } : {}) } }),
    onSuccess: r => { setLink(r.invitation); setF({ slug: "", name: "", plan: "", maxMembers: "", adminEmail: "" }); refresh(); },
  });
  const [reason, setReason] = useState<Record<string, string>>({});
  const suspend = useMutation({ mutationFn: (id: string) => api(`operator/tenants/${id}/suspend`, { method: "POST", body: { reason: reason[id] ?? "" } }), onSuccess: refresh });
  const react = useMutation({ mutationFn: (id: string) => api(`operator/tenants/${id}/reactivate`, { method: "POST" }), onSuccess: refresh });
  const [q, setQ] = useState<Record<string, string>>({});
  const setQuota = useMutation({ mutationFn: (id: string) => api(`operator/tenants/${id}`, { method: "PATCH", body: { maxMembers: q[id] ? Number(q[id]) : null } }), onSuccess: refresh });
  if (me.data && !isOp) return <><h1>Console plateforme</h1><Forbidden what="la console plateforme" /></>;
  if (isForbidden(list.error)) return <><h1>Console plateforme</h1><Forbidden what="la console plateforme" /></>;
  return (
    <>
      <h1>Console plateforme</h1>
      <p className="muted">Gestion des sociétés clientes de la plateforme. Cette console ne donne accès à aucune donnée métier des sociétés : uniquement leur existence, leur offre, leur quota et leur état. Chaque action est journalisée chez la société concernée.</p>
      <div className="alert a-info" role="note"><span>Aucune facturation de l’abonnement n’est connectée : le libellé d’offre est indicatif et le quota est le seul plafond appliqué.</span></div>
      <section className="card" aria-labelledby="l"><div className="card-h"><h2 id="l">Sociétés</h2></div>
        <ErrorBox error={list.error ?? suspend.error ?? react.error ?? setQuota.error} prefix="Erreur" />
        {list.isLoading && <div className="card-b muted">Chargement…</div>}
        {!!list.data?.length && <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th scope="col">Société</th><th scope="col">Identifiant</th><th scope="col">Offre</th><th scope="col" className="r">Membres</th><th scope="col">Quota</th><th scope="col">Statut</th><th scope="col">Actions</th></tr></thead>
          <tbody>{list.data.map(t => <tr key={t.id}>
            <td><b>{t.name}</b>{t.isPlatform && <> <span className="badge b-info">Plateforme</span></>}<div className="small muted">créée le {fmtDate(t.createdAt)}</div></td>
            <td className="num">{t.slug}</td><td>{t.plan ?? "—"}</td><td className="r num">{t.members}</td>
            <td>{t.isPlatform ? "—" : <span className="row" style={{ gap: 4 }}><input aria-label={`Quota de membres de ${t.name}`} className="input" style={{ width: 80 }} inputMode="numeric" placeholder={t.maxMembers ? String(t.maxMembers) : "illimité"} value={q[t.id] ?? ""} onChange={e => setQ({ ...q, [t.id]: e.target.value })} />
              <button className="btn btn-ghost btn-sm" disabled={setQuota.isPending} onClick={() => setQuota.mutate(t.id)}>Appliquer</button></span>}</td>
            <td>{t.status === "active" ? <span className="badge b-success">Active</span> : <><span className="badge b-danger">Suspendue</span><div className="small muted">{t.suspendedReason}</div></>}</td>
            <td>{t.isPlatform ? "—" : t.status === "active"
              ? <span className="row" style={{ gap: 4 }}><input aria-label={`Motif de suspension de ${t.name}`} className="input" placeholder="Motif (5 car. min.)" value={reason[t.id] ?? ""} onChange={e => setReason({ ...reason, [t.id]: e.target.value })} /><button className="btn btn-secondary btn-sm" disabled={suspend.isPending || (reason[t.id] ?? "").trim().length < 5} onClick={() => suspend.mutate(t.id)} aria-label={`Suspendre ${t.name}`}>Suspendre</button></span>
              : <button className="btn btn-primary btn-sm" disabled={react.isPending} onClick={() => react.mutate(t.id)} aria-label={`Réactiver ${t.name}`}>Réactiver</button>}</td></tr>)}</tbody></table></div>}
      </section>
      <form className="card" onSubmit={e => { e.preventDefault(); create.mutate(); }} aria-labelledby="n">
        <div className="card-h"><h2 id="n">Nouvelle société</h2></div>
        <div className="card-b row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          {([["slug", "Identifiant de connexion", { pattern: "[a-z0-9\\-]{2,50}", title: "minuscules, chiffres, tirets" }], ["name", "Raison sociale", {}], ["plan", "Offre (libellé indicatif, facultatif)", {}], ["maxMembers", "Quota de membres (facultatif)", { inputMode: "numeric" as const }], ["adminEmail", "E-mail du premier administrateur", { type: "email" }]] as const).map(([k, l, p]) =>
            <div className="field" key={k}><label className="label" htmlFor={`o-${k}`}>{l}</label><input id={`o-${k}`} className="input" required={["slug", "name", "adminEmail"].includes(k)} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} {...p} /></div>)}
          <button className="btn btn-primary" disabled={create.isPending}>Créer la société</button>
        </div>
        <ErrorBox error={create.error} prefix="Création impossible" />
        {link && <div className="alert a-warning" role="status"><span>{link.note} <br /><code>{link.link}</code></span></div>}
      </form>
    </>
  );
}
