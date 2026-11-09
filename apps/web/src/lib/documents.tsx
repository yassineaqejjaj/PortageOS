"use client";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { downloadFile } from "./download";
import { fmtDate } from "./format";
import { ErrorBox } from "./ui";

export type Doc = { id: string; category: string; name: string; mime: string; size: number; scanStatus: string; createdAt: string; sensitive: boolean };
export const CATEGORY_LABEL: Record<string, string> = { identity_document: "Pièce d’identité", bank_details: "Coordonnées bancaires", rc_pro: "Attestation RC Pro", contract_copy: "Copie de contrat", receipt: "Justificatif", other: "Autre" };
const kb = (n: number) => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} Ko` : `${(n / 1024 / 1024).toFixed(1)} Mo`;

export async function uploadDocument(file: File, ownerType: string, ownerId: string, category: string): Promise<Doc> {
  if (file.size > 10 * 1024 * 1024) throw new Error("Fichier trop volumineux (10 Mo maximum)");
  const fd = new FormData(); fd.append("ownerType", ownerType); fd.append("ownerId", ownerId); fd.append("category", category); fd.append("file", file);
  const r = await fetch("/api/documents", { method: "POST", body: fd });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error?.message ?? "Dépôt impossible");
  return d as Doc;
}

export function DocumentsPanel({ ownerType, ownerId, categories, canUpload, canDelete, canShare, title = "Documents" }: { ownerType: string; ownerId: string; categories: string[]; canUpload: boolean; canDelete?: boolean; canShare?: boolean; title?: string }) {
  const qc = useQueryClient(); const input = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState(categories[0]!); const [file, setFile] = useState<File | null>(null);
  const [del, setDel] = useState<string | null>(null); const [reason, setReason] = useState(""); const [link, setLink] = useState<string | null>(null); const [dlErr, setDlErr] = useState<string | null>(null);
  const key = ["documents", ownerType, ownerId];
  const list = useQuery({ queryKey: key, queryFn: () => api<Doc[]>(`documents?ownerType=${ownerType}&ownerId=${ownerId}`) });
  const policy = useQuery({ queryKey: ["documents-policy"], queryFn: () => api<{ scanner: string; note: string }>("documents/policy") });
  const up = useMutation({ mutationFn: () => uploadDocument(file!, ownerType, ownerId, category), onSuccess: () => { setFile(null); if (input.current) input.current.value = ""; qc.invalidateQueries({ queryKey: key }); } });
  const remove = useMutation({ mutationFn: (id: string) => api(`documents/${id}`, { method: "DELETE", body: { reason } }), onSuccess: () => { setDel(null); setReason(""); qc.invalidateQueries({ queryKey: key }); } });
  const share = useMutation({ mutationFn: (id: string) => api<{ path: string; expiresAt: string }>(`documents/${id}/link`, { method: "POST", body: { minutes: 15 } }), onSuccess: r => setLink(`${window.location.origin}/api${r.path}`) });
  return (
    <section className="card" aria-labelledby={`doc-${ownerType}`}>
      <div className="card-h"><h2 id={`doc-${ownerType}`}>{title}</h2></div>
      <div className="card-b stack">
        {policy.data?.scanner === "not_connected" && <div className="alert a-warning" role="note"><span><b>Analyse antivirus non connectée</b> : les fichiers (PDF, PNG, JPEG, WebP ; 10 Mo max ; type vérifié sur le contenu) sont stockés « non analysés ».</span></div>}
        <ErrorBox error={list.error ?? up.error ?? remove.error ?? share.error} prefix="Erreur" />{dlErr && <div className="alert a-danger" role="alert"><span>{dlErr}</span></div>}
        {link && <div className="alert a-info" role="status"><div>Lien temporaire (15 minutes, non sensible) : <span className="mono" style={{ wordBreak: "break-all" }}>{link}</span> <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard?.writeText(link)}>Copier</button></div></div>}
        {list.data?.length === 0 && <p className="muted">Aucun document.</p>}
        {!!list.data?.length && <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th scope="col">Document</th><th scope="col">Catégorie</th><th scope="col">Taille</th><th scope="col">Analyse</th><th scope="col">Déposé le</th><th scope="col"><span style={{ position: "absolute", left: -999 }}>Actions</span></th></tr></thead>
          <tbody>{list.data.map(d => (
            <tr key={d.id}><td>{d.name}{d.sensitive && <span className="tag" style={{ marginLeft: 8 }}>Sensible</span>}</td><td>{CATEGORY_LABEL[d.category] ?? d.category}</td><td className="num">{kb(d.size)}</td>
              <td>{d.scanStatus === "clean" ? <span className="badge b-success">Analysé</span> : <span className="badge b-warning">Non analysé</span>}</td><td className="num">{fmtDate(d.createdAt)}</td>
              <td><div className="row" style={{ gap: 6 }}>
                <button className="btn btn-secondary btn-sm" onClick={async () => setDlErr(await downloadFile(`/api/documents/${d.id}/download`, d.name))}>Télécharger</button>
                {canShare && !d.sensitive && <button className="btn btn-ghost btn-sm" disabled={share.isPending} onClick={() => share.mutate(d.id)}>Lien temporaire</button>}
                {canDelete && <button className="btn btn-ghost btn-sm" onClick={() => { setDel(d.id); setReason(""); }}>Supprimer</button>}</div>
                {del === d.id && <form className="row" style={{ marginTop: 6, gap: 6 }} onSubmit={e => { e.preventDefault(); remove.mutate(d.id); }}><label className="label" htmlFor={`r-${d.id}`} style={{ position: "absolute", left: -999 }}>Motif</label><input id={`r-${d.id}`} className="input" style={{ width: 200 }} placeholder="Motif (obligatoire)" value={reason} onChange={e => setReason(e.target.value)} required minLength={5} /><button className="btn btn-danger btn-sm" disabled={remove.isPending || reason.trim().length < 5}>Confirmer</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setDel(null)}>Annuler</button></form>}</td></tr>))}</tbody></table></div>}
        {canUpload && (
          <form className="row" style={{ gap: 8, alignItems: "flex-end" }} onSubmit={e => { e.preventDefault(); if (file) up.mutate(); }}>
            {categories.length > 1 && <div className="field"><label className="label small" htmlFor={`cat-${ownerType}`}>Catégorie</label><select id={`cat-${ownerType}`} className="input" value={category} onChange={e => setCategory(e.target.value)}>{categories.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c] ?? c}</option>)}</select></div>}
            <div className="field"><label className="label small" htmlFor={`file-${ownerType}`}>Fichier (PDF, PNG, JPEG, WebP — 10 Mo max)</label><input id={`file-${ownerType}`} ref={input} className="input" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={e => setFile(e.target.files?.[0] ?? null)} /></div>
            <button className="btn btn-primary" disabled={!file || up.isPending}>{up.isPending ? "Envoi…" : "Déposer"}</button>
          </form>)}
      </div>
    </section>
  );
}
