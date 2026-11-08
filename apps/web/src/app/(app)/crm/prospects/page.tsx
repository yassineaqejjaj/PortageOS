"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { fmtDate } from "@/lib/format";

type Stage = "new" | "contacted" | "qualified" | "converted" | "lost";
type Prospect = { id: string; kind: "consultant" | "company"; name: string; email: string | null; phone: string | null; stage: Stage; lostReason: string | null; createdAt: string };
type Ev = "contact" | "qualify" | "convert" | "lose" | "reopen";

// Libellé + forme (jamais la couleur seule) par étape.
const STAGE: Record<Stage, { label: string; cls: string }> = {
  new: { label: "Nouveau", cls: "b-neutral" }, contacted: { label: "Contacté", cls: "b-info" }, qualified: { label: "Qualifié", cls: "b-warning" },
  converted: { label: "Converti", cls: "b-success" }, lost: { label: "Perdu", cls: "b-danger" },
};
const NEXT: Record<Stage, { ev: Ev; label: string }[]> = {
  new: [{ ev: "contact", label: "Marquer contacté" }], contacted: [{ ev: "qualify", label: "Qualifier" }],
  qualified: [{ ev: "convert", label: "Convertir" }], converted: [], lost: [{ ev: "reopen", label: "Rouvrir" }],
};
const Schema = z.object({
  kind: z.enum(["consultant", "company"]), name: z.string().min(1, "Indiquez le nom.").max(200),
  email: z.string().email("Adresse email invalide.").or(z.literal("")), phone: z.string().min(5, "Numéro trop court.").or(z.literal("")),
});
type V = z.infer<typeof Schema>;

