"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { ErrorBox, Forbidden, isForbidden } from "@/lib/ui";

type Job = { id: string; status: string; fileName: string | null; rowsTotal: number; rowsValid: number; rowsInvalid: number; errors: { line: number; errors: string[] }[]; mapping: Record<string, string | undefined>; createdAt: string };
const STATUS: Record<string, { label: string; cls: string }> = { previewed: { label: "À valider", cls: "b-info" }, committed: { label: "Importé", cls: "b-success" }, cancelled: { label: "Abandonné", cls: "b-neutral" }, rolled_back: { label: "Annulé", cls: "b-warning" } };
export default function ImportsPage() {
  const qc = useQueryClient();
  const jobs = useQuery({ queryKey: ["imports"], queryFn: () => api<Job[]>("crm/imports") });
  const [csv, setCsv] = useState(""); const [fileName, setFileName] = useState(""); const [defaultKind, setDefaultKind] = useState("consultant"); const [preview, setPreview] = useState<Job | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["imports"] });
  const prev = useMutation({ mutationFn: () => api<Job>("crm/imports/preview", { method: "POST", body: { csv, ...(fileName ? { fileName } : {}), defaultKind } }), onSuccess: j => { setPreview(j); refresh(); } });
  const act = useMutation({ mutationFn: (a: { id: string; ev: "commit" | "cancel" | "rollback" }) => api(`crm/imports/${a.id}/${a.ev}`, { method: "POST", body: {} }), onSuccess: () => { setPreview(null); setCsv(""); setFileName(""); refresh(); qc.invalidateQueries({ queryKey: ["prospects"] }); } });
  async function onFile(f: File | undefined) { if (!f) return; if (f.size > 1_000_000) { setCsv(""); setFileName(""); alert("Fichier trop volumineux (1 Mo maximum)."); return; } setFileName(f.name); setCsv(await f.text()); setPreview(null); }
  if (isForbidden(jobs.error)) return <><h1>Imports de prospects</h1><Forbidden what="les imports" /></>;
  return (
    <>
      <h1>Imports de prospects</h1>
      <div className="alert a-info" role="note"><span>Fichier CSV (séparateur « ; » ou « , »), 1 Mo et 2 000 lignes maximum. Rien n'est créé avant votre validation de l'aperçu ; un import peut être annulé tant qu'aucun prospect importé n'a été travaillé.</span></div>
      <div className="split">
        <div className="main stack" style={{ gap: 16 }}>
          <section className="card" aria-labelledby="i-prev">
            <div className="card-h"><h2 id="i-prev">Aperçu</h2></div>
            {!preview && <div className="card-b muted">Choisissez un fichier puis lancez l'aperçu.</div>}
            {preview && <div className="card-b stack" style={{ gap: 12 }}>
              <div><b>{preview.rowsValid}</b> ligne(s) valide(s) sur {preview.rowsTotal} · <b>{preview.rowsInvalid}</b> rejetée(s)</div>
              <div className="small muted">Colonnes reconnues : {Object.entries(preview.mapping).filter(([, v]) => v).map(([k, v]) => `${k} ← « ${v} »`).join(", ")}</div>
              {preview.errors.length > 0 && <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th scope="col">Ligne</th><th scope="col">Problème</th></tr></thead>
                <tbody>{preview.errors.map(e => <tr key={e.line}><td className="num">{e.line}</td><td>{e.errors.join(", ")}</td></tr>)}</tbody></table></div>}
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-primary" disabled={act.isPending || preview.rowsValid === 0} onClick={() => act.mutate({ id: preview.id, ev: "commit" })}>Importer {preview.rowsValid} prospect(s)</button>
                <button className="btn btn-ghost" disabled={act.isPending} onClick={() => act.mutate({ id: preview.id, ev: "cancel" })}>Abandonner</button></div></div>}
            <ErrorBox error={act.error} prefix="Opération impossible" />
          </section>
          <section className="card" aria-labelledby="i-hist">
            <div className="card-h"><h2 id="i-hist">Historique</h2></div>
            {jobs.data?.length === 0 && <div className="card-b muted">Aucun import.</div>}
            {jobs.data && jobs.data.length > 0 && <div className="tbl-wrap"><table className="tbl compact">
              <thead><tr><th scope="col">Fichier</th><th scope="col">Lignes</th><th scope="col">Statut</th><th scope="col">Actions</th></tr></thead>
              <tbody>{jobs.data.map(j => <tr key={j.id}><td>{j.fileName ?? "sans nom"}<div className="small muted">{fmtDateTime(j.createdAt)}</div></td><td className="num">{j.rowsValid} / {j.rowsTotal}</td>
                <td><span className={`badge ${STATUS[j.status]?.cls ?? "b-neutral"}`}>{STATUS[j.status]?.label ?? j.status}</span></td>
                <td>{j.status === "committed" && <button className="btn btn-ghost btn-sm" disabled={act.isPending} onClick={() => { if (confirm("Annuler cet import ? Les prospects importés seront archivés.")) act.mutate({ id: j.id, ev: "rollback" }); }}>Annuler l'import</button>}</td></tr>)}</tbody></table></div>}
          </section>
        </div>
        <form className="card side" aria-labelledby="i-new" onSubmit={e => { e.preventDefault(); prev.mutate(); }}>
          <div className="card-h"><h2 id="i-new">Nouvel import</h2></div>
          <div className="card-b stack" style={{ gap: 16 }}>
            <div className="field"><label className="label" htmlFor="if">Fichier CSV</label><input id="if" type="file" accept=".csv,text/csv" className="input" onChange={e => onFile(e.target.files?.[0])} /></div>
            <div className="field"><label className="label" htmlFor="ik">Type par défaut</label><select id="ik" className="input" value={defaultKind} onChange={e => setDefaultKind(e.target.value)}><option value="consultant">Consultant</option><option value="company">Entreprise</option></select></div>
            <ErrorBox error={prev.error} prefix="Aperçu impossible" />
          </div>
          <div className="card-f"><button type="submit" className="btn btn-primary" disabled={prev.isPending || !csv}>Lancer l'aperçu</button></div>
        </form>
      </div>
    </>
  );
}
