"use client";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorBox, Forbidden, isForbidden } from "@/lib/ui";

type C = { id: string; firstName: string; lastName: string; email: string | null; status: string; tasksDone: number; tasksTotal: number };
const Schema = z.object({ firstName: z.string().min(1, "Prénom requis."), lastName: z.string().min(1, "Nom requis."), email: z.string().email("Email invalide.").or(z.literal("")) });
type V = z.infer<typeof Schema>;
const STATUS: Record<string, string> = { onboarding: "Onboarding", active: "Actif", archived: "Archivé" };

export default function ConsultantsPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["consultants"], queryFn: () => api<C[]>("consultants") });
  const { register, handleSubmit, reset, formState: { errors } } = useForm<V>({ resolver: zodResolver(Schema) });
  const create = useMutation({
    mutationFn: (v: V) => api<C>("consultants", { method: "POST", body: { firstName: v.firstName, lastName: v.lastName, ...(v.email ? { email: v.email } : {}) } }),
    onSuccess: () => { reset(); qc.invalidateQueries({ queryKey: ["consultants"] }); },
  });
  if (isForbidden(list.error)) return <><h1>Consultants</h1><Forbidden what="les consultants" /></>;
  return (
    <>
      <h1>Consultants</h1>
      <div className="split">
        <section className="card main" aria-labelledby="l">
          <div className="card-h"><h2 id="l">Dossiers</h2></div>
          {list.isLoading && <div className="card-b muted">Chargement…</div>}
          <ErrorBox error={list.error} prefix="Impossible de charger les consultants" />
          {list.data?.length === 0 && <div className="empty"><h3>Aucun consultant</h3><p className="muted">Convertissez un prospect ou créez un dossier.</p></div>}
          {!!list.data?.length && <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th scope="col">Nom</th><th scope="col">Statut</th><th scope="col">Onboarding</th></tr></thead>
            <tbody>{list.data.map(c => <tr key={c.id}><td><Link href={`/consultants/${c.id}`}><b>{c.firstName} {c.lastName}</b></Link><div className="small muted">{c.email ?? "—"}</div></td>
              <td><span className={`badge ${c.status === "active" ? "b-success" : "b-warning"}`}>{STATUS[c.status] ?? c.status}</span></td>
              <td className="num">{c.tasksDone} / {c.tasksTotal}</td></tr>)}</tbody></table></div>}
        </section>
        <form className="card side" onSubmit={handleSubmit(v => create.mutate(v))} noValidate aria-labelledby="n">
          <div className="card-h"><h2 id="n">Nouveau dossier</h2></div>
          <div className="card-b stack" style={{ gap: 16 }}>
            {(["firstName", "lastName", "email"] as const).map(k => (
              <div className="field" key={k}><label className="label" htmlFor={k}>{k === "firstName" ? "Prénom" : k === "lastName" ? "Nom" : "Email"}</label>
                <input id={k} className={`input${errors[k] ? " is-error" : ""}`} type={k === "email" ? "email" : "text"} aria-invalid={!!errors[k]} {...register(k)} />
                {errors[k] && <span className="err" role="alert">{errors[k]?.message}</span>}</div>))}
            <ErrorBox error={create.error} prefix="Création impossible" />
          </div>
          <div className="card-f"><button className="btn btn-primary" disabled={create.isPending}>Créer le dossier</button></div>
        </form>
      </div>
    </>
  );
}
