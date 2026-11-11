"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { downloadFile } from "@/lib/download";
import { fmtDateTime } from "@/lib/format";
import { ErrorBox, Forbidden, isForbidden, nf } from "@/lib/ui";

type Scenario = { variables: { tjm: string }; professionalExpenses: string; grossAnnual: string; grossMonthly: string; netBeforePas: string; pasRatePercent: string; netAfterPas: string; netPaidMonthly: string; paidLeaveDays: string; totalPerLeaveDay: string; extraForUntakenLeave: string; internalMargin: string | null; internalProfitabilityPercent: string | null };
type Sim = { id: string; createdAt: string; prospectId?: string | null; recipient: string | null; scenarios: Scenario[] };
type Prospect = { id: string; name: string; kind: string; phone: string | null };
const SOURCES: Record<string, string> = { written_form: "Formulaire écrit", in_app: "Accord saisi dans l’application", other: "Autre (preuve à préciser)" };
const num = (v: string) => /^\d{1,8}([.,]\d{1,2})?$/.test(v.trim());
const dot = (v: string) => v.trim().replace(",", ".");
const pct = (v: string) => `${Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;

export default function SalarySimulationsPage() {
  const qc = useQueryClient();
  const prospects = useQuery({ queryKey: ["prospects-all"], queryFn: () => api<Prospect[]>("prospects") });
  const history = useQuery({ queryKey: ["salary-sims"], queryFn: () => api<Sim[]>("crm/salary-simulations"), retry: false });
  const [tjm, setTjm] = useState("");
  const [rows, setRows] = useState([{ g: "", e: "" }]);
  const [adv, setAdv] = useState({ days: "20", mutual: "100", cName: "", cPhone: "", cEmail: "" });
  const [prospectId, setProspectId] = useState("");
  const [consent, setConsent] = useState({ phone: "", source: "written_form", evidence: "" });
  const [notice, setNotice] = useState<string | null>(null);
  const [dlErr, setDlErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ sig: string; id: string } | null>(null);

  const scenarios = rows.filter(r => r.g || r.e).map(r => ({ grossAnnual: dot(r.g), dailyExpenses: dot(r.e) }));
  const valid = num(tjm) && scenarios.length > 0 && scenarios.every(s => num(s.grossAnnual) && num(s.dailyExpenses)) && num(adv.days) && num(adv.mutual);
  const payload = { ...(prospectId ? { prospectId } : {}), tjm: dot(tjm), daysPerMonth: dot(adv.days), mutualMonthly: dot(adv.mutual), scenarios,
    ...(adv.cName ? { contact: { name: adv.cName, ...(adv.cPhone ? { phone: adv.cPhone } : {}), ...(adv.cEmail ? { email: adv.cEmail } : {}) } } : {}) };
  const sig = JSON.stringify(payload);
  const [debounced, setDebounced] = useState(sig);
  useEffect(() => { const t = setTimeout(() => setDebounced(sig), 450); return () => clearTimeout(t); }, [sig]);
  // Résultat en direct : le calcul reste côté serveur (aperçu non enregistré).
  const live = useQuery({ queryKey: ["salary-preview", debounced], enabled: valid && debounced === sig, retry: false, queryFn: () => api<Sim>("crm/salary-simulations/preview", { method: "POST", body: JSON.parse(debounced) }) });

  /** Enregistre la simulation une seule fois par saisie (téléchargement et envoi réutilisent le même enregistrement). */
  const ensureSaved = async () => {
    if (saved?.sig === sig) return saved.id;
    const s = await api<Sim>("crm/salary-simulations", { method: "POST", body: payload });
    setSaved({ sig, id: s.id }); qc.invalidateQueries({ queryKey: ["salary-sims"] }); return s.id;
  };
  const dl = useMutation({ mutationFn: async () => { setDlErr(null); const id = await ensureSaved(); setDlErr(await downloadFile(`/api/simulations/${id}/pdf`, "simulation.pdf")); } });
  const send = useMutation({
    mutationFn: async () => { setNotice(null); const id = await ensureSaved(); return api<{ status: string }>(`crm/salary-simulations/${id}/whatsapp`, { method: "POST", body: { prospectId } }); },
    onSuccess: m => setNotice(m.status === "simulated" ? "Envoi simulé (environnement local : rien n’est parti vers WhatsApp)." : "Simulation envoyée par WhatsApp."),
  });
  const grant = useMutation({
    mutationFn: () => api("whatsapp/consents", { method: "POST", body: { subjectType: "prospect", subjectId: prospectId, phone: consent.phone, status: "opted_in", source: consent.source, evidence: consent.evidence || undefined } }),
    onSuccess: () => { setNotice("Consentement enregistré. Vous pouvez envoyer la simulation."); send.reset(); },
  });
  if (isForbidden(history.error) || isForbidden(prospects.error)) return <Forbidden what="les simulations de salaire" />;
  const noConsent = send.error instanceof ApiError && send.error.status === 409 && /consentement/i.test(send.error.message);
  const pick = (id: string) => { setProspectId(id); setConsent(c => ({ ...c, phone: prospects.data?.find(x => x.id === id)?.phone ?? "" })); send.reset(); setNotice(null); };
  const setRow = (i: number, k: "g" | "e", v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const reopen = (h: Sim) => { setProspectId(h.prospectId ?? ""); setNotice(null); };
  void reopen;

  return (
    <>
      <h1>Simulation de salaire</h1>
      <div className="split">
        <div className="main stack" style={{ gap: 16 }}>
          <section className="card" aria-labelledby="s-new">
            <div className="card-h"><h2 id="s-new">1 · Renseignez le TJM et un scénario</h2><span className="badge b-warning">Estimation non contractuelle</span></div>
            <div className="card-b stack">
              <div className="field" style={{ maxWidth: 220 }}><label className="label" htmlFor="tjm">TJM (€ / jour)</label><input id="tjm" className="input" inputMode="decimal" autoFocus placeholder="700" value={tjm} onChange={e => setTjm(e.target.value)} /></div>
              <div className="stack" style={{ gap: 8 }}>
                {rows.map((r, i) => (
                  <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }} key={i}>
                    <div className="field"><label className="label" htmlFor={`g${i}`}>{rows.length > 1 ? `Option ${i + 1} — ` : ""}Salaire brut annuel (€)</label><input id={`g${i}`} className="input" inputMode="decimal" placeholder="58 000" value={r.g} onChange={e => setRow(i, "g", e.target.value)} /></div>
                    <div className="field"><label className="label" htmlFor={`e${i}`}>Frais forfaitaires par jour (€)</label><input id={`e${i}`} className="input" inputMode="decimal" placeholder="270" value={r.e} onChange={e => setRow(i, "e", e.target.value)} /></div>
                    {i > 0 && <button className="btn btn-ghost" type="button" aria-label={`Retirer l’option ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>Retirer</button>}
                  </div>))}
                {rows.length < 3 && <div><button className="btn btn-ghost" type="button" onClick={() => setRows([...rows, { g: "", e: "" }])}>+ Comparer une autre option</button></div>}
              </div>
              <details><summary className="small muted" style={{ cursor: "pointer" }}>Réglages avancés (20 jours/mois, mutuelle 100 €, contact affiché)</summary>
                <div className="row" style={{ gap: 12, flexWrap: "wrap", marginTop: 8 }}>
                  <div className="field"><label className="label" htmlFor="dpm">Jours travaillés / mois</label><input id="dpm" className="input" inputMode="decimal" value={adv.days} onChange={e => setAdv({ ...adv, days: e.target.value })} /></div>
                  <div className="field"><label className="label" htmlFor="mu">Mutuelle / mois (€)</label><input id="mu" className="input" inputMode="decimal" value={adv.mutual} onChange={e => setAdv({ ...adv, mutual: e.target.value })} /></div>
                  <div className="field"><label className="label" htmlFor="cn">Contact affiché</label><input id="cn" className="input" placeholder="par défaut : votre e-mail" value={adv.cName} onChange={e => setAdv({ ...adv, cName: e.target.value })} /></div>
                  <div className="field"><label className="label" htmlFor="cp">Téléphone</label><input id="cp" className="input" value={adv.cPhone} onChange={e => setAdv({ ...adv, cPhone: e.target.value })} /></div>
                  <div className="field"><label className="label" htmlFor="ce">E-mail</label><input id="ce" className="input" type="email" value={adv.cEmail} onChange={e => setAdv({ ...adv, cEmail: e.target.value })} /></div>
                </div></details>
            </div>
          </section>

          <section className="card" aria-labelledby="s-res" aria-live="polite">
            <div className="card-h"><h2 id="s-res">2 · Résultat</h2>{live.isFetching && <span className="small muted">Calcul…</span>}</div>
            <div className="card-b stack">
              {!valid && <div className="muted">Saisissez le TJM, le brut annuel et les frais par jour : le résultat s’affiche immédiatement.</div>}
              <ErrorBox error={valid ? live.error : null} prefix="Calcul impossible" />
              {valid && live.data?.scenarios.map((s, i) => (
                <div key={i} className="stack" style={{ gap: 6, padding: 12, border: "1px solid var(--border, #e5e7eb)", borderRadius: 8 }}>
                  <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <div><div className="small muted">{live.data!.scenarios.length > 1 ? `Option ${i + 1} · ` : ""}Net perçu chaque mois après impôts</div><div style={{ fontSize: 28, fontWeight: 700, color: "var(--success, #1a7f37)" }}>{nf(s.netPaidMonthly)}</div></div>
                    <div className="small" style={{ textAlign: "right" }}>Brut annuel {nf(s.grossAnnual)} · impôt à la source {pct(s.pasRatePercent)}<br />Net avant impôt {nf(s.netBeforePas)} → après {nf(s.netAfterPas)}<br />+ frais {nf(s.professionalExpenses)}<br />{s.paidLeaveDays} j de congés non pris : +{nf(s.extraForUntakenLeave)}</div>
                  </div>
                  <div className="small" style={{ borderTop: "1px dashed var(--border, #e5e7eb)", paddingTop: 6 }}>
                    <span className="badge b-neutral">Interne — non transmis</span>{" "}
                    {s.internalProfitabilityPercent ? <>Rentabilité : <b>{pct(s.internalProfitabilityPercent)}</b> du CA ({nf(s.internalMargin!)} / an après charges patronales)</> : <span className="muted">Rentabilité non calculée : paramètre « charges patronales » non approuvé.</span>}
                  </div>
                </div>))}
            </div>
          </section>

          <section className="card" aria-labelledby="s-act">
            <div className="card-h"><h2 id="s-act">3 · Partagez</h2></div>
            <div className="card-b stack">
              <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div className="field"><label className="label" htmlFor="sp">Destinataire (pour l’envoi WhatsApp)</label>
                  <select id="sp" className="input" value={prospectId} onChange={e => pick(e.target.value)}><option value="">— choisir un prospect —</option>{prospects.data?.filter(p => p.kind === "consultant").map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
                <button className="btn btn-primary" disabled={!valid || !live.data || !prospectId || send.isPending} onClick={() => send.mutate()}>{send.isPending ? "Envoi…" : "Envoyer par WhatsApp"}</button>
                <button className="btn" disabled={!valid || !live.data || dl.isPending} onClick={() => dl.mutate()}>Télécharger le PDF</button>
              </div>
              <ErrorBox error={dl.error} prefix="PDF impossible" />
              {dlErr && <div className="alert a-danger" role="alert">{dlErr}</div>}
              {notice && <div className="alert a-success" role="status">{notice}</div>}
              {send.error && !noConsent && <ErrorBox error={send.error} prefix="Envoi impossible" />}
              {noConsent && (
                <div className="alert a-warning" role="alert">
                  <div><b>Ce prospect n’a pas encore accepté de recevoir des messages WhatsApp.</b> Recueillez son accord (avec preuve) ; il pourra le retirer en répondant STOP.</div>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                    <input className="input" aria-label="Numéro WhatsApp" placeholder="+33 6 12 34 56 78" value={consent.phone} onChange={e => setConsent({ ...consent, phone: e.target.value })} />
                    <select className="input" aria-label="Origine du consentement" value={consent.source} onChange={e => setConsent({ ...consent, source: e.target.value })}>{Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <input className="input" aria-label="Preuve" placeholder="Preuve (date, canal…)" value={consent.evidence} onChange={e => setConsent({ ...consent, evidence: e.target.value })} />
                    <button className="btn" disabled={!consent.phone || grant.isPending} onClick={() => grant.mutate()}>Enregistrer l’accord</button>
                  </div>
                  <ErrorBox error={grant.error} prefix="Accord refusé" />
                </div>)}
            </div>
          </section>
        </div>
        <aside className="side">
          <section className="card" aria-labelledby="s-h"><div className="card-h"><h2 id="s-h">Envoyées / enregistrées</h2></div>
            <div className="card-b stack">
              {history.data?.length === 0 && <div className="muted">Aucune simulation enregistrée.</div>}
              {history.data?.map(h => <div key={h.id} className="small"><b>{h.recipient ?? "Sans destinataire"}</b><div className="muted">{fmtDateTime(h.createdAt)} · TJM {nf(h.scenarios[0]!.variables.tjm)} · net {nf(h.scenarios[0]!.netPaidMonthly)}/mois</div>
                <button className="btn btn-ghost" onClick={async () => setDlErr(await downloadFile(`/api/simulations/${h.id}/pdf`, "simulation.pdf"))}>PDF</button></div>)}
            </div></section>
        </aside>
      </div>
    </>
  );
}
