"use client";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { Badge, ErrorBox, Forbidden, INV_STATUS, dayFmt, isForbidden, nf } from "@/lib/ui";

type Inv = { id: string; number: string | null; status: string; days: string; unitPrice: string; vatRate: string; net: string; vat: string; gross: string; paid: string; issueDate: string | null; einvoiceStatus: string };
type T = { id: string; period: string; status: string; missionTitle: string; consultantName: string; totalDays: string };

export default function InvoicesPage() {
  const qc = useQueryClient();
  const [paying, setPaying] = useState<string | null>(null);
  const [crediting, setCrediting] = useState<string | null>(null); const [reason, setReason] = useState("");
  const [amount, setAmount] = useState(""); const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const invs = useQuery({ queryKey: ["invoices"], queryFn: () => api<Inv[]>("invoices") });
  const ready = useQuery({ queryKey: ["timesheets", "validated"], queryFn: () => api<T[]>("timesheets?status=validated"), retry: false });
  const refresh = () => { for (const k of ["invoices", "timesheets", "ledger"]) qc.invalidateQueries({ queryKey: [k] }); };
  const create = useMutation({ mutationFn: (timesheetId: string) => api("invoices", { method: "POST", body: { timesheetId } }), onSuccess: refresh });
  const issue = useMutation({ mutationFn: (id: string) => api(`invoices/${id}/issue`, { method: "POST" }), onSuccess: refresh });
  const cancel = useMutation({ mutationFn: (id: string) => api(`invoices/${id}/cancel`, { method: "POST" }), onSuccess: refresh });
  const credit = useMutation({ mutationFn: (a: { id: string; reason: string }) => api(`invoices/${a.id}/credit`, { method: "POST", body: { reason: a.reason } }), onSuccess: () => { setCrediting(null); setReason(""); refresh(); } });
  const pay = useMutation({ mutationFn: (id: string) => api(`invoices/${id}/payments`, { method: "POST", body: { amount: amount.replace(",", "."), receivedOn: date } }), onSuccess: () => { setPaying(null); setAmount(""); refresh(); } });
  if (isForbidden(invs.error)) return <><h1>Facturation</h1><Forbidden what="la facturation" /></>;
  const err = invs.error ?? create.error ?? issue.error ?? cancel.error ?? pay.error ?? credit.error;
  return (
    <>
      <h1>Facturation</h1>
      <div className="alert a-info" role="note"><span>La transmission à une plateforme agréée (facturation électronique) n’est <b>pas connectée</b> : les factures sont émises et numérotées en interne uniquement.</span></div>
      {!!ready.data?.length && (
        <section className="card" aria-labelledby="r"><div className="card-h"><h2 id="r">CRA validés à facturer</h2><span className="count">{ready.data.length}</span></div>
          <div className="tbl-wrap"><table className="tbl compact"><tbody>{ready.data.map(t => <tr key={t.id}><td className="num">{t.period}</td><td>{t.consultantName} — {t.missionTitle}</td><td className="num">{dayFmt(t.totalDays)} j</td>
            <td className="r"><button className="btn btn-secondary btn-sm" disabled={create.isPending} onClick={() => create.mutate(t.id)}>Préparer la facture</button></td></tr>)}</tbody></table></div></section>
      )}
      <section className="card" aria-labelledby="f">
        <div className="card-h"><h2 id="f">Factures</h2></div>
        {invs.isLoading && <div className="card-b muted">Chargement…</div>}
        <ErrorBox error={err} prefix="Erreur" />
        {invs.data?.length === 0 && <div className="empty"><h3>Aucune facture</h3><p className="muted">Une facture se prépare à partir d’un CRA validé.</p></div>}
        {!!invs.data?.length && <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th scope="col">N°</th><th scope="col">Date</th><th scope="col" className="r">HT</th><th scope="col" className="r">TVA</th><th scope="col" className="r">TTC</th><th scope="col" className="r">Encaissé</th><th scope="col">Statut</th><th scope="col">Actions</th></tr></thead>
          <tbody>{invs.data.map(i => (
            <tr key={i.id}><td className="mono"><Link href={`/invoices/${i.id}`}>{i.number ?? "Brouillon"}</Link></td><td className="num">{i.issueDate ? fmtDate(i.issueDate) : "—"}</td>
              <td className="r num">{nf(i.net)}</td><td className="r num">{nf(i.vat)} <span className="muted small">({dayFmt(i.vatRate)} %)</span></td><td className="r num"><b>{nf(i.gross)}</b></td><td className="r num">{nf(i.paid)}</td>
              <td><Badge map={INV_STATUS} value={i.status} /></td>
              <td>
                <div className="row" style={{ gap: 6 }}>
                  {i.status === "draft" && <button className="btn btn-primary btn-sm" disabled={issue.isPending} onClick={() => issue.mutate(i.id)}>Émettre</button>}
                  {(i.status === "issued" || i.status === "partially_paid") && <button className="btn btn-secondary btn-sm" onClick={() => { setPaying(i.id); setAmount((Number(i.gross) - Number(i.paid)).toFixed(2)); }}>Saisir un encaissement</button>}
                  {i.status === "issued" && <button className="btn btn-ghost btn-sm" disabled={cancel.isPending} onClick={() => cancel.mutate(i.id)}>Annuler</button>}
                  {["issued", "partially_paid", "paid"].includes(i.status) && <button className="btn btn-ghost btn-sm" onClick={() => { setCrediting(i.id); setReason(""); }}>Émettre un avoir</button>}
                </div>
                {crediting === i.id && (
                  <form className="row" style={{ marginTop: 8, gap: 6 }} onSubmit={e => { e.preventDefault(); credit.mutate({ id: i.id, reason }); }}>
                    <label className="label" htmlFor={`c-${i.id}`} style={{ position: "absolute", left: -999 }}>Motif de l’avoir</label>
                    <input id={`c-${i.id}`} className="input" style={{ width: 240 }} placeholder="Motif de l’avoir (obligatoire)" value={reason} onChange={e => setReason(e.target.value)} required minLength={5} />
                    <button className="btn btn-danger btn-sm" disabled={credit.isPending || reason.trim().length < 5}>Émettre l’avoir total</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCrediting(null)}>Annuler</button>
                  </form>)}
                {paying === i.id && (
                  <form className="row" style={{ marginTop: 8, gap: 6 }} onSubmit={e => { e.preventDefault(); pay.mutate(i.id); }}>
                    <label className="label" htmlFor={`a-${i.id}`} style={{ position: "absolute", left: -999 }}>Montant encaissé</label>
                    <input id={`a-${i.id}`} className="input num" style={{ width: 110 }} value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" required />
                    <label className="label" htmlFor={`d-${i.id}`} style={{ position: "absolute", left: -999 }}>Date de réception</label>
                    <input id={`d-${i.id}`} className="input" style={{ width: 150 }} type="date" value={date} onChange={e => setDate(e.target.value)} required />
                    <button className="btn btn-primary btn-sm" disabled={pay.isPending}>Enregistrer</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPaying(null)}>Annuler</button>
                  </form>)}
              </td></tr>))}</tbody></table></div>}
      </section>
    </>
  );
}
