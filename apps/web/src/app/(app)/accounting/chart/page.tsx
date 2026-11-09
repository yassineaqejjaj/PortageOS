"use client";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorBox, Forbidden, isForbidden } from "@/lib/ui";

type A = { code: string; label: string; type: string; system: boolean; active: boolean };
const TYPES: Record<string, string> = { asset: "Actif", liability: "Passif", equity: "Capitaux", revenue: "Produit", expense: "Charge" };

export default function ChartPage() {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: "", label: "", type: "asset" });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ permissions: string[] }>("me") });
  const q = useQuery({ queryKey: ["accounts"], queryFn: () => api<A[]>("accounting/accounts") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["accounts"] });
  const create = useMutation({ mutationFn: () => api("accounting/accounts", { method: "POST", body: f }), onSuccess: () => { setF({ code: "", label: "", type: "asset" }); refresh(); } });
  const toggle = useMutation({ mutationFn: (a: A) => api(`accounting/accounts/${a.code}`, { method: "PATCH", body: { active: !a.active } }), onSuccess: refresh });
  if (isForbidden(q.error)) return <><h1>Plan comptable</h1><Forbidden what="le plan comptable" /></>;
  const canWrite = me.data?.permissions.includes("accounting.write");
  return (
    <>
      <p><Link href="/accounting">← Comptabilité</Link></p><h1>Plan comptable</h1>
      <div className="alert a-info" role="note"><span>Le plan par défaut (411, 512, 44571, 706, 6251) est créé à la première écriture : <b>à valider et compléter par votre expert-comptable</b>. Les comptes « système » servent aux flux automatiques et ne peuvent pas être désactivés.</span></div>
      <ErrorBox error={q.error ?? create.error ?? toggle.error} prefix="Erreur" />
      <div className="split">
        <section className="card main" aria-labelledby="l"><div className="card-h"><h2 id="l">Comptes</h2></div>
          <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th scope="col">Compte</th><th scope="col">Libellé</th><th scope="col">Nature</th><th scope="col">Statut</th><th scope="col"><span style={{ position: "absolute", left: -999 }}>Action</span></th></tr></thead>
            <tbody>{q.data?.map(a => <tr key={a.code}><td className="mono">{a.code}</td><td>{a.label}{a.system && <span className="tag" style={{ marginLeft: 8 }}>Système</span>}</td><td>{TYPES[a.type]}</td><td><span className={`badge ${a.active ? "b-success" : "b-neutral"}`}>{a.active ? "Actif" : "Inactif"}</span></td>
              <td className="r">{canWrite && !a.system && <button className="btn btn-ghost btn-sm" disabled={toggle.isPending} onClick={() => toggle.mutate(a)}>{a.active ? "Désactiver" : "Réactiver"}</button>}</td></tr>)}</tbody></table></div></section>
        {canWrite && <form className="card side" onSubmit={e => { e.preventDefault(); create.mutate(); }} aria-labelledby="n"><div className="card-h"><h2 id="n">Nouveau compte</h2></div>
          <div className="card-b stack" style={{ gap: 16 }}>
            <div className="field"><label className="label" htmlFor="cd">Numéro</label><input id="cd" className="input mono" inputMode="numeric" value={f.code} onChange={e => setF({ ...f, code: e.target.value })} required /><span className="hint">3 à 8 chiffres, ne commence pas par 0.</span></div>
            <div className="field"><label className="label" htmlFor="lb">Libellé</label><input id="lb" className="input" value={f.label} onChange={e => setF({ ...f, label: e.target.value })} required /></div>
            <div className="field"><label className="label" htmlFor="tp">Nature</label><select id="tp" className="input" value={f.type} onChange={e => setF({ ...f, type: e.target.value })}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          </div><div className="card-f"><button className="btn btn-primary" disabled={create.isPending}>Ajouter le compte</button></div></form>}
      </div>
    </>
  );
}
