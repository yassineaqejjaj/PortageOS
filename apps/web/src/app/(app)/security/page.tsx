"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorBox } from "@/lib/ui";

type Me = { mfaEnabled: boolean; mfaEnrollmentRequired: boolean; email?: string };
type Sess = { id: string; createdAt: string; lastUsedAt: string; userAgent: string | null; current: boolean };

export default function SecurityPage() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("me") });
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => api<Sess[]>("auth/sessions") });
  const [pwd, setPwd] = useState({ currentPassword: "", newPassword: "" });
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string; qr?: string } | null>(null);
  const [code, setCode] = useState(""); const [codes, setCodes] = useState<string[] | null>(null);
  const [off, setOff] = useState({ password: "", code: "" });
  useEffect(() => { if (setup && !setup.qr) QRCode.toDataURL(setup.otpauthUri, { margin: 1, width: 192 }).then(qr => setSetup(s => s && { ...s, qr })); }, [setup]);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["me"] }); qc.invalidateQueries({ queryKey: ["sessions"] }); };
  const changePwd = useMutation({ mutationFn: () => api("auth/password", { method: "POST", body: pwd }), onSuccess: () => { setPwd({ currentPassword: "", newPassword: "" }); refresh(); } });
  const revoke = useMutation({ mutationFn: (id: string) => api(`auth/sessions/${id}`, { method: "DELETE" }), onSuccess: refresh });
  const revokeOthers = useMutation({ mutationFn: () => api("auth/sessions/revoke-others", { method: "POST" }), onSuccess: refresh });
  const start = useMutation({ mutationFn: () => api<{ secret: string; otpauthUri: string }>("auth/mfa/setup", { method: "POST" }), onSuccess: setSetup });
  const enable = useMutation({ mutationFn: () => api<{ recoveryCodes: string[] }>("auth/mfa/enable", { method: "POST", body: { code } }), onSuccess: r => { setCodes(r.recoveryCodes); setSetup(null); setCode(""); refresh(); } });
  const disable = useMutation({ mutationFn: () => api("auth/mfa/disable", { method: "POST", body: off }), onSuccess: () => { setOff({ password: "", code: "" }); refresh(); } });
  return (
    <>
      <h1>Sécurité du compte</h1>
      {me.data?.mfaEnrollmentRequired && <div className="alert a-warning" role="alert"><span><b>Votre société impose l’authentification à deux facteurs.</b> Activez-la ci-dessous pour accéder au reste de l’application.</span></div>}
      <ErrorBox error={changePwd.error ?? revoke.error ?? revokeOthers.error ?? start.error ?? enable.error ?? disable.error} prefix="Erreur" />
      {changePwd.isSuccess && <div className="alert a-success" role="status"><span>Mot de passe modifié. Vos autres sessions ont été déconnectées.</span></div>}
      <div className="grid-2" style={{ alignItems: "start" }}>
        <section className="card" aria-labelledby="m"><div className="card-h"><h2 id="m">Authentification à deux facteurs</h2>{me.data?.mfaEnabled ? <span className="badge b-success">Activée</span> : <span className="badge b-warning">Non activée</span>}</div>
          <div className="card-b stack">
            {codes && <div className="alert a-warning" role="alert"><div><b>Codes de secours — affichés une seule fois.</b> Conservez-les hors de cet appareil ; chacun ne sert qu’une fois.<pre className="mono" style={{ margin: "8px 0 0" }}>{codes.join("\n")}</pre></div></div>}
            {!me.data?.mfaEnabled && !setup && <button className="btn btn-primary" disabled={start.isPending} onClick={() => start.mutate()}>Configurer l’application d’authentification</button>}
            {setup && (
              <form className="stack" onSubmit={e => { e.preventDefault(); enable.mutate(); }}>
                <p className="small">Scannez ce QR code avec votre application (ou saisissez la clé), puis entrez le code à 6 chiffres affiché.</p>
                {setup.qr && <img src={setup.qr} alt="QR code d’enrôlement à scanner avec votre application d’authentification" width={192} height={192} />}
                <p className="small">Clé manuelle : <span className="mono">{setup.secret}</span></p>
                <div className="field"><label className="label" htmlFor="c">Code à 6 chiffres</label><input id="c" className="input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} required /></div>
                <button className="btn btn-primary" disabled={enable.isPending || code.length !== 6}>Activer</button>
              </form>)}
            {me.data?.mfaEnabled && (
              <form className="stack" onSubmit={e => { e.preventDefault(); disable.mutate(); }}>
                <p className="small muted">Pour désactiver, confirmez avec votre mot de passe et un code de l’application.</p>
                <div className="field"><label className="label" htmlFor="dp">Mot de passe</label><input id="dp" className="input" type="password" autoComplete="current-password" value={off.password} onChange={e => setOff({ ...off, password: e.target.value })} required /></div>
                <div className="field"><label className="label" htmlFor="dc">Code à 6 chiffres</label><input id="dc" className="input" inputMode="numeric" value={off.code} onChange={e => setOff({ ...off, code: e.target.value })} required /></div>
                <button className="btn btn-danger" disabled={disable.isPending}>Désactiver le MFA</button>
              </form>)}
          </div></section>
        <form className="card" aria-labelledby="p" onSubmit={e => { e.preventDefault(); changePwd.mutate(); }}><div className="card-h"><h2 id="p">Mot de passe</h2></div>
          <div className="card-b stack">
            <div className="field"><label className="label" htmlFor="cur">Mot de passe actuel</label><input id="cur" className="input" type="password" autoComplete="current-password" value={pwd.currentPassword} onChange={e => setPwd({ ...pwd, currentPassword: e.target.value })} required /></div>
            <div className="field"><label className="label" htmlFor="new">Nouveau mot de passe</label><input id="new" className="input" type="password" autoComplete="new-password" value={pwd.newPassword} onChange={e => setPwd({ ...pwd, newPassword: e.target.value })} required /><span className="hint">12 caractères minimum ; mélangez 3 types de caractères ou allongez à 16. Pas d’identifiant ni de mot courant.</span></div>
          </div><div className="card-f"><button className="btn btn-primary" disabled={changePwd.isPending}>Changer le mot de passe</button></div></form>
      </div>
      <section className="card" aria-labelledby="s"><div className="card-h"><h2 id="s">Sessions actives</h2><button className="btn btn-secondary btn-sm" disabled={revokeOthers.isPending || (sessions.data?.length ?? 0) < 2} onClick={() => revokeOthers.mutate()}>Déconnecter les autres sessions</button></div>
        <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th scope="col">Appareil</th><th scope="col">Ouverte le</th><th scope="col">Dernière activité</th><th scope="col"><span style={{ position: "absolute", left: -999 }}>Action</span></th></tr></thead>
          <tbody>{sessions.data?.map(s => <tr key={s.id}><td>{s.userAgent?.slice(0, 60) ?? "—"}{s.current && <span className="badge b-success" style={{ marginLeft: 8 }}>Cette session</span>}</td><td className="num">{new Date(s.createdAt).toLocaleString("fr-FR")}</td><td className="num">{new Date(s.lastUsedAt).toLocaleString("fr-FR")}</td><td className="r">{!s.current && <button className="btn btn-ghost btn-sm" onClick={() => revoke.mutate(s.id)}>Révoquer</button>}</td></tr>)}</tbody></table></div></section>
    </>
  );
}
