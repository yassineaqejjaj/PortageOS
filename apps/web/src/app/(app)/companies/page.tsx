"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";

type Company = { id: string; name: string; siren: string | null; createdAt: string };
const Schema = z.object({ name: z.string().min(1, "Nom requis").max(200), siren: z.string().regex(/^\d{9}$/, "SIREN : 9 chiffres").or(z.literal("")) });
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
      <h1>Clients</h1>
      {forbidden && <p role="alert" className="card">Vous n&apos;avez pas la permission de consulter les clients.</p>}
      {!forbidden && (
        <>
          <form className="card" onSubmit={handleSubmit(v => create.mutate(v))} noValidate aria-label="Nouveau client">
            <h2>Nouveau client</h2>
            <div className="field"><label htmlFor="name">Nom</label><input id="name" {...register("name")} aria-invalid={!!errors.name} />{errors.name && <div className="err" role="alert">{errors.name.message}</div>}</div>
            <div className="field"><label htmlFor="siren">SIREN (optionnel)</label><input id="siren" inputMode="numeric" {...register("siren")} aria-invalid={!!errors.siren} />{errors.siren && <div className="err" role="alert">{errors.siren.message}</div>}</div>
            {create.error && <div className="err" role="alert">{(create.error as Error).message}</div>}
            <button type="submit" disabled={create.isPending}>{create.isPending ? "Création…" : "Créer"}</button>
          </form>
          <div className="card">
            {list.isLoading && <p>Chargement…</p>}
            {list.error && !forbidden && <p role="alert" className="err">{(list.error as Error).message}</p>}
            {list.data && list.data.length === 0 && <p className="muted">Aucun client pour le moment.</p>}
            {list.data && list.data.length > 0 && (
              <table><thead><tr><th>Nom</th><th>SIREN</th><th>Créé le</th></tr></thead>
                <tbody>{list.data.map(c => (<tr key={c.id}><td>{c.name}</td><td>{c.siren ?? "—"}</td><td>{new Date(c.createdAt).toLocaleDateString("fr-FR")}</td></tr>))}</tbody></table>
            )}
          </div>
        </>
      )}
    </>
  );
}