export default function ProspectsPage() {
  const qc = useQueryClient();
  const [losing, setLosing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const list = useQuery({ queryKey: ["prospects"], queryFn: () => api<Prospect[]>("prospects") });
  const { register, handleSubmit, reset, formState: { errors } } = useForm<V>({ resolver: zodResolver(Schema), defaultValues: { kind: "consultant" } });
  const create = useMutation({
    mutationFn: (v: V) => api<Prospect>("prospects", { method: "POST", body: { kind: v.kind, name: v.name, ...(v.email ? { email: v.email } : {}), ...(v.phone ? { phone: v.phone } : {}) } }),
    onSuccess: () => { reset({ kind: "consultant", name: "", email: "", phone: "" }); qc.invalidateQueries({ queryKey: ["prospects"] }); },
  });
  const move = useMutation({
    mutationFn: (a: { id: string; event: Ev; lostReason?: string }) => api<Prospect>(`prospects/${a.id}/transition`, { method: "POST", body: { event: a.event, ...(a.lostReason ? { lostReason: a.lostReason } : {}) } }),
    onSuccess: () => { setLosing(null); setReason(""); qc.invalidateQueries({ queryKey: ["prospects"] }); },
  });
  const forbidden = list.error instanceof ApiError && list.error.status === 403;
  return (
    <>
      <h1>Prospects</h1>
      {forbidden && <div className="alert a-warning" role="alert"><span>Accès refusé : votre rôle ne permet pas de consulter les prospects.</span></div>}
      {!forbidden && (
        <div className="split">
          <section className="card main" aria-labelledby="liste">
            <div className="card-h"><h2 id="liste">Pipeline</h2>{list.data && <span className="count" aria-label={`${list.data.length} prospects`}>{list.data.length}</span>}</div>
            {list.isLoading && <div className="card-b muted" aria-live="polite">Chargement des prospects…</div>}
            {list.error && <div className="card-b"><div className="alert a-danger" role="alert"><span>Impossible de charger les prospects : {(list.error as Error).message}</span></div></div>}
            {move.error && <div className="card-b"><div className="alert a-danger" role="alert"><span>Transition impossible : {(move.error as Error).message}</span></div></div>}
            {list.data && list.data.length === 0 && <div className="empty"><h3>Aucun prospect</h3><p className="muted">Ajoutez un consultant ou une entreprise avec le formulaire.</p></div>}
            {list.data && list.data.length > 0 && (
              <div className="tbl-wrap"><table className="tbl compact">
                <thead><tr><th scope="col">Nom</th><th scope="col">Type</th><th scope="col">Étape</th><th scope="col">Créé le</th><th scope="col">Actions</th></tr></thead>
                <tbody>{list.data.map(p => (
                  <tr key={p.id}>
                    <td><b>{p.name}</b><div className="small muted">{p.email ?? p.phone ?? "Aucun contact"}</div></td>
                    <td>{p.kind === "consultant" ? "Consultant" : "Entreprise"}</td>
                    <td><span className={`badge ${STAGE[p.stage].cls}`}>{STAGE[p.stage].label}</span>{p.lostReason && <div className="small muted">{p.lostReason}</div>}</td>
                    <td className="num">{fmtDate(p.createdAt)}</td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        {NEXT[p.stage].map(n => (
                          <button key={n.ev} className="btn btn-secondary btn-sm" disabled={move.isPending} onClick={() => move.mutate({ id: p.id, event: n.ev })}>{n.label}</button>
                        ))}
                        {p.stage !== "lost" && p.stage !== "converted" && (
                          <button className="btn btn-ghost btn-sm" onClick={() => { setLosing(p.id); setReason(""); }}>Marquer perdu</button>
                        )}
                      </div>
                      {losing === p.id && (
                        <form className="row" style={{ marginTop: 8, gap: 6 }} onSubmit={e => { e.preventDefault(); move.mutate({ id: p.id, event: "lose", lostReason: reason }); }}>
                          <label className="label" htmlFor={`r-${p.id}`} style={{ position: "absolute", left: -999 }}>Motif de perte</label>
                          <input id={`r-${p.id}`} className="input" style={{ width: 200 }} placeholder="Motif de perte (obligatoire)" value={reason} onChange={e => setReason(e.target.value)} minLength={3} required />
                          <button type="submit" className="btn btn-danger btn-sm" disabled={move.isPending || reason.trim().length < 3}>Confirmer</button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLosing(null)}>Annuler</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
          <form className="card side" onSubmit={handleSubmit(v => create.mutate(v))} noValidate aria-labelledby="nouveau">
            <div className="card-h"><h2 id="nouveau">Nouveau prospect</h2></div>
            <div className="card-b stack" style={{ gap: 16 }}>
              <div className="field"><label className="label" htmlFor="kind">Type</label>
                <select id="kind" className="input" {...register("kind")}><option value="consultant">Consultant</option><option value="company">Entreprise</option></select></div>
              <div className="field"><label className="label" htmlFor="pname">Nom</label>
                <input id="pname" className={`input${errors.name ? " is-error" : ""}`} aria-invalid={!!errors.name} {...register("name")} />
                {errors.name && <span className="err" role="alert">{errors.name.message}</span>}</div>
              <div className="field"><label className="label" htmlFor="pemail">Email</label>
                <input id="pemail" type="email" className={`input${errors.email ? " is-error" : ""}`} aria-invalid={!!errors.email} {...register("email")} />
                {errors.email && <span className="err" role="alert">{errors.email.message}</span>}</div>
              <div className="field"><label className="label" htmlFor="pphone">Téléphone</label>
                <input id="pphone" className={`input${errors.phone ? " is-error" : ""}`} aria-invalid={!!errors.phone} {...register("phone")} />
                {errors.phone ? <span className="err" role="alert">{errors.phone.message}</span> : <span className="hint">Un email ou un téléphone est requis pour passer à « Contacté ».</span>}</div>
              {create.error && <div className="alert a-danger" role="alert"><span>Création impossible : {(create.error as Error).message}</span></div>}
            </div>
            <div className="card-f"><button type="submit" className="btn btn-primary" disabled={create.isPending}>{create.isPending ? "Création en cours…" : "Ajouter le prospect"}</button></div>
          </form>
        </div>
      )}
    </>
  );
}
