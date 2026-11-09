"use client";
import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDate, fmtEUR } from "@/lib/format";
import { ErrorBox, Forbidden, isForbidden } from "@/lib/ui";

type Contact = { id: string; name: string; email: string | null; phone: string | null; role: string; isPrimary: boolean };
type Site = { id: string; label: string; address: string; postalCode: string; city: string };
type PO = { id: string; reference: string; amount: string; startDate: string; endDate: string; status: string; consumed: string; remaining: string; overConsumed: boolean };
type Overview = { company: { id: string; name: string; siren: string | null; paymentTermsDays: number | null; sirenChecksumValid: boolean | null }; contacts: Contact[]; sites: Site[]; purchaseOrders: PO[]; activeAgreements: number; activeMissions: number };
const ROLE: Record<string, string> = { billing: "Facturation", operations: "Opérationnel", signatory: "Signataire", other: "Autre" };
const PO_STATUS: Record<string, { label: string; cls: string }> = { open: { label: "Ouvert", cls: "b-success" }, closed: { label: "Clos", cls: "b-neutral" }, cancelled: { label: "Annulé", cls: "b-neutral" } };

export default function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ permissions: string[] }>("me") });
  const canWrite = !!me.data?.permissions.includes("company.write");
  const ov = useQuery({ queryKey: ["company", id], queryFn: () => api<Overview>(`companies/${id}/overview`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["company", id] });
  const [terms, setTerms] = useState("");
  const saveTerms = useMutation({ mutationFn: () => api(`companies/${id}/terms`, { method: "PATCH", body: { paymentTermsDays: terms === "" ? null : Number(terms) } }), onSuccess: refresh });
  const [c, setC] = useState({ name: "", email: "", phone: "", role: "billing", isPrimary: false });
  const addC = useMutation({ mutationFn: () => api(`companies/${id}/contacts`, { method: "POST", body: { name: c.name, role: c.role, isPrimary: c.isPrimary, ...(c.email ? { email: c.email } : {}), ...(c.phone ? { phone: c.phone } : {}) } }), onSuccess: () => { setC({ ...c, name: "", email: "", phone: "", isPrimary: false }); refresh(); } });
  const delC = useMutation({ mutationFn: (cid: string) => api(`companies/${id}/contacts/${cid}`, { method: "DELETE" }), onSuccess: refresh });
  const [s, setS] = useState({ label: "", address: "", postalCode: "", city: "" });
  const addS = useMutation({ mutationFn: () => api(`companies/${id}/sites`, { method: "POST", body: s }), onSuccess: () => { setS({ label: "", address: "", postalCode: "", city: "" }); refresh(); } });
  const delS = useMutation({ mutationFn: (sid: string) => api(`companies/${id}/sites/${sid}`, { method: "DELETE" }), onSuccess: refresh });
  const [p, setP] = useState({ reference: "", amount: "", startDate: "", endDate: "" });
  const addP = useMutation({ mutationFn: () => api(`companies/${id}/purchase-orders`, { method: "POST", body: p }), onSuccess: () => { setP({ reference: "", amount: "", startDate: "", endDate: "" }); refresh(); } });
  const actP = useMutation({ mutationFn: (a: { pid: string; ev: string }) => api(`companies/${id}/purchase-orders/${a.pid}/${a.ev}`, { method: "POST", body: {} }), onSuccess: refresh });
  if (isForbidden(ov.error)) return <><h1>Client</h1><Forbidden what="cette fiche client" /></>;
  if (!ov.data) return <><h1>Client</h1><ErrorBox error={ov.error} prefix="Chargement impossible" />{ov.isLoading && <p>Chargement…</p>}</>;
  const x = ov.data; const mut = addC.error ?? delC.error ?? addS.error ?? delS.error ?? addP.error ?? actP.error ?? saveTerms.error;
  return (
    <>
      <p className="small"><Link href="/companies">← Clients</Link></p>
      <h1>{x.company.name}</h1>
      <p className="muted">SIREN {x.company.siren ?? "non renseigné"}{x.company.sirenChecksumValid === false && <> · <span className="badge b-warning">Somme de contrôle SIREN invalide — à vérifier (Sirene non connecté)</span></>} · {x.activeMissions} mission(s) active(s) · {x.activeAgreements} accord(s)-cadre(s) actif(s)</p>
      <ErrorBox error={mut} prefix="Opération impossible" />
      <div className="grid-2">
        <section className="card" aria-labelledby="cond">
          <div className="card-h"><h2 id="cond">Conditions de paiement</h2></div>
          <form className="card-b row" style={{ gap: 8, alignItems: "flex-end" }} onSubmit={e => { e.preventDefault(); saveTerms.mutate(); }}>
            <div className="field"><label className="label" htmlFor="terms">Délai de paiement (jours)</label>
              <input id="terms" inputMode="numeric" className="input" style={{ width: 160 }} placeholder={x.company.paymentTermsDays?.toString() ?? "non défini"} value={terms} onChange={e => setTerms(e.target.value)} disabled={!canWrite} />
              <span className="hint">Délai convenu, saisi : aucune règle légale n'est appliquée par la plateforme. Actuel : {x.company.paymentTermsDays ?? "non défini"}.</span></div>
            {canWrite && <button className="btn btn-secondary btn-sm" type="submit" disabled={saveTerms.isPending}>Enregistrer</button>}
          </form>
        </section>
        <section className="card" aria-labelledby="sit">
          <div className="card-h"><h2 id="sit">Sites</h2></div>
          <div className="card-b stack" style={{ gap: 8 }}>
            {x.sites.length === 0 ? <span className="muted">Aucun site.</span> : <ul className="stack" style={{ gap: 6, margin: 0, padding: 0, listStyle: "none" }}>{x.sites.map(t => <li key={t.id} className="row" style={{ justifyContent: "space-between" }}><span><b>{t.label}</b> · {t.address}, {t.postalCode} {t.city}</span>{canWrite && <button className="btn btn-ghost btn-sm" onClick={() => delS.mutate(t.id)} aria-label={`Archiver le site ${t.label}`}>Archiver</button>}</li>)}</ul>}
            {canWrite && <form className="row" style={{ gap: 6, flexWrap: "wrap" }} onSubmit={e => { e.preventDefault(); addS.mutate(); }}>
              {([["label", "Libellé du site"], ["address", "Adresse"], ["postalCode", "Code postal"], ["city", "Ville"]] as const).map(([k, l]) => <div key={k}><label className="label" htmlFor={`s-${k}`} style={{ position: "absolute", left: -999 }}>{l}</label><input id={`s-${k}`} className="input" style={{ width: k === "postalCode" ? 100 : 150 }} placeholder={l} value={s[k]} onChange={e => setS({ ...s, [k]: e.target.value })} required /></div>)}
              <button className="btn btn-secondary btn-sm" type="submit" disabled={addS.isPending}>Ajouter le site</button></form>}
          </div>
        </section>
      </div>
      <section className="card" aria-labelledby="ctc" style={{ marginTop: 16 }}>
        <div className="card-h"><h2 id="ctc">Contacts</h2></div>
        {x.contacts.length === 0 ? <div className="card-b muted">Aucun contact.</div> : <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th scope="col">Nom</th><th scope="col">Rôle</th><th scope="col">Coordonnées</th><th scope="col">Actions</th></tr></thead>
          <tbody>{x.contacts.map(k => <tr key={k.id}><td><b>{k.name}</b></td><td>{ROLE[k.role]}{k.isPrimary && <> <span className="badge b-info">Référent</span></>}</td><td className="small">{k.email ?? ""} {k.phone ?? ""}</td>
            <td>{canWrite && <button className="btn btn-ghost btn-sm" disabled={delC.isPending} onClick={() => delC.mutate(k.id)} aria-label={`Retirer ${k.name}`}>Retirer</button>}</td></tr>)}</tbody></table></div>}
        {canWrite && <form className="card-b row" style={{ gap: 6, flexWrap: "wrap", alignItems: "flex-end" }} onSubmit={e => { e.preventDefault(); addC.mutate(); }}>
          <div><label className="label" htmlFor="c-name">Nom du contact</label><input id="c-name" className="input" value={c.name} onChange={e => setC({ ...c, name: e.target.value })} required minLength={2} /></div>
          <div><label className="label" htmlFor="c-email">Email</label><input id="c-email" type="email" className="input" value={c.email} onChange={e => setC({ ...c, email: e.target.value })} /></div>
          <div><label className="label" htmlFor="c-phone">Téléphone</label><input id="c-phone" className="input" value={c.phone} onChange={e => setC({ ...c, phone: e.target.value })} /></div>
          <div><label className="label" htmlFor="c-role">Rôle</label><select id="c-role" className="input" value={c.role} onChange={e => setC({ ...c, role: e.target.value })}>{Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={c.isPrimary} onChange={e => setC({ ...c, isPrimary: e.target.checked })} /> Référent pour ce rôle</label>
          <button className="btn btn-secondary btn-sm" type="submit" disabled={addC.isPending}>Ajouter le contact</button></form>}
      </section>
      <section className="card" aria-labelledby="bc" style={{ marginTop: 16 }}>
        <div className="card-h"><h2 id="bc">Bons de commande</h2></div>
        {x.purchaseOrders.length === 0 ? <div className="card-b muted">Aucun bon de commande.</div> : <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th scope="col">Référence</th><th scope="col">Période</th><th scope="col">Montant HT</th><th scope="col">Consommé</th><th scope="col">Reste</th><th scope="col">Statut</th><th scope="col">Actions</th></tr></thead>
          <tbody>{x.purchaseOrders.map(o => <tr key={o.id}><td><b>{o.reference}</b></td><td className="num">{fmtDate(o.startDate)} → {fmtDate(o.endDate)}</td><td className="num">{fmtEUR(o.amount)}</td><td className="num">{fmtEUR(o.consumed)}</td>
            <td className="num">{fmtEUR(o.remaining)} {o.overConsumed && <span className="badge b-danger">Dépassement</span>}</td><td><span className={`badge ${PO_STATUS[o.status]?.cls}`}>{PO_STATUS[o.status]?.label}</span></td>
            <td>{canWrite && o.status === "open" && <div className="row" style={{ gap: 6 }}><button className="btn btn-secondary btn-sm" disabled={actP.isPending} onClick={() => actP.mutate({ pid: o.id, ev: "close" })}>Clore</button><button className="btn btn-ghost btn-sm" disabled={actP.isPending} onClick={() => actP.mutate({ pid: o.id, ev: "cancel" })}>Annuler</button></div>}</td></tr>)}</tbody></table></div>}
        <div className="card-b small muted">Consommation = HT des factures émises des missions rattachées (hors brouillons, annulées et créditées). Un dépassement est signalé, jamais bloquant.</div>
        {canWrite && <form className="card-b row" style={{ gap: 6, flexWrap: "wrap", alignItems: "flex-end" }} onSubmit={e => { e.preventDefault(); addP.mutate(); }}>
          <div><label className="label" htmlFor="p-ref">Référence</label><input id="p-ref" className="input" value={p.reference} onChange={e => setP({ ...p, reference: e.target.value })} required minLength={2} /></div>
          <div><label className="label" htmlFor="p-amt">Montant HT (€)</label><input id="p-amt" inputMode="decimal" className="input" value={p.amount} onChange={e => setP({ ...p, amount: e.target.value })} required /></div>
          <div><label className="label" htmlFor="p-s">Début</label><input id="p-s" type="date" className="input" value={p.startDate} onChange={e => setP({ ...p, startDate: e.target.value })} required /></div>
          <div><label className="label" htmlFor="p-e">Fin</label><input id="p-e" type="date" className="input" value={p.endDate} onChange={e => setP({ ...p, endDate: e.target.value })} required /></div>
          <button className="btn btn-secondary btn-sm" type="submit" disabled={addP.isPending}>Ajouter le bon de commande</button></form>}
      </section>
    </>
  );
}
