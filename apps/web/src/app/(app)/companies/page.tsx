"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { fmtDate } from "@/lib/format";

type Company = { id: string; name: string; siren: string | null; createdAt: string };
const Schema = z.object({ name: z.string().min(1, "Indiquez le nom du client.").max(200), siren: z.string().regex(/^\d{9}$/, "Le SIREN comporte 9 chiffres.").or(z.literal("")) });
type V = z.infer<typeof Schema>;

export default function CompaniesPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["companies"], queryFn: () => api<Company[]>("companies") });
  const { register, handleSubmit, reset, formState: { errors } } = useForm<V>({ resolver: zodResolver(Schema) });
  const create = useMutation({
    mutationFn: (v: V) => api<Company>("companies", { method: "POST", body: { name: v.name, ...(v.siren ? { siren: v.siren } : {}) } }),
    onSuccess: () => { reset(); qc.invalidateQueries({ queryKey: ["companies"] }); },
  });
  const forbidden = list.error instanceof ApiError && list.error.status === 403;
  return (
    <>
      <div className="row between"><h1>Clients</h1></div>
      {forbidden && <div className="alert a-warning" role="alert"><span>Accès refusé : votre rôle ne permet pas de consulter les clients. Contactez un administrateur de votre société.</span></div>}
      {!forbidden && (
        <div className="split">
          <section className="card main" aria-labelledby="liste">
            <div className="card-h"><h2 id="liste">Entreprises clientes</h2>{list.data && <span className="count" aria-label={`${list.data.length} clients`}>{list.data.length}</span>}</div>
            {list.isLoading && <div className="card-b muted" aria-live="polite">Chargement des clients…</div>}
            {list.error && <div className="card-b"><div className="alert a-danger" role="alert"><span>Impossible de charger les clients : {(list.error as Error).message}</span></div></div>}
            {list.data && list.data.length === 0 && (
              <div className="empty"><h3>Aucun client pour le moment</h3><p className="muted">Créez votre premier client avec le formulaire ci-contre.</p></div>
            )}
            {list.data && list.data.length > 0 && (
              <div className="tbl-wrap"><table className="tbl compact">
                <thead><tr><th scope="col">Nom</th><th scope="col">SIREN</th><th scope="col">Créé le</th></tr></thead>
                <tbody>{list.data.map(c => (<tr key={c.id}><td><b>{c.name}</b></td><td className="mono">{c.siren ?? "—"}</td><td className="num">{fmtDate(c.createdAt)}</td></tr>))}</tbody>
              </table></div>
            )}
          </section>
          <form className="card side" onSubmit={handleSubmit(v => create.mutate(v))} noValidate aria-labelledby="nouveau">
            <div className="card-h"><h2 id="nouveau">Nouveau client</h2></div>
            <div className="card-b stack" style={{ gap: 16 }}>
              <div className="field"><label className="label" htmlFor="name">Nom</label>
                <input id="name" className={`input${errors.name ? " is-error" : ""}`} aria-invalid={!!errors.name} aria-describedby={errors.name ? "name-err" : undefined} {...register("name")} />
                {errors.name && <span id="name-err" className="err" role="alert">{errors.name.message}</span>}</div>
              <div className="field"><label className="label" htmlFor="siren">SIREN <span className="muted">(facultatif)</span></label>
                <input id="siren" className={`input mono${errors.siren ? " is-error" : ""}`} inputMode="numeric" aria-invalid={!!errors.siren} aria-describedby="siren-hint" {...register("siren")} />
                {errors.siren ? <span className="err" role="alert">{errors.siren.message}</span> : <span id="siren-hint" className="hint">9 chiffres. La vérification auprès de Sirene n’est pas encore connectée.</span>}</div>
              {create.error && <div className="alert a-danger" role="alert"><span>Création impossible : {(create.error as Error).message}</span></div>}
              {create.isSuccess && <div className="alert a-success" role="status"><span>Client créé.</span></div>}
            </div>
            <div className="card-f"><button type="submit" className="btn btn-primary" disabled={create.isPending}>{create.isPending ? "Création en cours…" : "Créer le client"}</button></div>
          </form>
        </div>
      )}
    </>
  );
}
