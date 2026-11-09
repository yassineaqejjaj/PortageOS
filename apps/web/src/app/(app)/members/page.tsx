"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorBox, Forbidden, isForbidden } from "@/lib/ui";

type M = { userId: string; email: string; roles: string[]; companyId: string | null; consultantId: string | null; disabled: boolean; mfaEnabled: boolean; you: boolean };
type Inv = { id: string; kind: string; email: string; roles: string[]; expiresAt: string; acceptedAt: string | null; revokedAt: string | null };
const ROLES: Record<string, string> = { tenant_admin: "Administrateur", direction: "Direction", commerce: "Commerce", operations: "Opérations", hr: "RH", payroll: "Paie", finance: "Finance", compliance: "Conformité", consultant: "Consultant", client_user: "Client approbateur", external_accountant: "Expert-comptable", referrer: "Apporteur" };

export default function MembersPage() {
  const qc = useQueryClient();
  const [f, setF] = useState({ email: "", roles: [] as string[], companyId: "", consultantId: "" });
  const [link, setLink] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null); const [draft, setDraft] = useState<string[]>([]);
  const members = useQuery({ queryKey: ["members"], queryFn: () => api<M[]>("members") });
  const invs = useQuery({ queryKey: ["invitations"], queryFn: () => api<Inv[]>("invitations") });
  const sec = useQuery({ queryKey: ["tenant-security"], queryFn: () => api<{ mfaRequired: boolean }>("tenant/security") });
  const cos = useQuery({ queryKey: ["companies"], queryFn: () => api<{ id: string; name: string }[]>("companies"), retry: false });
  const cons = useQuery({ queryKey: ["consultants"], queryFn: () => api<{ id: string; firstName: string; lastName: string }[]>("consultants"), retry: false });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["members"] }); qc.invalidateQueries({ queryKey: ["invitations"] }); qc.invalidateQueries({ queryKey: ["tenant-security"] }); };
  const invite = useMutation({ mutationFn: () => api<{ link: string }>("invitations", { method: "POST", body: { email: f.email, roles: f.roles, ...(f.companyId ? { companyId: f.companyId } : {}), ...(f.consultantId ? { consultantId: f.consultantId } : {}) } }), onSuccess: r => { setLink(`${window.location.origin}${r.link}`); setF({ email: "", roles: [], companyId: "", consultantId: "" }); refresh(); } });
  const revokeInv = useMutation({ mutationFn: (id: string) => api(`invitations/${id}`, { method: "DELETE" }), onSuccess: refresh });
  const save = useMutation({ mutationFn: (userId: string) => api(`members/${userId}`, { method: "PATCH", body: { roles: draft } }), onSuccess: () => { setEdit(null); refresh(); } });
  const remove = useMutation({ mutationFn: (userId: string) => api(`members/${userId}`, { method: "DELETE" }), onSuccess: refresh });
  const reset = useMutation({ mutationFn: (userId: string) => api<{ link: string }>(`members/${userId}/reset-link`, { method: "POST" }), onSuccess: r => setLink(`${window.location.origin}${r.link}`) });
  const setSec = useMutation({ mutationFn: (mfaRequired: boolean) => api("tenant/security", { method: "PUT", body: { mfaRequired } }), onSuccess: refresh });
  if (isForbidden(members.error)) return <><h1>Membres et accès</h1><Forbidden what="les membres" /></>;
  const toggle = (arr: string[], r: string) => arr.includes(r) ? arr.filter(x => x !== r) : [...arr, r];
  const pending = invs.data?.filter(i => !i.acceptedAt && !i.revokedAt && new Date(i.expiresAt) > new Date());
  return (
    <>
      <h1>Membres et accès</h1>
      <ErrorBox error={members.error ?? invite.error ?? revokeInv.error ?? save.error ?? remove.error ?? reset.error ?? setSec.error} prefix="Erreur" />
      {link && <div className="alert a-warning" role="alert"><div><b>Lien à usage unique — affiché une seule fois.</b> Aucun e-mail n’est envoyé (fournisseur non connecté) : transmettez-le par un canal sûr.<div className="mono" style={{ wordBreak: "break-all", margin: "8px 0" }}>{link}</div>
        <button className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard?.writeText(link)}>Copier</button> <button className="btn btn-ghost btn-sm" onClick={() => setLink(null)}>Masquer</button></div></div>}
      <section className="card" aria-labelledby="sec"><div className="card-h"><h2 id="sec">Politique de la société</h2></div>
        <div className="card-b row between"><label className="check"><input type="checkbox" checked={!!sec.data?.mfaRequired} disabled={setSec.isPending} onChange={e => setSec.mutate(e.target.checked)} /> Imposer l’authentification à deux facteurs à tous les membres</label>
          <span className="hint">Vous devez avoir activé votre propre MFA avant de pouvoir l’imposer.</span></div></section>
      <div className="split">
        <section className="card main" aria-labelledby="l"><div className="card-h"><h2 id="l">Membres</h2></div>
          <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th scope="col">Utilisateur</th><th scope="col">Rôles</th><th scope="col">MFA</th><th scope="col">Actions</th></tr></thead>
            <tbody>{members.data?.map(m => (
              <tr key={m.userId}><td>{m.email}{m.you && <span className="badge b-info" style={{ marginLeft: 8 }}>Vous</span>}</td>
                <td>{edit === m.userId ? <div className="stack" style={{ gap: 4 }}>{Object.entries(ROLES).map(([k, v]) => <label key={k} className="check"><input type="checkbox" checked={draft.includes(k)} onChange={() => setDraft(toggle(draft, k))} /> {v}</label>)}</div> : m.roles.map(r => ROLES[r] ?? r).join(", ")}</td>
                <td>{m.mfaEnabled ? <span className="badge b-success">Activé</span> : <span className="badge b-neutral">Non</span>}</td>
                <td><div className="row" style={{ gap: 6 }}>
                  {edit === m.userId ? <><button className="btn btn-primary btn-sm" disabled={save.isPending || !draft.length} onClick={() => save.mutate(m.userId)}>Enregistrer</button><button className="btn btn-ghost btn-sm" onClick={() => setEdit(null)}>Annuler</button></>
                    : <button className="btn btn-secondary btn-sm" onClick={() => { setEdit(m.userId); setDraft(m.roles); }}>Modifier les rôles</button>}
                  <button className="btn btn-ghost btn-sm" onClick={() => reset.mutate(m.userId)}>Lien de réinitialisation</button>
                  {!m.you && <button className="btn btn-ghost btn-sm" disabled={remove.isPending} onClick={() => confirm(`Retirer l’accès de ${m.email} ?`) && remove.mutate(m.userId)}>Retirer</button>}</div></td></tr>))}</tbody></table></div></section>
        <div className="side stack">
          <form className="card" aria-labelledby="i" onSubmit={e => { e.preventDefault(); invite.mutate(); }}><div className="card-h"><h2 id="i">Inviter</h2></div>
            <div className="card-b stack">
              <div className="field"><label className="label" htmlFor="ie">E-mail</label><input id="ie" className="input" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} required /></div>
              <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className="label">Rôles</legend><div className="stack" style={{ gap: 4 }}>{Object.entries(ROLES).map(([k, v]) => <label key={k} className="check"><input type="checkbox" checked={f.roles.includes(k)} onChange={() => setF({ ...f, roles: toggle(f.roles, k) })} /> {v}</label>)}</div></fieldset>
              {f.roles.includes("client_user") && <div className="field"><label className="label" htmlFor="ic">Entreprise (obligatoire)</label><select id="ic" className="input" value={f.companyId} onChange={e => setF({ ...f, companyId: e.target.value })} required><option value="">Choisir…</option>{cos.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
              {f.roles.includes("consultant") && <div className="field"><label className="label" htmlFor="ik">Dossier consultant (obligatoire)</label><select id="ik" className="input" value={f.consultantId} onChange={e => setF({ ...f, consultantId: e.target.value })} required><option value="">Choisir…</option>{cons.data?.map(c => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}</select></div>}
            </div><div className="card-f"><button className="btn btn-primary" disabled={invite.isPending || !f.roles.length}>Créer le lien d’invitation</button></div></form>
          <section className="card" aria-labelledby="pi"><div className="card-h"><h2 id="pi">Invitations en attente</h2></div>
            {!pending?.length ? <div className="empty"><p className="muted">Aucune.</p></div> : <div className="list">{pending.map(i => <div key={i.id} className="row between"><span>{i.email}<span className="muted small"> · {i.roles.map(r => ROLES[r] ?? r).join(", ")}</span></span><button className="btn btn-ghost btn-sm" onClick={() => revokeInv.mutate(i.id)}>Révoquer</button></div>)}</div>}</section>
        </div>
      </div>
    </>
  );
}
