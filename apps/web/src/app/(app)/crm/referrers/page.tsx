"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDate, fmtEUR } from "@/lib/format";
import { COMMISSION_STATUS } from "@/lib/crm";
import { Badge, ErrorBox, Forbidden, isForbidden } from "@/lib/ui";

type Referrer = { id: string; kind: "introducer" | "sponsor"; name: string; email: string | null; status: string; referrals: number; conversions: number; commissions: { accrued: string; approved: string; paid: string } };
type Commission = { id: string; referrer: string; sourceType: string; amount: string; status: string; createdAt: string; paidAt: string | null; paidReference: string | null; rule: string };
export default function ReferrersPage() {
  const qc = useQueryClient();
  const refs = useQuery({ queryKey: ["referrers"], queryFn: () => api<Referrer[]>("crm/referrers") });
  const coms = useQuery({ queryKey: ["commissions"], queryFn: () => api<Commission[]>("crm/commissions"), retry: false });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ permissions: string[] }>("me") });
  const canApprove = me.data?.permissions.includes("commission.approve"), canPay = me.data?.permissions.includes("commission.pay");
  const consultants = useQuery({ queryKey: ["consultants"], queryFn: () => api<{ id: string; firstName: string; lastName: string }[]>("consultants") });
  const [f, setF] = useState({ kind: "introducer", name: "", email: "", consultantId: "" });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["referrers"] }); qc.invalidateQueries({ queryKey: ["commissions"] }); };
  const create = useMutation({ mutationFn: () => api("crm/referrers", { method: "POST", body: { kind: f.kind, name: f.name, ...(f.email ? { email: f.email } : {}), ...(f.kind === "sponsor" ? { consultantId: f.consultantId } : {}) } }), onSuccess: () => { setF({ ...f, name: "", email: "", consultantId: "" }); refresh(); } });
  const setStatus = useMutation({ mutationFn: (a: { id: string; status: string }) => api(`crm/referrers/${a.id}`, { method: "PATCH", body: { status: a.status } }), onSuccess: refresh });
  const [ref, setRef] = useState<{ id: string; v: string } | null>(null);
  const act = useMutation({ mutationFn: (a: { id: string; event: string; reference?: string }) => api(`crm/commissions/${a.id}/transition`, { method: "POST", body: { event: a.event, ...(a.reference ? { reference: a.reference } : {}) } }), onSuccess: () => { setRef(null); refresh(); } });
  return (
    <>
      <h1>Apporteurs et commissions</h1>
      <div className="alert a-info" role="note"><span>Les règles de commission sont figées à la création du parrainage. Une commission est approuvée par une personne différente de celle qui l'a enregistrée (quatre yeux), puis son paiement génère une écriture comptable (622 / 512).</span></div>
      <div className="split">
        <div className="main stack" style={{ gap: 16 }}>
          <section className="card" aria-labelledby="r-liste">
            <div className="card-h"><h2 id="r-liste">Apporteurs d'affaires et parrains</h2></div>
            {isForbidden(refs.error) && <div className="card-b"><Forbidden what="la liste des apporteurs" /></div>}
            <ErrorBox error={isForbidden(refs.error) ? setStatus.error : refs.error ?? setStatus.error} prefix="Opération impossible" />
            {refs.data?.length === 0 && <div className="card-b muted">Aucun apporteur enregistré.</div>}
            {refs.data && refs.data.length > 0 && <div className="tbl-wrap"><table className="tbl compact">
              <thead><tr><th scope="col">Nom</th><th scope="col">Type</th><th scope="col">Parrainages</th><th scope="col">Commissions (due / approuvée / payée)</th><th scope="col">Statut</th></tr></thead>
              <tbody>{refs.data.map(r => <tr key={r.id}>
                <td><b>{r.name}</b><div className="small muted">{r.email ?? "—"}</div></td><td>{r.kind === "sponsor" ? "Parrain consultant" : "Apporteur d'affaires"}</td>
                <td className="num">{r.conversions} / {r.referrals} convertis</td>
                <td className="num">{fmtEUR(r.commissions.accrued)} / {fmtEUR(r.commissions.approved)} / {fmtEUR(r.commissions.paid)}</td>
                <td><button className="btn btn-ghost btn-sm" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: r.id, status: r.status === "active" ? "suspended" : "active" })}>{r.status === "active" ? "Actif — suspendre" : "Suspendu — réactiver"}</button></td></tr>)}</tbody></table></div>}
          </section>
          <section className="card" aria-labelledby="c-liste">
            <div className="card-h"><h2 id="c-liste">Commissions</h2></div>
            {isForbidden(coms.error) && <div className="card-b"><Forbidden what="les commissions" /></div>}
            <ErrorBox error={isForbidden(coms.error) ? null : coms.error ?? act.error} prefix="Opération impossible" />
            {coms.data?.length === 0 && <div className="card-b muted">Aucune commission. Elles naissent d'un parrainage converti (forfait) ou d'un encaissement (proportionnel).</div>}
            {coms.data && coms.data.length > 0 && <div className="tbl-wrap"><table className="tbl compact">
              <thead><tr><th scope="col">Apporteur</th><th scope="col">Origine</th><th scope="col">Règle</th><th scope="col">Montant</th><th scope="col">Statut</th><th scope="col">Actions</th></tr></thead>
              <tbody>{coms.data.map(c => <tr key={c.id}>
                <td>{c.referrer}</td><td>{c.sourceType === "conversion" ? "Conversion" : "Encaissement"}<div className="small muted">{fmtDate(c.createdAt)}</div></td><td className="small">{c.rule}</td>
                <td className="num"><b>{fmtEUR(c.amount)}</b></td>
                <td><Badge map={COMMISSION_STATUS} value={c.status} />{c.paidReference && <div className="small muted">Réf. {c.paidReference}</div>}</td>
                <td><div className="row" style={{ gap: 6 }}>
                  {c.status === "accrued" && canApprove && <button className="btn btn-secondary btn-sm" disabled={act.isPending} onClick={() => act.mutate({ id: c.id, event: "approve" })}>Approuver</button>}
                  {c.status === "approved" && canPay && <button className="btn btn-secondary btn-sm" onClick={() => setRef({ id: c.id, v: "" })}>Payer</button>}
                  {(c.status === "accrued" || c.status === "approved") && canApprove && <button className="btn btn-ghost btn-sm" disabled={act.isPending} onClick={() => act.mutate({ id: c.id, event: "cancel" })}>Annuler</button>}</div>
                  {ref?.id === c.id && <form className="row" style={{ marginTop: 8, gap: 6 }} onSubmit={e => { e.preventDefault(); act.mutate({ id: c.id, event: "pay", reference: ref.v }); }}>
                    <label className="label" htmlFor={`pr-${c.id}`} style={{ position: "absolute", left: -999 }}>Référence du virement</label>
                    <input id={`pr-${c.id}`} className="input" style={{ width: 180 }} placeholder="Référence du virement" value={ref.v} onChange={e => setRef({ id: c.id, v: e.target.value })} required minLength={3} />
                    <button type="submit" className="btn btn-primary btn-sm" disabled={act.isPending}>Confirmer le paiement</button></form>}</td></tr>)}</tbody></table></div>}
          </section>
        </div>
        {!isForbidden(refs.error) && <form className="card side" aria-labelledby="r-new" onSubmit={e => { e.preventDefault(); create.mutate(); }}>
          <div className="card-h"><h2 id="r-new">Nouvel apporteur</h2></div>
          <div className="card-b stack" style={{ gap: 16 }}>
            <div className="field"><label className="label" htmlFor="rk">Type</label><select id="rk" className="input" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}><option value="introducer">Apporteur d'affaires</option><option value="sponsor">Parrain (consultant)</option></select></div>
            <div className="field"><label className="label" htmlFor="rn">Nom</label><input id="rn" className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} minLength={2} required /></div>
            <div className="field"><label className="label" htmlFor="re">Email</label><input id="re" type="email" className="input" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></div>
            {f.kind === "sponsor" && <div className="field"><label className="label" htmlFor="rc">Consultant parrain</label><select id="rc" className="input" value={f.consultantId} onChange={e => setF({ ...f, consultantId: e.target.value })} required><option value="">Choisir…</option>{consultants.data?.map(c => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}</select><span className="hint">Un parrain doit être un consultant existant.</span></div>}
            <ErrorBox error={create.error} prefix="Création impossible" />
          </div>
          <div className="card-f"><button type="submit" className="btn btn-primary" disabled={create.isPending}>Ajouter l'apporteur</button></div>
        </form>}
      </div>
    </>
  );
}
