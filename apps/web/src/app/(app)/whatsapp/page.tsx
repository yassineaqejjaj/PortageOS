"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { ErrorBox, Forbidden, isForbidden } from "@/lib/ui";

type Conv = { id: string; phone: string; displayName: string | null; subjectType: string | null; lastInboundAt: string | null; lastMessageAt: string; unreadCount: number };
type Msg = { id: string; direction: "in" | "out"; kind: string; body: string; status: string; error: string | null; createdAt: string };
type Thread = { conversation: Conv; consent: { status: string; source: string } | null; windowOpen: boolean; messages: Msg[] };
type Consent = { id: string; subjectType: string; subjectId: string; phone: string; status: string; source: string; updatedAt: string };
type Consultant = { id: string; firstName: string; lastName: string };

const STATUS: Record<string, { label: string; cls: string }> = {
  queued: { label: "En file", cls: "b-neutral" }, sending: { label: "Envoi…", cls: "b-neutral" }, sent: { label: "Envoyé", cls: "b-info" }, delivered: { label: "Remis", cls: "b-success" }, read: { label: "Lu", cls: "b-success" },
  failed: { label: "Échec", cls: "b-danger" }, received: { label: "Reçu", cls: "b-neutral" }, not_connected: { label: "Non connecté — non envoyé", cls: "b-warning" }, simulated: { label: "Simulé (rien n’est parti)", cls: "b-warning" },
};
const SOURCES: Record<string, string> = { written_form: "Formulaire écrit", in_app: "Accord saisi dans l’application", inbound_message: "Message entrant de la personne", other: "Autre (preuve à préciser)" };

