"use client";
import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { downloadFile } from "@/lib/download";
import { fmtDate, fmtEUR } from "@/lib/format";
import { Badge, ErrorBox, Forbidden, INV_STATUS, isForbidden } from "@/lib/ui";

type Line = { id: string; position: number; kind: string; description: string; unit: string; quantity: string; unitPrice: string; vatRate: string; net: string; vat: string; gross: string };
type Inv = { id: string; number: string | null; status: string; issueDate: string | null; net: string; vat: string; gross: string; paid: string; lines: Line[] };

export default function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const qc = useQueryClient();
  const inv = useQuery({ queryKey: ["invoice", id], queryFn: () => api<Inv>(`invoices/${id}`) });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ permissions: string[] }>("me") });
  const canWrite = !!me.data?.permissions.includes("invoice.write");
  const refresh = () => { qc.invalidateQueries({ queryKey: ["invoice", id] }); qc.invalidateQueries({ queryKey: ["invoices"] }); };
  const [f, setF] = useState({ description: "", quantity: "1", unit: "unité", unitPrice: "", vatRate: "" });
  const add = useMutation({ mutationFn: () => api(`invoices/${id}/lines`, { method: "POST", body: f }), onSuccess: () => { setF({ ...f, description: "", unitPrice: "" }); refresh(); } });
  const del = useMutation({ mutationFn: (lid: string) => api(`invoices/${id}/lines/${lid}`, { method: "DELETE" }), onSuccess: refresh });
  const [pdfErr, setPdfErr] = useState<string | null>(null);
  if (isForbidden(inv.error)) return <><h1>Facture</h1><Forbidden what="cette facture" /></>;
  if (!inv.data) return <><h1>Facture</h1><ErrorBox error={inv.error} prefix="Chargement impossible" />{inv.isLoading && <p>Chargement…</p>}</>;
  const x = inv.data; const draft = x.status === "draft";
  return (
    <>
      <p className="small"><Link href="/invoices">← Facturation</Link></p>
      <div className="row between"><h1>{x.number ?? "Facture (brouillon)"}</h1>
        <div className="row"><Badge map={INV_STATUS} value={x.status} />
          <button className="btn btn-secondary" onClick={async () => setPdfErr(await downloadFile(`/api/invoices/${id}/pdf`, "facture.pdf"))}>Télécharger le PDF</button></div></div>
      {pdfErr && <div className="alert a-danger" role="alert"><span>{pdfErr}</span></div>}
      <div className="alert a-info" role="note"><span>Le PDF est un document de travail : aucune plateforme de facturation électronique agréée n'est connectée. Les mentions du vendeur se renseignent dans « Identité de la société ».</span></div>
      <section className="card" aria-labelledby="lg">
        <div className="card-h"><h2 id="lg">Lignes</h2>{x.issueDate && <span className="small muted">Émise le {fmtDate(x.issueDate)}</span>}</div>
        <div className="tbl-wrap"><table className="tbl compact">
          <thead><tr><th scope="col">Désignation</th><th scope="col">Qté</th><th scope="col">PU HT</th><th scope="col">TVA</th><th scope="col">Total HT</th><th scope="col">TTC</th>{draft && canWrite && <th scope="col">Actions</th>}</tr></thead>
          <tbody>{x.lines.map(l => <tr key={l.id}><td>{l.description}<div className="small muted">{l.kind === "activity" ? "Activité (CRA)" : "Ligne ajoutée"}</div></td>
            <td className="num">{Number(l.quantity)} {l.unit}</td><td className="num">{fmtEUR(l.unitPrice)}</td><td className="num">{Number(l.vatRate)} %</td><td className="num">{fmtEUR(l.net)}</td><td className="num">{fmtEUR(l.gross)}</td>
            {draft && canWrite && <td>{l.kind === "extra" && <button className="btn btn-ghost btn-sm" disabled={del.isPending} onClick={() => del.mutate(l.id)} aria-label={`Retirer la ligne ${l.description}`}>Retirer</button>}</td>}</tr>)}</tbody>
          <tfoot><tr><th scope="row" colSpan={4}>Totaux (somme des lignes)</th><td className="num">{fmtEUR(x.net)}</td><td className="num"><b>{fmtEUR(x.gross)}</b></td>{draft && canWrite && <td />}</tr>
            <tr><td colSpan={4} className="small muted">dont TVA</td><td colSpan={2} className="num small">{fmtEUR(x.vat)}</td>{draft && canWrite && <td />}</tr></tfoot></table></div>
        <ErrorBox error={del.error} prefix="Opération impossible" />
      </section>
      {draft && canWrite && <form className="card" aria-labelledby="al" onSubmit={e => { e.preventDefault(); add.mutate(); }} style={{ marginTop: 16 }}>
        <div className="card-h"><h2 id="al">Ajouter une ligne</h2></div>
        <div className="card-b row" style={{ gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field"><label className="label" htmlFor="ld">Désignation</label><input id="ld" className="input" style={{ width: 280 }} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} minLength={2} required /></div>
          <div className="field"><label className="label" htmlFor="lq">Quantité</label><input id="lq" inputMode="decimal" className="input" style={{ width: 90 }} value={f.quantity} onChange={e => setF({ ...f, quantity: e.target.value })} required /></div>
          <div className="field"><label className="label" htmlFor="lu">Unité</label><input id="lu" className="input" style={{ width: 100 }} value={f.unit} onChange={e => setF({ ...f, unit: e.target.value })} required /></div>
          <div className="field"><label className="label" htmlFor="lp">Prix unitaire HT (€)</label><input id="lp" inputMode="decimal" className="input" style={{ width: 130 }} value={f.unitPrice} onChange={e => setF({ ...f, unitPrice: e.target.value })} required /></div>
          <div className="field"><label className="label" htmlFor="lv">TVA (%)</label><input id="lv" inputMode="decimal" className="input" style={{ width: 90 }} value={f.vatRate} onChange={e => setF({ ...f, vatRate: e.target.value })} required /><span className="hint">Saisi : aucun taux n'est imposé.</span></div>
          <button className="btn btn-secondary" type="submit" disabled={add.isPending}>Ajouter la ligne</button></div>
        <ErrorBox error={add.error} prefix="Ajout impossible" />
      </form>}
    </>
  );
}
