"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { ErrorBox, Forbidden, isForbidden } from "@/lib/ui";

type Tpl = { key: string; label: string; params: string[]; preview: string; suggestedName: string; metaName: string | null; language: string; enabled: boolean };
type View = { provider: string; simulated: boolean; webhookConfigured: boolean; channel: { phoneNumberId: string; wabaId: string | null; displayPhone: string | null; status: string; hasToken: boolean; lastCheckedAt: string | null; lastError: string | null } | null; templates: Tpl[] };
const ST: Record<string, { label: string; cls: string }> = { configured: { label: "Enregistré, non vérifié", cls: "b-warning" }, verified: { label: "Vérifié auprès de Meta", cls: "b-success" }, error: { label: "Erreur de vérification", cls: "b-danger" }, disabled: { label: "Désactivé", cls: "b-neutral" } };

export default function WhatsappSettings() {
  const qc = useQueryClient();
  const v = useQuery({ queryKey: ["wa-channel-admin"], queryFn: () => api<View>("whatsapp/channel") });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["wa-channel-admin"] }); qc.invalidateQueries({ queryKey: ["wa-channel"] }); };
  const [f, setF] = useState({ phoneNumberId: "", wabaId: "", accessToken: "" });
  const save = useMutation({ mutationFn: () => api("whatsapp/channel", { method: "PUT", body: { phoneNumberId: f.phoneNumberId || v.data?.channel?.phoneNumberId, ...(f.wabaId ? { wabaId: f.wabaId } : {}), ...(f.accessToken ? { accessToken: f.accessToken } : {}) } }), onSuccess: () => { setF({ phoneNumberId: "", wabaId: "", accessToken: "" }); refresh(); } });
  const verify = useMutation({ mutationFn: () => api<{ status: string; error?: string }>("whatsapp/channel/verify", { method: "POST" }), onSuccess: refresh });
  const disable = useMutation({ mutationFn: () => api("whatsapp/channel", { method: "DELETE" }), onSuccess: refresh });
  const [t, setT] = useState<Record<string, { metaName: string; enabled: boolean }>>({});
  const saveT = useMutation({ mutationFn: () => api("whatsapp/templates", { method: "PUT", body: { templates: v.data!.templates.map(x => ({ key: x.key, language: x.language, metaName: t[x.key]?.metaName ?? x.metaName ?? "", enabled: t[x.key]?.enabled ?? x.enabled })).filter(x => x.metaName) } }), onSuccess: () => { setT({}); refresh(); } });
  if (isForbidden(v.error)) return <><h1>Canal WhatsApp</h1><Forbidden what="la configuration WhatsApp" /></>;
  const ch = v.data?.channel;
  return (
    <>
      <h1>Canal WhatsApp</h1>
      <p className="muted">Connexion à l’API officielle WhatsApp Business (Meta Cloud API). Rien n’est considéré comme connecté tant qu’un appel réel à Meta n’a pas réussi.</p>
      {v.data?.simulated && <div className="alert a-warning" role="status"><span>Mode simulé (environnement local) : aucun appel n’est fait à Meta.</span></div>}
      {v.data && !v.data.webhookConfigured && <div className="alert a-warning" role="status"><span>Réception désactivée : le serveur n’a pas de secret d’application ni de jeton de vérification Meta (variables <code>WHATSAPP_APP_SECRET</code> et <code>WHATSAPP_VERIFY_TOKEN</code>). Les envois restent possibles, pas les réponses ni les accusés de réception.</span></div>}
      <section className="card" aria-labelledby="ch"><div className="card-h"><h2 id="ch">Numéro</h2>{ch && <span className={`badge ${ST[ch.status]?.cls}`}>{ST[ch.status]?.label}</span>}</div>
        <ErrorBox error={v.error ?? verify.error ?? disable.error} prefix="Erreur" />
        {ch && <div className="card-b small">Identifiant du numéro : <span className="num">{ch.phoneNumberId}</span>{ch.displayPhone && <> · {ch.displayPhone}</>} · jeton {ch.hasToken ? "enregistré (chiffré, jamais affiché)" : "absent"}{ch.lastCheckedAt && <> · vérifié le {fmtDateTime(ch.lastCheckedAt)}</>}{ch.lastError && <div className="alert a-danger" role="alert"><span>{ch.lastError}</span></div>}
          {verify.data?.status === "error" && <div className="alert a-danger" role="alert"><span>{verify.data.error}</span></div>}
          <div className="row" style={{ gap: 8, marginTop: 8 }}><button className="btn btn-secondary" disabled={verify.isPending} onClick={() => verify.mutate()}>Vérifier la connexion</button><button className="btn btn-ghost" disabled={disable.isPending} onClick={() => { if (confirm("Désactiver le canal ? Le jeton sera supprimé.")) disable.mutate(); }}>Désactiver</button></div></div>}
        <form className="card-b row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }} onSubmit={e => { e.preventDefault(); save.mutate(); }}>
          <div className="field"><label className="label" htmlFor="w-id">Identifiant du numéro (Meta)</label><input id="w-id" className="input" inputMode="numeric" required={!ch} placeholder={ch?.phoneNumberId} value={f.phoneNumberId} onChange={e => setF({ ...f, phoneNumberId: e.target.value })} /></div>
          <div className="field"><label className="label" htmlFor="w-wa">Identifiant du compte WhatsApp Business</label><input id="w-wa" className="input" inputMode="numeric" value={f.wabaId} onChange={e => setF({ ...f, wabaId: e.target.value })} /></div>
          <div className="field"><label className="label" htmlFor="w-tk">Jeton d’accès (système)</label><input id="w-tk" className="input" type="password" autoComplete="off" required={!ch?.hasToken && !v.data?.simulated} placeholder={ch?.hasToken ? "inchangé" : ""} value={f.accessToken} onChange={e => setF({ ...f, accessToken: e.target.value })} /></div>
          <button className="btn btn-primary" disabled={save.isPending}>{ch ? "Mettre à jour" : "Enregistrer"}</button>
        </form>
        <ErrorBox error={save.error} prefix="Enregistrement impossible" />
      </section>
      <section className="card" aria-labelledby="tp"><div className="card-h"><h2 id="tp">Modèles de messages</h2></div>
        <p className="card-b muted">Hors fenêtre de 24 h, WhatsApp n’accepte que des modèles approuvés par Meta. Créez-les dans votre gestionnaire Meta avec le texte ci-dessous, puis saisissez ici leur nom exact : le produit ne peut pas vérifier l’approbation. « Envoi automatique » autorise l’envoi sans action humaine, uniquement aux personnes ayant consenti.</p>
        <div className="card-b">{v.data?.templates.map(x => { const cur = t[x.key] ?? { metaName: x.metaName ?? "", enabled: x.enabled }; return <div key={x.key} className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
          <div style={{ flex: "1 1 280px" }}><b>{x.label}</b><div className="small muted">{x.preview}<br />Variables : {x.params.map((p, i) => `{{${i + 1}}} = ${p}`).join(", ")}</div></div>
          <div className="field"><label className="label" htmlFor={`t-${x.key}`}>Nom du modèle chez Meta</label><input id={`t-${x.key}`} className="input" placeholder={x.suggestedName} pattern="[a-z0-9_]+" value={cur.metaName} onChange={e => setT({ ...t, [x.key]: { ...cur, metaName: e.target.value } })} /></div>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={cur.enabled} onChange={e => setT({ ...t, [x.key]: { ...cur, enabled: e.target.checked } })} /> Envoi automatique</label></div>; })}
          <button className="btn btn-primary" disabled={saveT.isPending || !Object.keys(t).length} onClick={() => saveT.mutate()}>Enregistrer les modèles</button>
          <ErrorBox error={saveT.error} prefix="Enregistrement impossible" /></div>
      </section>
    </>
  );
}
