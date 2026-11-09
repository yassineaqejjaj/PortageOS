"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type Preview = { kind: "invite" | "reset"; email: string; tenantName: string; tenantSlug: string; roles: string[]; existingAccount: boolean };

function Inner() {
  const token = useSearchParams().get("token") ?? "";
  const [p, setP] = useState<Preview | null>(null); const [err, setErr] = useState<string | null>(null); const [done, setDone] = useState<string | null>(null);
  const [password, setPassword] = useState(""); const [current, setCurrent] = useState("");
  useEffect(() => { fetch(`/api/invite/preview?token=${encodeURIComponent(token)}`).then(async r => { const d = await r.json(); if (r.ok) setP(d); else setErr(d.error?.message ?? "Invitation invalide"); }); }, [token]);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    const r = await fetch("/api/invite/accept", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password, ...(current ? { currentPassword: current } : {}) }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(d.error?.message ?? "Impossible de valider"); return; }
    setDone(d.tenantSlug);
  }
  return (
    <main className="auth-wrap"><div className="card auth-card"><div className="card-b stack" style={{ gap: 16 }}>
      <div><span className="eyebrow">PORTAGE OS</span><h1 style={{ marginTop: 4 }}>{p?.kind === "reset" ? "Nouveau mot de passe" : "Invitation"}</h1></div>
      {err && <div className="alert a-danger" role="alert"><span>{err}</span></div>}
      {done && <><div className="alert a-success" role="status"><span>C’est fait. Société à saisir à la connexion : <b className="mono">{done}</b></span></div><Link className="btn btn-primary" href="/login">Se connecter</Link></>}
      {p && !done && (
        <form className="stack" onSubmit={submit}>
          <p>{p.kind === "reset" ? <>Réinitialisation du mot de passe de <b>{p.email}</b>.</> : <>Vous êtes invité(e) à rejoindre <b>{p.tenantName}</b> avec l’adresse <b>{p.email}</b>.</>}</p>
          {p.kind === "invite" && p.existingAccount
            ? <div className="field"><label className="label" htmlFor="cur">Votre mot de passe actuel</label><input id="cur" className="input" type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} required /><span className="hint">Un compte existe déjà pour cette adresse : confirmez-le pour rejoindre la société. Votre mot de passe ne sera pas modifié.</span></div>
            : <div className="field"><label className="label" htmlFor="pw">Choisissez un mot de passe</label><input id="pw" className="input" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required /><span className="hint">12 caractères minimum ; mélangez 3 types de caractères ou allongez à 16.</span></div>}
          <button className="btn btn-primary btn-lg">{p.kind === "reset" ? "Enregistrer le mot de passe" : "Accepter l’invitation"}</button>
        </form>)}
    </div></div></main>
  );
}
export default function InvitePage() { return <Suspense fallback={<main className="auth-wrap"><p>Chargement…</p></main>}><Inner /></Suspense>; }