export default function WhatsappPage() {
  const qc = useQueryClient();
  const [sel, setSel] = useState<string | null>(null);
  const [text, setText] = useState("");
  const channel = useQuery({ queryKey: ["wa-channel"], queryFn: () => api<{ simulated: boolean; channel: { status: string } | null }>("whatsapp/channel") });
  const convs = useQuery({ queryKey: ["wa-convs"], queryFn: () => api<Conv[]>("whatsapp/conversations"), refetchInterval: 20000 });
  const thread = useQuery({ queryKey: ["wa-thread", sel], enabled: !!sel, queryFn: () => api<Thread>(`whatsapp/conversations/${sel}/messages`), refetchInterval: 15000 });
  const consents = useQuery({ queryKey: ["wa-consents"], queryFn: () => api<Consent[]>("whatsapp/consents") });
  const consultants = useQuery({ queryKey: ["consultants"], queryFn: () => api<Consultant[]>("consultants") });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["wa-convs"] }); qc.invalidateQueries({ queryKey: ["wa-thread"] }); qc.invalidateQueries({ queryKey: ["wa-consents"] }); };
  const reply = useMutation({ mutationFn: () => api(`whatsapp/conversations/${sel}/messages`, { method: "POST", body: { text } }), onSuccess: () => { setText(""); refresh(); } });
  const flush = useMutation({ mutationFn: () => api("whatsapp/flush", { method: "POST" }), onSuccess: refresh });
  const [c, setC] = useState({ consultantId: "", phone: "", source: "written_form", evidence: "" });
  const grant = useMutation({
    mutationFn: (status: "opted_in" | "opted_out") => api("whatsapp/consents", { method: "POST", body: { subjectType: "consultant", subjectId: c.consultantId, phone: c.phone, status, source: status === "opted_out" ? "in_app" : c.source, ...(c.evidence ? { evidence: c.evidence } : {}) } }),
    onSuccess: () => { setC({ consultantId: "", phone: "", source: "written_form", evidence: "" }); refresh(); },
  });
  if (isForbidden(channel.error)) return <><h1>WhatsApp</h1><Forbidden what="WhatsApp" /></>;
  const cs = channel.data?.channel;
  const nameOf = (id: string) => { const k = consultants.data?.find(x => x.id === id); return k ? `${k.firstName} ${k.lastName}` : "Consultant"; };
  return (
    <>
      <h1>WhatsApp</h1>
      {channel.data && !cs && <div className="alert a-warning" role="status"><span>Canal non configuré : aucun message ne part ni n’arrive. Un administrateur doit renseigner les identifiants Meta dans « Canal WhatsApp ».</span></div>}
      {channel.data?.simulated && <div className="alert a-warning" role="status"><span>Mode simulé (environnement local) : les messages ne sont pas envoyés à WhatsApp.</span></div>}
      {cs && !channel.data?.simulated && cs.status !== "verified" && <div className="alert a-warning" role="status"><span>Canal enregistré mais non vérifié ({cs.status === "error" ? "dernière vérification en échec" : "vérification à lancer"}) : les envois peuvent échouer.</span></div>}
      <div className="row" style={{ gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <section className="card" style={{ flex: "1 1 280px", maxWidth: 360 }} aria-labelledby="cv">
          <div className="card-h"><h2 id="cv">Conversations</h2><button className="btn btn-ghost btn-sm" onClick={() => flush.mutate()} disabled={flush.isPending} title="Relancer l’envoi des messages restés en file">Relancer la file</button></div>
          <ErrorBox error={convs.error ?? flush.error} prefix="Erreur" />
          {convs.data && !convs.data.length && <div className="card-b muted">Aucune conversation. Enregistrez d’abord le consentement d’une personne, ou attendez un message entrant.</div>}
          <ul className="list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {convs.data?.map(v => <li key={v.id}><button className={`btn btn-ghost ${sel === v.id ? "active" : ""}`} style={{ width: "100%", justifyContent: "space-between", textAlign: "left" }} aria-current={sel === v.id} onClick={() => setSel(v.id)}>
              <span><b>{v.displayName ?? v.phone}</b><span className="small muted" style={{ display: "block" }}>{v.phone} · {fmtDateTime(v.lastMessageAt)}</span></span>
              {v.unreadCount > 0 && <span className="badge b-info" aria-label={`${v.unreadCount} non lu(s)`}>{v.unreadCount}</span>}</button></li>)}
          </ul>
        </section>
        <section className="card" style={{ flex: "2 1 380px" }} aria-labelledby="th">
          <div className="card-h"><h2 id="th">{thread.data ? (thread.data.conversation.displayName ?? thread.data.conversation.phone) : "Fil de discussion"}</h2></div>
          {!sel && <div className="card-b muted">Sélectionnez une conversation.</div>}
          <ErrorBox error={thread.error} prefix="Erreur" />
          {thread.data && <>
            <div className="card-b">
              {thread.data.consent?.status === "opted_out" && <div className="alert a-danger" role="alert"><span>Cette personne a retiré son consentement : aucun message ne peut lui être envoyé.</span></div>}
              {!thread.data.consent && <div className="alert a-warning" role="note"><span>Aucun consentement enregistré pour ce numéro.</span></div>}
              {!thread.data.windowOpen && thread.data.consent?.status !== "opted_out" && <div className="alert a-info" role="note"><span>Fenêtre de 24 h fermée : seul un message modèle approuvé peut être envoyé (relance de CRA depuis Activité / CRA). Le texte libre redevient possible après sa prochaine réponse.</span></div>}
              <ol aria-label="Messages" style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {thread.data.messages.map(m => <li key={m.id} style={{ alignSelf: m.direction === "out" ? "flex-end" : "flex-start", maxWidth: "80%" }}>
                  <div className={m.direction === "out" ? "alert a-info" : "alert a-neutral"}><span>{m.body}</span></div>
                  <div className="small muted" style={{ textAlign: m.direction === "out" ? "right" : "left" }}>{fmtDateTime(m.createdAt)}{m.kind === "template" && " · modèle"}{m.direction === "out" && <> · <span className={`badge ${STATUS[m.status]?.cls ?? "b-neutral"}`}>{STATUS[m.status]?.label ?? m.status}</span></>}{m.error && <> — {m.error}</>}</div>
                </li>)}
              </ol>
            </div>
            <form className="card-b row" style={{ gap: 8 }} onSubmit={e => { e.preventDefault(); if (text.trim()) reply.mutate(); }}>
              <label className="sr-only" htmlFor="wa-text">Votre réponse</label>
              <input id="wa-text" className="input" style={{ flex: 1 }} maxLength={1000} value={text} onChange={e => setText(e.target.value)} placeholder={thread.data.windowOpen && thread.data.consent?.status !== "opted_out" ? "Votre réponse…" : "Texte libre indisponible"} disabled={!thread.data.windowOpen || thread.data.consent?.status === "opted_out"} />
              <button className="btn btn-primary" disabled={reply.isPending || !text.trim() || !thread.data.windowOpen || thread.data.consent?.status === "opted_out"}>Envoyer</button>
            </form>
            <ErrorBox error={reply.error} prefix="Envoi impossible" />
          </>}
        </section>
      </div>
      <section className="card" aria-labelledby="cs">
        <div className="card-h"><h2 id="cs">Consentements</h2></div>
        <p className="card-b muted">Un consultant ne reçoit de message WhatsApp que s’il a donné son accord (preuve conservée) ; il peut le retirer à tout moment, y compris en répondant STOP.</p>
        <form className="card-b row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }} onSubmit={e => { e.preventDefault(); grant.mutate("opted_in"); }}>
          <div className="field"><label className="label" htmlFor="wc-c">Consultant</label><select id="wc-c" className="input" required value={c.consultantId} onChange={e => setC({ ...c, consultantId: e.target.value })}><option value="">—</option>{consultants.data?.map(k => <option key={k.id} value={k.id}>{k.firstName} {k.lastName}</option>)}</select></div>
          <div className="field"><label className="label" htmlFor="wc-p">Numéro WhatsApp</label><input id="wc-p" className="input" required inputMode="tel" placeholder="+33 6 12 34 56 78" value={c.phone} onChange={e => setC({ ...c, phone: e.target.value })} /></div>
          <div className="field"><label className="label" htmlFor="wc-s">Origine du consentement</label><select id="wc-s" className="input" value={c.source} onChange={e => setC({ ...c, source: e.target.value })}>{Object.entries(SOURCES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="field"><label className="label" htmlFor="wc-e">Preuve / précision</label><input id="wc-e" className="input" maxLength={300} value={c.evidence} onChange={e => setC({ ...c, evidence: e.target.value })} /></div>
          <button className="btn btn-primary" disabled={grant.isPending}>Enregistrer le consentement</button>
        </form>
        <ErrorBox error={grant.error} prefix="Enregistrement impossible" />
        {!!consents.data?.length && <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th scope="col">Personne</th><th scope="col">Numéro</th><th scope="col">État</th><th scope="col">Origine</th><th scope="col">Mis à jour</th></tr></thead>
          <tbody>{consents.data.map(k => <tr key={k.id}><td>{k.subjectType === "consultant" ? nameOf(k.subjectId) : "Contact client"}</td><td className="num">{k.phone}</td>
            <td>{k.status === "opted_in" ? <span className="badge b-success">Consentement donné</span> : <span className="badge b-danger">Retiré</span>}</td><td>{SOURCES[k.source] ?? (k.source === "stop_keyword" ? "Mot-clé STOP" : k.source)}</td><td>{fmtDateTime(k.updatedAt)}</td></tr>)}</tbody></table></div>}
      </section>
    </>
  );
}
