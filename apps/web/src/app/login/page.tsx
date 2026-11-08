"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { useState } from "react";

const Schema = z.object({ tenantSlug: z.string().min(1, "Indiquez votre société."), email: z.string().email("Saisissez une adresse email valide."), password: z.string().min(1, "Saisissez votre mot de passe.") });
type V = z.infer<typeof Schema>;

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<V>({ resolver: zodResolver(Schema) });
  async function onSubmit(v: V) {
    setError(null);
    const r = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(v) });
    if (!r.ok) { setError((await r.json().catch(() => null))?.error?.message ?? "Connexion impossible. Réessayez dans un instant."); return; }
    router.replace("/companies"); router.refresh();
  }
  const f = (id: keyof V, label: string, props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div className="field">
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} className={`input${errors[id] ? " is-error" : ""}`} aria-invalid={!!errors[id]} aria-describedby={errors[id] ? `${id}-err` : undefined} {...props} {...register(id)} />
      {errors[id] && <span id={`${id}-err`} className="err" role="alert">{errors[id]?.message}</span>}
    </div>
  );
  return (
    <main className="auth-wrap">
      <form className="card auth-card" onSubmit={handleSubmit(onSubmit)} noValidate aria-labelledby="t">
        <div className="card-b stack" style={{ gap: 16 }}>
          <div><span className="eyebrow">PORTAGE OS</span><h1 id="t" style={{ marginTop: 4 }}>Connexion</h1></div>
          {f("tenantSlug", "Société", { autoComplete: "organization" })}
          {f("email", "Adresse email", { type: "email", autoComplete: "username" })}
          {f("password", "Mot de passe", { type: "password", autoComplete: "current-password" })}
          {error && <div className="alert a-danger" role="alert"><span>{error}</span></div>}
          <button type="submit" className={`btn btn-primary btn-lg${isSubmitting ? " is-loading" : ""}`} disabled={isSubmitting}>{isSubmitting ? "Connexion en cours…" : "Se connecter"}</button>
        </div>
      </form>
    </main>
  );
}
