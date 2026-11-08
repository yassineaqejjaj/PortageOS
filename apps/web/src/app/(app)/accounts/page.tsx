"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorBox, Forbidden, isForbidden } from "@/lib/ui";
import { Statement, StatementView } from "@/lib/account";

export default function AccountsPage() {
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7)); const [cid, setCid] = useState("");
  const cons = useQuery({ queryKey: ["consultants"], queryFn: () => api<{ id: string; firstName: string; lastName: string }[]>("consultants"), retry: false });
  const q = useQuery({ queryKey: ["account", cid, period], queryFn: () => api<Statement>(`accounts/${cid}?period=${period}`), enabled: !!cid && /^\d{4}-\d{2}$/.test(period) });
  if (isForbidden(q.error)) return <><h1>Comptes d’activité</h1><Forbidden what="les comptes d’activité" /></>;
  return (<><h1>Comptes d’activité</h1>
    <div className="row">
      <div className="field" style={{ minWidth: 260 }}><label className="label" htmlFor="c">Consultant</label><select id="c" className="input" value={cid} onChange={e => setCid(e.target.value)}><option value="">Choisir…</option>{cons.data?.map(c => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}</select></div>
      <div className="field"><label className="label" htmlFor="p">Mois</label><input id="p" className="input" type="month" value={period} onChange={e => setPeriod(e.target.value)} /></div>
    </div>
    <ErrorBox error={q.error} prefix="Erreur" />{q.data && <StatementView s={q.data} />}</>);
}
