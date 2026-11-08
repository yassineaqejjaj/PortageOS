"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { ErrorBox, Forbidden, isForbidden } from "@/lib/ui";

type Tpl = { id: string; kind: string; name: string; version: number; status: string; variables: string[]; body: string };
type Ct = { id: string; kind: string; status: string; signedAt: string | null; signatureProvider: string; template: { name: string; version: number } };
const KIND: Record<string, string> = { employment_cdi: "Contrat de travail CDI", employment_cdd: "Contrat de travail CDD", service: "Prestation commerciale", framework: "Accord-cadre" };
const ST: Record<string, { label: string; cls: string }> = { draft: { label: "Brouillon", cls: "b-neutral" }, sent: { label: "Envoyé", cls: "b-info" }, signed: { label: "Signé (déclaré)", cls: "b-success" }, cancelled: { label: "Annulé", cls: "b-danger" } };

export default function ContractsPage() {
  const qc = useQueryClient();
  const tpls = useQuery({ queryKey: ["tpls"], queryFn: () => api<Tpl[]>("contract-templates") });
  const cts = useQuery({ queryKey: ["contracts"], queryFn: () => api<Ct[]>("contracts") });
  const cons = useQuery({ queryKey: ["consultants"], queryFn: () => api<{ id: string; firstName: string; lastName: string }[]>("consultants"), retry: false });
  const cos = useQuery({ queryKey: ["companies"], queryFn: () => api<{ id: string; name: string }[]>("companies"), retry: false });
  const [t, setT] = useState({ kind: "employment_cdi", name: "", body: "" });
  const [c, setC] = useState({ templateId: "", consultantId: "", companyId: "", vars: {} as Record<string, string> });
  const [sign, setSign] = useState<string | null>(null); const [decl, setDecl] = useState("");
  const refresh = () => { qc.invalidateQueries({ queryKey: ["tpls"] }); qc.invalidateQueries({ queryKey: ["contracts"] }); qc.invalidateQueries({ queryKey: ["consultants"] }); };
  const mkT = useMutation({ mutationFn: () => api("contract-templates", { method: "POST", body: t }), onSuccess: () => { setT({ ...t, name: "", body: "" }); refresh(); } });
  const pub = useMutation({ mutationFn: (id: string) => api(`contract-templates/${id}/publish`, { method: "POST" }), onSuccess: refresh });
  const mkC = useMutation({ mutationFn: () => api("contracts", { method: "POST", body: { templateId: c.templateId, ...(c.consultantId ? { consultantId: c.consultantId } : {}), ...(c.companyId ? { companyId: c.companyId } : {}), variables: c.vars } }), onSuccess: () => { setC({ ...c, vars: {} }); refresh(); } });
  const move = useMutation({ mutationFn: (a: { id: string; event: string; signatureDeclaration?: string }) => api(`contracts/${a.id}/transition`, { method: "POST", body: a }), onSuccess: () => { setSign(null); setDecl(""); refresh(); } });
  if (isForbidden(cts.error)) return <><h1>Contrats</h1><Forbidden what="les contrats" /></>;
  const sel = tpls.data?.find(x => x.id === c.templateId);
  return (
    <>
      <h1>Contrats</h1>
      <div className="alert a-info" role="note"><span>La signature électronique n’est <b>pas connectée</b> : « Signé » correspond à une déclaration interne tracée (provider « none »), sans valeur de signature qualifiée. Les textes des modèles sont fournis par votre cabinet : la plateforme ne génère aucun contenu juridique.</span></div>
      <ErrorBox error={cts.error ?? mkT.error ?? pub.error ?? mkC.error ?? move.error} prefix="Erreur" />
      <div className="split">
        <section className="card main" aria-labelledby="c"><div className="card-h"><h2 id="c">Contrats</h2></div>
          {cts.data?.length === 0 && <div className="empty"><h3>Aucun contrat</h3></div>}
          {!!cts.data?.length && <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th scope="col">Modèle</th><th scope="col">Type</th><th scope="col">Statut</th><th scope="col">Actions</th></tr></thead>
            <tbody>{cts.data.map(x => <tr key={x.id}><td>{x.template.name} <span className="muted small">v{x.template.version}</span></td><td>{KIND[x.kind]}</td><td><span className={`badge ${ST[x.status]?.cls}`}>{ST[x.status]?.label}</span>{x.signedAt && <div className="small muted">{fmtDate(x.signedAt)}</div>}</td>
              <td><div className="row" style={{ gap: 6 }}>{x.status === "draft" && <button className="btn btn-secondary btn-sm" onClick={() => move.mutate({ id: x.id, event: "send" })}>Marquer envoyé</button>}
                {x.status === "sent" && <button className="btn btn-primary btn-sm" onClick={() => { setSign(x.id); setDecl(""); }}>Déclarer la signature</button>}
                {["draft", "sent"].includes(x.status) && <button className="btn btn-ghost btn-sm" onClick={() => move.mutate({ id: x.id, event: "cancel" })}>Annuler</button>}</div>
                {sign === x.id && <form className="row" style={{ marginTop: 8 }} onSubmit={e => { e.preventDefault(); move.mutate({ id: x.id, event: "sign", signatureDeclaration: decl }); }}>
                  <label className="label" htmlFor={`s-${x.id}`} style={{ position: "absolute", left: -999 }}>Déclaration de signature</label>
                  <input id={`s-${x.id}`} className="input" style={{ width: 260 }} placeholder="Ex. Exemplaires signés reçus le …" value={decl} onChange={e => setDecl(e.target.value)} minLength={10} required />
                  <button className="btn btn-primary btn-sm" disabled={decl.trim().length < 10 || move.isPending}>Confirmer</button></form>}</td></tr>)}</tbody></table></div>}
        </section>
        <div className="side stack">
          <section className="card" aria-labelledby="m"><div className="card-h"><h2 id="m">Modèles</h2></div>
            <div className="list">{tpls.data?.map(x => <div key={x.id} className="row between"><span>{x.name} <span className="muted small">v{x.version} · {KIND[x.kind]}</span></span>{x.status === "draft" ? <button className="btn btn-secondary btn-sm" onClick={() => pub.mutate(x.id)}>Publier</button> : <span className="badge b-success">Publié</span>}</div>)}</div>
            <form className="card-b stack" onSubmit={e => { e.preventDefault(); mkT.mutate(); }}>
              <div className="field"><label className="label" htmlFor="tk">Type</label><select id="tk" className="input" value={t.kind} onChange={e => setT({ ...t, kind: e.target.value })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
              <div className="field"><label className="label" htmlFor="tn">Nom (même nom = nouvelle version)</label><input id="tn" className="input" value={t.name} onChange={e => setT({ ...t, name: e.target.value })} required /></div>
              <div className="field"><label className="label" htmlFor="tb">Texte avec variables {"{{nom}}"}</label><textarea id="tb" className="input" style={{ height: 120, padding: 8 }} value={t.body} onChange={e => setT({ ...t, body: e.target.value })} required minLength={10} /></div>
              <button className="btn btn-secondary" disabled={mkT.isPending}>Créer le modèle</button></form></section>
          <form className="card" onSubmit={e => { e.preventDefault(); mkC.mutate(); }} aria-labelledby="nc"><div className="card-h"><h2 id="nc">Nouveau contrat</h2></div>
            <div className="card-b stack">
              <div className="field"><label className="label" htmlFor="ct">Modèle publié</label><select id="ct" className="input" value={c.templateId} onChange={e => setC({ ...c, templateId: e.target.value, vars: {} })} required><option value="">Choisir…</option>{tpls.data?.filter(x => x.status === "published").map(x => <option key={x.id} value={x.id}>{x.name} v{x.version}</option>)}</select></div>
              {sel?.kind.startsWith("employment")
                ? <div className="field"><label className="label" htmlFor="cc">Consultant</label><select id="cc" className="input" value={c.consultantId} onChange={e => setC({ ...c, consultantId: e.target.value })} required><option value="">Choisir…</option>{cons.data?.map(x => <option key={x.id} value={x.id}>{x.firstName} {x.lastName}</option>)}</select></div>
                : sel && <div className="field"><label className="label" htmlFor="co">Entreprise</label><select id="co" className="input" value={c.companyId} onChange={e => setC({ ...c, companyId: e.target.value })} required><option value="">Choisir…</option>{cos.data?.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>}
              {sel?.variables.map(v => <div className="field" key={v}><label className="label" htmlFor={`v-${v}`}>{v}</label><input id={`v-${v}`} className="input" value={c.vars[v] ?? ""} onChange={e => setC({ ...c, vars: { ...c.vars, [v]: e.target.value } })} required /></div>)}
            </div><div className="card-f"><button className="btn btn-primary" disabled={mkC.isPending || !c.templateId}>Générer le contrat</button></div></form>
        </div>
      </div>
    </>
  );
}
