"use client";
import Link from "next/link";
import { useState } from "react";

export default function ForgotPasswordPage() {
  const [f, setF] = useState({ tenantSlug: "", email: "" }); const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    const r = await fetch("/api/password/forgot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f) }); const d = await r.json().catch(() => null); setBusy(false);
    if (!r.ok) { setErr(d?.error?.message ?? "Demande impossible. Réessayez dans un instant."); return; }
    setMsg(d.message);
  }
  return (
    <main className="auth-wrap">
      <form className="card auth-card" onSubmit={submit} aria-labelledby="t">
        <div className="card-h"><h1 id="t">Mot de passe oublié</h1></div>
        <div className="card-b stack" style={{ gap: 16 }}>
          {msg ? <div className="alert a-info" role="status"><span>{msg}</span></div> : <>
            <div className="field"><label className="label" htmlFor="fs">Société</label><input id="fs" className="input" value={f.tenantSlug} onChange={e => setF({ ...f, tenantSlug: e.target.value })} required /></div>
            <div className="field"><label className="label" htmlFor="fe">Adresse email</label><input id="fe" type="email" autoComplete="email" className="input" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} required /></div>
            {err && <div className="alert a-danger" role="alert"><span>{err}</span></div>}
          </>}
        </div>
        <div className="card-f row" style={{ justifyContent: "space-between" }}>
          {!msg && <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Envoi…" : "Envoyer le lien"}</button>}
          <Link href="/login">Retour à la connexion</Link>
        </div>
      </form>
    </main>
  );
}
