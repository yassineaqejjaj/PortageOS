"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { ErrorBox, Forbidden, isForbidden, nf } from "@/lib/ui";

type M = { id: string; title: string; dailyRate: string; vatRate: string; startDate: string; endDate: string | null; status: string; consultant: { firstName: string; lastName: string }; company: { name: string } };
const Schema = z.object({
  consultantId: z.string().uuid("Choisissez un consultant."), companyId: z.string().uuid("Choisissez un client."), title: z.string().min(1, "Intitulé requis."),
  dailyRate: z.string().regex(/^\d{1,10}([.,]\d{1,2})?$/, "Montant invalide."), vatRate: z.string().regex(/^\d{1,2}([.,]\d{1,2})?$/, "Taux invalide."),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date requise."), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")),
});
type V = z.infer<typeof Schema>;

export default function MissionsPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["missions"], queryFn: () => api<M[]>("missions") });
  const consultants = useQuery({ queryKey: ["consultants"], queryFn: () => api<{ id: string; firstName: string; lastName: string; status: string }[]>("consultants") });
  const companies = useQuery({ queryKey: ["companies"], queryFn: () => api<{ id: string; name: string }[]>("companies") });
  const { register, handleSubmit, reset, formState: { errors } } = useForm<V>({ resolver: zodResolver(Schema) });
  const create = useMutation({
    mutationFn: (v: V) => api("missions", { method: "POST", body: { consultantId: v.consultantId, companyId: v.companyId, title: v.title, dailyRate: v.dailyRate.replace(",", "."), vatRate: v.vatRate.replace(",", "."), startDate: v.startDate, ...(v.endDate ? { endDate: v.endDate } : {}) } }),
    onSuccess: () => { reset(); qc.invalidateQueries({ queryKey: ["missions"] }); },
  });
  if (isForbidden(list.error)) return <><h1>Missions</h1><Forbidden what="les missions" /></>;
  const active = consultants.data?.filter(c => c.status === "active") ?? [];
  const field = (k: keyof V, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => (
    <div className="field"><label className="label" htmlFor={k}>{label}</label><input id={k} className={`input${errors[k] ? " is-error" : ""}`} aria-invalid={!!errors[k]} {...props} {...register(k)} />
      {errors[k] ? <span className="err" role="alert">{errors[k]?.message}</span> : hint && <span className="hint">{hint}</span>}</div>
  );
  return (
    <>
      <h1>Missions</h1>
      <div className="split">
        <section className="card main" aria-labelledby="l">
          <div className="card-h"><h2 id="l">Missions</h2></div>
          {list.isLoading && <div className="card-b muted">Chargement…</div>}
          <ErrorBox error={list.error} prefix="Impossible de charger les missions" />
          {list.data?.length === 0 && <div className="empty"><h3>Aucune mission</h3><p className="muted">Un consultant actif et un client sont nécessaires.</p></div>}
          {!!list.data?.length && <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th scope="col">Mission</th><th scope="col">Consultant</th><th scope="col">Client</th><th scope="col" className="r">TJM HT</th><th scope="col">Début</th></tr></thead>
            <tbody>{list.data.map(m => <tr key={m.id}><td><b>{m.title}</b></td><td>{m.consultant.firstName} {m.consultant.lastName}</td><td>{m.company.name}</td><td className="r num">{nf(m.dailyRate)}</td><td className="num">{fmtDate(m.startDate)}</td></tr>)}</tbody></table></div>}
        </section>
        <form className="card side" onSubmit={handleSubmit(v => create.mutate(v))} noValidate aria-labelledby="n">
          <div className="card-h"><h2 id="n">Nouvelle mission</h2></div>
          <div className="card-b stack" style={{ gap: 16 }}>
            <div className="field"><label className="label" htmlFor="consultantId">Consultant (actif)</label>
              <select id="consultantId" className="input" {...register("consultantId")} defaultValue=""><option value="" disabled>Choisir…</option>{active.map(c => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}</select>
              {errors.consultantId && <span className="err" role="alert">{errors.consultantId.message}</span>}</div>
            <div className="field"><label className="label" htmlFor="companyId">Client</label>
              <select id="companyId" className="input" {...register("companyId")} defaultValue=""><option value="" disabled>Choisir…</option>{companies.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              {errors.companyId && <span className="err" role="alert">{errors.companyId.message}</span>}</div>
            {field("title", "Intitulé")}
            {field("dailyRate", "TJM HT (€)", { inputMode: "decimal" })}
            {field("vatRate", "Taux de TVA (%)", { inputMode: "decimal" }, "Saisi explicitement : aucun taux n’est présumé.")}
            {field("startDate", "Début", { type: "date" })}
            {field("endDate", "Fin (facultatif)", { type: "date" })}
            <ErrorBox error={create.error} prefix="Création impossible" />
          </div>
          <div className="card-f"><button className="btn btn-primary" disabled={create.isPending}>Créer la mission</button></div>
        </form>
      </div>
    </>
  );
}
