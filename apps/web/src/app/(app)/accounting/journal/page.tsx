"use client";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { ErrorBox, Forbidden, isForbidden, nf } from "@/lib/ui";

type E = { id: string; valueDate: string; label: string; journal: string; sourceType: string; reversalOf: string | null; reason: string | null; lines: { account: string; debit: string; credit: string }[] };
type L = { account: string; debit: string; credit: string };
const month = () => new Date().toISOString().slice(0, 7);

export default function JournalPage() {
  const qc = useQueryClient();
  const [from, setFrom] = useState(month()); const [to, setTo] = useState(month());
  const [f, setF] = useState({ valueDate: new Date().toISOString().slice(0, 10), label: "", reason: "", lines: [{ account: "", debit: "", credit: "" }, { account: "", debit: "", credit: "" }] as L[] });
  const [rev, setRev] = useState<string | null>(null); const [revReason, setRevReason] = useState("");
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ permissions: string[] }>("me") });
  const q = useQuery({ queryKey: ["entries", from, to], queryFn: () => api<E[]>(`accounting/entries?from=${from}&to=${to}`) });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api<{ code: string; label: string; active: boolean }[]>("accounting/accounts") });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["entries"] }); qc.invalidateQueries({ queryKey: ["dossier"] }); };
  const create = useMutation({ mutationFn: () => api("accounting/entries", { method: "POST", body: { valueDate: f.valueDate, label: f.label, reason: f.reason, lines: f.lines.filter(l => l.account).map(l => ({ account: l.account, ...(l.debit ? { debit: l.debit.replace(",", ".") } : {}), ...(l.credit ? { credit: l.credit.replace(",", ".") } : {}) })) } }), onSuccess: () => { setF({ ...f, label: "", reason: "", lines: [{ account: "", debit: "", credit: "" }, { account: "", debit: "", credit: "" }] }); refresh(); } });
  const reverse = useMutation({ mutationFn: (id: string) => api(`accounting/entries/${id}/reverse`, { method: "POST", body: { reason: revReason } }), onSuccess: () => { setRev(null); setRevReason(""); refresh(); } });
  if (isForbidden(q.error)) return <><h1>Journal</h1><Forbidden what="le journal" /></>;
  const canWrite = me.data?.permissions.includes("accounting.write");
  const td = f.lines.reduce((s, l) => s + Number((l.debit || "0").replace(",", ".")), 0), tc = f.lines.reduce((s, l) => s + Number((l.credit || "0").replace(",", ".")), 0);
  const setLine = (i: number, k: keyof L, v: string) => setF({ ...f, lines: f.lines.map((l, j) => j === i ? { ...l, [k]: v } : l) });
  return (
    <>
      <p><Link href="/accounting">← Comptabilité</Link></p><h1>Journal et écritures</h1>
      <ErrorBox error={q.error ?? create.error ?? reverse.error} prefix="Erreur" />
      <div className="split">
        <section className="card main" aria-labelledby="j"><div className="card-h"><h2 id="j">Écritures</h2>
          <div className="row" style={{ gap: 8 }}><div className="field"><label className="label small" htmlFor="f">Du</label><input id="f" className="input" type="month" value={from} onChange={e => setFrom(e.target.value)} /></div><div className="field"><label className="label small" htmlFor="t">Au</label><input id="t" className="input" type="month" value={to} onChange={e => setTo(e.target.value)} /></div></div></div>
          {q.data?.length === 0 && <div className="empty"><h3>Aucune écriture sur la période</h3></div>}
          {q.data?.map(e => (
            <div key={e.id} className="card-b stack" style={{ borderBottom: "1px solid var(--color-border-default)", gap: 6 }}>
              <div className="row between"><div><span className="tag">{e.journal}</span> <b>{e.label}</b> <span className="muted small">· {fmtDate(e.valueDate)}{e.reversalOf ? " · contrepassation" : ""}</span></div>
                {canWrite && e.sourceType === "manual" && !e.reversalOf && <button className="btn btn-ghost btn-sm" onClick={() => { setRev(e.id); setRevReason(""); }}>Contrepasser</button>}</div>
              {e.reason && <div className="small muted">Motif : {e.reason}</div>}
              <table className="tbl compact"><tbody>{e.lines.map((l, i) => <tr key={i}><td className="mono">{l.account}</td><td className="r num">{l.debit !== "0.00" ? nf(l.debit) : ""}</td><td className="r num">{l.credit !== "0.00" ? nf(l.credit) : ""}</td></tr>)}</tbody></table>
              {rev === e.id && <form className="row" style={{ gap: 6 }} onSubmit={ev => { ev.preventDefault(); reverse.mutate(e.id); }}><label className="label" htmlFor={`r-${e.id}`} style={{ position: "absolute", left: -999 }}>Motif</label><input id={`r-${e.id}`} className="input" style={{ width: 240 }} placeholder="Motif (obligatoire)" value={revReason} onChange={x => setRevReason(x.target.value)} required minLength={5} /><button className="btn btn-danger btn-sm" disabled={reverse.isPending || revReason.trim().length < 5}>Confirmer la contrepassation</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setRev(null)}>Annuler</button></form>}
            </div>))}
        </section>
        {canWrite && <form className="card side" onSubmit={e => { e.preventDefault(); create.mutate(); }} aria-labelledby="n"><div className="card-h"><h2 id="n">Écriture manuelle (ajustement)</h2></div>
          <div className="card-b stack" style={{ gap: 12 }}>
            <p className="hint">Réservée à la finance. L’écriture doit être équilibrée, datée dans une période ouverte et motivée ; elle ne se corrige que par contrepassation.</p>
            <div className="field"><label className="label" htmlFor="vd">Date de valeur</label><input id="vd" className="input" type="date" value={f.valueDate} onChange={e => setF({ ...f, valueDate: e.target.value })} required /></div>
            <div className="field"><label className="label" htmlFor="lb">Libellé</label><input id="lb" className="input" value={f.label} onChange={e => setF({ ...f, label: e.target.value })} required minLength={3} /></div>
            <div className="field"><label className="label" htmlFor="rs">Motif</label><input id="rs" className="input" value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} required minLength={5} /></div>
            {f.lines.map((l, i) => <div key={i} className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
              <div className="field" style={{ flex: 2 }}><label className="label small" htmlFor={`a${i}`}>Compte {i + 1}</label><select id={`a${i}`} className="input" value={l.account} onChange={e => setLine(i, "account", e.target.value)}><option value="">—</option>{accounts.data?.filter(a => a.active).map(a => <option key={a.code} value={a.code}>{a.code} {a.label}</option>)}</select></div>
              <div className="field" style={{ flex: 1 }}><label className="label small" htmlFor={`d${i}`}>Débit</label><input id={`d${i}`} className="input" inputMode="decimal" value={l.debit} onChange={e => setLine(i, "debit", e.target.value)} /></div>
              <div className="field" style={{ flex: 1 }}><label className="label small" htmlFor={`c${i}`}>Crédit</label><input id={`c${i}`} className="input" inputMode="decimal" value={l.credit} onChange={e => setLine(i, "credit", e.target.value)} /></div></div>)}
            <div className="row between"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setF({ ...f, lines: [...f.lines, { account: "", debit: "", credit: "" }] })}>Ajouter une ligne</button><span className={`small ${td === tc && td > 0 ? "" : "muted"}`} aria-live="polite">Débit {nf(td)} · Crédit {nf(tc)} {td === tc && td > 0 ? "· équilibrée" : "· non équilibrée"}</span></div>
          </div><div className="card-f"><button className="btn btn-primary" disabled={create.isPending || td !== tc || td === 0}>Enregistrer l’écriture</button></div></form>}
      </div>
    </>
  );
}
