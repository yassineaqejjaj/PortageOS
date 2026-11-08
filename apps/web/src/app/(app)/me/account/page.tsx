"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorBox } from "@/lib/ui";
import { Statement, StatementView } from "@/lib/account";

export default function MyAccountPage() {
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const q = useQuery({ queryKey: ["me-account", period], queryFn: () => api<Statement>(`me/account?period=${period}`), enabled: /^\d{4}-\d{2}$/.test(period) });
  return (<><h1>Mon compte d’activité</h1>
    <div className="field" style={{ maxWidth: 220 }}><label className="label" htmlFor="p">Mois</label><input id="p" className="input" type="month" value={period} onChange={e => setPeriod(e.target.value)} /></div>
    <ErrorBox error={q.error} prefix="Erreur" />{q.data && <StatementView s={q.data} />}</>);
}
