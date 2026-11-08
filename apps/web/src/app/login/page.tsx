"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { useState } from "react";

const Schema = z.object({ tenantSlug: z.string().min(1, "Société requise"), email: z.string().email("Email invalide"), password: z.string().min(1, "Mot de passe requis") });
type V = z.infer<typeof Schema>;

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<V>({ resolver: zodResolver(Schema) });
  async function onSubmit(v: V) {
    setError(null);
    const r = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(v) });
    if (!r.ok) { setError((await r.json().catch(() => null))?.error?.message ?? "Erreur de connexion"); return; }
    router.replace("/companies"); router.refresh();
  }
  return (
    <main className="center">
      <form className="card" onSubmit={handleSubmit(onSubmit)} noValidate aria-labelledby="t">
        <h1 id="t">Connexion</h1>
        <div className="field"><label htmlFor="tenantSlug">Société</label><input id="tenantSlug" autoComplete="organization" aria-invalid={!!errors.tenantSlug} {...register("tenantSlug")} />{errors.tenantSlug && <div className="err" role="alert">{errors.tenantSlug.message}</div>}</div>
        <div className="field"><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" aria-invalid={!!errors.email} {...register("email")} />{errors.email && <div className="err" role="alert">{errors.email.message}</div>}</div>
        <div className="field"><label htmlFor="password">Mot de passe</label><input id="password" type="password" autoComplete="current-password" aria-invalid={!!errors.password} {...register("password")} />{errors.password && <div className="err" role="alert">{errors.password.message}</div>}</div>
        {error && <div className="err" role="alert">{error}</div>}
        <button type="submit" disabled={isSubmitting}>{isSubmitting ? "Connexion…" : "Se connecter"}</button>
      </form>
    </main>
  );
}
