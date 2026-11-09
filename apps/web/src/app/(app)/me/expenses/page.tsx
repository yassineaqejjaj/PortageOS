"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorBox, nf, EXP_STATUS, type Claim } from "@/lib/ui";
import { uploadDocument } from "@/lib/documents";
import { downloadFile } from "@/lib/download";

type L = { date: string; category: string; description: string; amount: string; km: string; receiptRef: string };
const empty: L = { date: new Date().toISOString().slice(0, 10), category: "meal", description: "", amount: "", km: "", receiptRef: "" };

export default function MyExpensesPage() {
  const qc = useQueryClient();
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [title, setTitle] = useState(""); const [open, setOpen] = useState<string | null>(null); const [line, setLine] = useState<L>(empty);
  const q = useQuery({ queryKey: ["me-expenses"], queryFn: () => api<Claim[]>("me/expenses") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["me-expenses"] });
  const create = useMutation({ mutationFn: () => api<Claim>("me/expenses", { method: "POST", body: { title } }), onSuccess: c => { setTitle(""); setOpen(c.id); refresh(); } });
  const save = useMutation({ mutationFn: async (a0: { c: Claim; add?: L }) => { const a = { ...a0 }; if (a.add && a.add.category !== "mileage" && receiptFile) { const d = await uploadDocument(receiptFile, "expense_claim", a.c.id, "receipt"); a.add = { ...a.add, receiptRef: `doc:${d.id}` }; } return api(`me/expenses/${a.c.id}/lines`, { method: "PUT", body: { lines: [
    ...a.c.lines.map(l => ({ date: l.date, category: l.category, description: l.description, ...(l.category === "mileage" ? { km: l.km! } : { amount: l.amount }), ...(l.receiptRef ? { receiptRef: l.receiptRef } : {}) })),
    ...(a.add ? [{ date: a.add.date, category: a.add.category, description: a.add.description, ...(a.add.category === "mileage" ? { km: a.add.km } : { amount: a.add.amount.replace(",", ".") }), ...(a.add.receiptRef ? { receiptRef: a.add.receiptRef } : {}) }] : [])] } }); }, onSuccess: () => { setLine(empty); setReceiptFile(null); refresh(); } });
  const move = useMutation({ mutationFn: (a: { id: string; event: string }) => api(`me/expenses/${a.id}/transition`, { method: "POST", body: { event: a.event } }), onSuccess: refresh });
  return (
    <>
      <h1>Mes notes de frais</h1>
      <ErrorBox error={q.error ?? create.error ?? save.error ?? move.error} prefix="Erreur" />
      <form className="card" onSubmit={e => { e.preventDefault(); create.mutate(); }}><div className="card-b row"><div className="field" style={{ flex: 1, minWidth: 220 }}><label className="label" htmlFor="t">Nouvelle note de frais</label><input id="t" className="input" placeholder="Ex. Déplacements octobre" value={title} onChange={e => setTitle(e.target.value)} required /></div><button className="btn btn-primary" disabled={create.isPending || !title.trim()}>Créer</button></div></form>
      {q.data?.map(c => (
        <section key={c.id} className="card" aria-label={c.title}>
          <div className="card-h"><h2>{c.title} — {nf(c.total)}</h2><span className={`badge ${EXP_STATUS[c.status]?.cls}`}>{EXP_STATUS[c.status]?.label}</span></div>
          {c.rejectReason && <div className="card-b"><div className="alert a-danger"><span>Refusée : {c.rejectReason}</span></div></div>}
          {!!c.lines.length && <div className="tbl-wrap"><table className="tbl compact"><tbody>{c.lines.map(l => <tr key={l.id}><td className="num">{l.date}</td><td>{l.category}{l.km && ` (${l.km} km)`}</td><td>{l.description}{l.policyFlag && <div className="small" style={{ color: "var(--color-status-warning)" }}>⚠ {l.policyFlag}</div>}</td><td className="mono">{l.receiptRef?.startsWith("doc:") ? <button className="btn btn-ghost btn-sm" onClick={() => downloadFile(`/api/documents/${l.receiptRef!.slice(4)}/download`, "justificatif")}>Justificatif</button> : (l.receiptRef ?? "sans justificatif")}</td><td className="r num">{nf(l.amount)}</td></tr>)}</tbody></table></div>}
          {c.status === "draft" && open === c.id && (
            <form className="card-b stack" onSubmit={e => { e.preventDefault(); save.mutate({ c, add: line }); }}>
              <div className="row">
                <div className="field"><label className="label" htmlFor="d">Date</label><input id="d" className="input" type="date" value={line.date} onChange={e => setLine({ ...line, date: e.target.value })} required /></div>
                <div className="field"><label className="label" htmlFor="k">Nature</label><select id="k" className="input" value={line.category} onChange={e => setLine({ ...line, category: e.target.value })}><option value="meal">Repas</option><option value="transport">Transport</option><option value="hotel">Hôtel</option><option value="mileage">Kilométrage</option><option value="other">Autre</option></select></div>
                <div className="field" style={{ flex: 1, minWidth: 160 }}><label className="label" htmlFor="ds">Description</label><input id="ds" className="input" value={line.description} onChange={e => setLine({ ...line, description: e.target.value })} required /></div>
                {line.category === "mileage"
                  ? <div className="field"><label className="label" htmlFor="km">Kilomètres</label><input id="km" className="input" inputMode="decimal" value={line.km} onChange={e => setLine({ ...line, km: e.target.value })} required /><span className="hint">Montant calculé selon le barème paramétré.</span></div>
                  : <><div className="field"><label className="label" htmlFor="am">Montant TTC (€)</label><input id="am" className="input" inputMode="decimal" value={line.amount} onChange={e => setLine({ ...line, amount: e.target.value })} required /></div>
                    <div className="field"><label className="label" htmlFor="rf">Justificatif (PDF, PNG, JPEG, WebP — 10 Mo max)</label><input id="rf" className="input" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={e => setReceiptFile(e.target.files?.[0] ?? null)} /><span className="hint">Ou saisissez une référence :</span><input id="rc" aria-label="Référence du justificatif" className="input" value={line.receiptRef} onChange={e => setLine({ ...line, receiptRef: e.target.value })} /></div></>}
              </div>
              <div><button className="btn btn-secondary" disabled={save.isPending}>Ajouter la ligne</button></div>
            </form>)}
          <div className="card-f">
            {c.status === "draft" && <button className="btn btn-ghost" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? "Fermer la saisie" : "Ajouter des lignes"}</button>}
            {c.status === "draft" && <button className="btn btn-primary" disabled={move.isPending} onClick={() => move.mutate({ id: c.id, event: "submit" })}>Soumettre {nf(c.total)}</button>}
            {c.status === "submitted" && <button className="btn btn-ghost" onClick={() => move.mutate({ id: c.id, event: "recall" })}>Rappeler</button>}
            {c.status === "rejected" && <button className="btn btn-secondary" onClick={() => move.mutate({ id: c.id, event: "reopen" })}>Rouvrir pour corriger</button>}
          </div>
        </section>))}
    </>
  );
}
