"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const Schema = z.object({ tenantSlug: z.string().min(1, "Indiquez votre société."), email: z.string().email("Saisissez une adresse email valide."), password: z.string().min(1, "Saisissez votre mot de passe.") });
type V = z.infer<typeof Schema>;

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [mfa, setMfa] = useState<{ token: string; recovery: boolean; value: string } | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<V>({ resolver: zodResolver(Schema) });
  async function onSubmit(v: V) {
    setError(null);
    const r = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(v) });
    const data = await r.json().catch(() => null);
    if (!r.ok) { setError(data?.error?.message ?? "Connexion impossible. Réessayez dans un instant."); return; }
    if (data?.mfaRequired) { setMfa({ token: data.mfaToken, recovery: false, value: "" }); return; } // aucune session tant que le second facteur n'est pas validé
    router.replace("/"); router.refresh();
  }
  async function submitMfa(e: React.FormEvent) {
    e.preventDefault(); if (!mfa) return; setError(null);
    const r = await fetch("/api/session/mfa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mfaToken: mfa.token, ...(mfa.recovery ? { recoveryCode: mfa.value } : { code: mfa.value }) }) });
    if (!r.ok) { setError((await r.json().catch(() => null))?.error?.message ?? "Code invalide"); return; }
    router.replace("/"); router.refresh();
  }
  const f = (id: keyof V, label: string, props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div className="field">
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} className={`input${errors[id] ? " is-error" : ""}`} aria-invalid={!!errors[id]} aria-describedby={errors[id] ? `${id}-err` : undefined} {...props} {...register(id)} />
      {errors[id] && <span id={`${id}-err`} className="err" role="alert">{errors[id]?.message}</span>}
    </div>
  );
  if (mfa) return (
    <main className="auth-wrap">
      <form className="card auth-card" onSubmit={submitMfa} aria-labelledby="t">
        <div className="card-b stack" style={{ gap: 16 }}>
          <div><span className="eyebrow">PORTAGE OS</span><h1 id="t" style={{ marginTop: 4 }}>Vérification en deux étapes</h1></div>
          <div className="field"><label className="label" htmlFor="mfa">{mfa.recovery ? "Code de secours" : "Code à 6 chiffres de votre application d’authentification"}</label>
            <input id="mfa" className="input" inputMode={mfa.recovery ? "text" : "numeric"} autoComplete="one-time-code" autoFocus value={mfa.value} onChange={e => setMfa({ ...mfa, value: e.target.value })} required /></div>
          {error && <div className="alert a-danger" role="alert"><span>{error}</span></div>}
          <button type="submit" className="btn btn-primary btn-lg">Vérifier</button>
          <button type="button" className="btn btn-ghost" onClick={() => setMfa({ ...mfa, recovery: !mfa.recovery, value: "" })}>{mfa.recovery ? "Utiliser un code de l’application" : "Utiliser un code de secours"}</button>
        </div>
      </form>
    </main>
  );
  return (
    <main className="auth-wrap">
      <form className="card auth-card" onSubmit={handleSubmit(onSubmit)} noValidate aria-labelledby="t">
        <div className="card-b stack" style={{ gap: 16 }}>
          <div><span className="eyebrow">PORTAGE OS</span><h1 id="t" style={{ marginTop: 4 }}>Connexion</h1></div>
          {f("tenantSlug", "Société", { autoComplete: "organization" })}
          {f("email", "Adresse email", { type: "email", autoComplete: "username" })}
          {f("password", "Mot de passe", { type: "password", autoComplete: "current-password" })}
          <Link href="/forgot-password" className="small">Mot de passe oublié ?</Link>
          {error && <div className="alert a-danger" role="alert"><span>{error}</span></div>}
          <button type="submit" className={`btn btn-primary btn-lg${isSubmitting ? " is-loading" : ""}`} disabled={isSubmitting}>{isSubmitting ? "Connexion en cours…" : "Se connecter"}</button>
        </div>
      </form>
    </main>
  );
}
