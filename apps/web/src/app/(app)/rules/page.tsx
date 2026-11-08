"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { ErrorBox, Forbidden, isForbidden } from "@/lib/ui";

type P = { id: string; key: string; value: string; unit: string; validFrom: string; validTo: string | null; source: string; status: string; createdBy: string; approvedBy: string | null };
const Schema = z.object({ key: z.string().regex(/^[a-z0-9_.]{3,80}$/, "Clé : a-z, 0-9, _ ou ."), value: z.string().min(1, "Valeur requise."), unit: z.string().min(1, "Unité requise."),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date requise."), validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")), source: z.string().min(10, "Source officielle obligatoire (10 caractères min.).") });
type V = z.infer<typeof Schema>;

export default function RulesPage() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ userId: string; permissions: string[] }>("me") });
  const list = useQuery({ queryKey: ["rules"], queryFn: () => api<P[]>("rules/parameters") });
  const { register, handleSubmit, reset, formState: { errors } } = useForm<V>({ resolver: zodResolver(Schema) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["rules"] });
  const create = useMutation({ mutationFn: (v: V) => api("rules/parameters", { method: "POST", body: { ...v, validTo: v.validTo || undefined } }), onSuccess: () => { reset(); refresh(); } });
  const approve = useMutation({ mutationFn: (id: string) => api(`rules/parameters/${id}/approve`, { method: "POST" }), onSuccess: refresh });
  if (isForbidden(list.error)) return <><h1>Paramètres réglementaires</h1><Forbidden what="les paramètres" /></>;
  const canWrite = me.data?.permissions.includes("rules.write"), canApprove = me.data?.permissions.includes("rules.approve");
  const f = (k: keyof V, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => (
    <div className="field"><label className="label" htmlFor={k}>{label}</label><input id={k} className={`input${errors[k] ? " is-error" : ""}`} aria-invalid={!!errors[k]} {...props} {...register(k)} />
      {errors[k] ? <span className="err" role="alert">{errors[k]?.message}</span> : hint && <span className="hint">{hint}</span>}</div>);
  return (
    <>
      <h1>Paramètres réglementaires</h1>
      <div className="alert a-info" role="note"><span>Aucune valeur légale n’est fournie par la plateforme. Chaque valeur est saisie avec sa source officielle, sa période d’effet, puis <b>approuvée par une autre personne</b> (quatre yeux). Une version approuvée est immuable.</span></div>
      <div className="split">
        <section className="card main" aria-labelledby="l"><div className="card-h"><h2 id="l">Versions</h2></div>
          {list.isLoading && <div className="card-b muted">Chargement…</div>}
          <ErrorBox error={list.error ?? approve.error} prefix="Erreur" />
          {list.data?.length === 0 && <div className="empty"><h3>Aucun paramètre</h3><p className="muted">Les calculs qui en dépendent (kilométrage, frais de gestion) sont refusés tant qu’aucune valeur approuvée n’existe.</p></div>}
          {!!list.data?.length && <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th scope="col">Clé</th><th scope="col">Valeur</th><th scope="col">Période</th><th scope="col">Source</th><th scope="col">Statut</th></tr></thead>
            <tbody>{list.data.map(p => <tr key={p.id}><td className="mono">{p.key}</td><td className="num">{p.value} <span className="muted small">{p.unit}</span></td><td className="num">{fmtDate(p.validFrom)} → {p.validTo ? fmtDate(p.validTo) : "…"}</td><td className="small">{p.source}</td>
              <td>{p.status === "approved" ? <span className="badge b-success">Approuvé</span> : <span className="badge b-warning">Brouillon</span>}
                {p.status === "draft" && canApprove && <div style={{ marginTop: 4 }}>{p.createdBy === me.data?.userId ? <span className="small muted">Auteur : approbation par un tiers requise</span> : <button className="btn btn-primary btn-sm" disabled={approve.isPending} onClick={() => approve.mutate(p.id)}>Approuver</button>}</div>}</td></tr>)}</tbody></table></div>}
        </section>
        {canWrite && <form className="card side" onSubmit={handleSubmit(v => create.mutate(v))} noValidate aria-labelledby="n"><div className="card-h"><h2 id="n">Nouvelle version (brouillon)</h2></div>
          <div className="card-b stack" style={{ gap: 16 }}>
            {f("key", "Clé", {}, "Ex. expense.mileage_rate_eur_per_km, management_fee_rate_percent")}{f("value", "Valeur", { inputMode: "decimal" })}{f("unit", "Unité")}
            {f("validFrom", "Valable à partir du", { type: "date" })}{f("validTo", "Jusqu’au (facultatif)", { type: "date" })}{f("source", "Source officielle", {}, "Référence ou URL du texte")}
            <ErrorBox error={create.error} prefix="Création impossible" /></div>
          <div className="card-f"><button className="btn btn-primary" disabled={create.isPending}>Enregistrer le brouillon</button></div></form>}
      </div>
    </>
  );
}
