"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { downloadFile } from "@/lib/download";
import { fmtDateTime } from "@/lib/format";
import { ErrorBox, Forbidden, isForbidden, nf } from "@/lib/ui";

type Scenario = { variables: { tjm: string; daysPerMonth: string; dailyExpenses: string; mutualMonthly: string }; professionalExpenses: string; grossAnnual: string; grossMonthly: string; netBeforePas: string; pasRatePercent: string; netAfterPas: string; netPaidMonthly: string; paidLeaveDays: string; salaryPerLeaveDay: string; expensesPerLeaveDay: string; totalPerLeaveDay: string; extraForUntakenLeave: string; internalRemainingEnvelope: string };
type Sim = { id: string; createdAt: string; prospectId?: string | null; recipient: string | null; scenarios: Scenario[]; disclaimer: string };
type Prospect = { id: string; name: string; kind: string; phone: string | null; stage: string };
const SOURCES: Record<string, string> = { written_form: "Formulaire écrit", in_app: "Accord saisi dans l’application", other: "Autre (preuve à préciser)" };

export default function SalarySimulationsPage() {
  const qc = useQueryClient();
  const prospects = useQuery({ queryKey: ["prospects-all"], queryFn: () => api<Prospect[]>("prospects") });
  const history = useQuery({ queryKey: ["salary-sims"], queryFn: () => api<Sim[]>("crm/salary-simulations"), retry: false });
  const [f, setF] = useState({ prospectId: "", tjm: "", daysPerMonth: "20", mutualMonthly: "100", g1: "", e1: "", g2: "", e2: "", g3: "", e3: "", cName: "", cPhone: "", cEmail: "" });
  const [cur, setCur] = useState<Sim | null>(null);
  const [consent, setConsent] = useState({ phone: "", source: "written_form", evidence: "" });
  const [notice, setNotice] = useState<string | null>(null);
  const upd = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const create = useMutation({
    mutationFn: () => api<Sim>("crm/salary-simulations", { method: "POST", body: {
      ...(f.prospectId ? { prospectId: f.prospectId } : {}), tjm: f.tjm, daysPerMonth: f.daysPerMonth, mutualMonthly: f.mutualMonthly,
      scenarios: ([[f.g1, f.e1], [f.g2, f.e2], [f.g3, f.e3]] as const).filter(([g]) => g).map(([g, e]) => ({ grossAnnual: g, dailyExpenses: e })), ...(f.cName ? { contact: { name: f.cName, ...(f.cPhone ? { phone: f.cPhone } : {}), ...(f.cEmail ? { email: f.cEmail } : {}) } } : {}) } }),
    onSuccess: s => { setCur(s); setNotice(null); qc.invalidateQueries({ queryKey: ["salary-sims"] }); },
  });
  const send = useMutation({
    mutationFn: () => api<{ status: string }>(`crm/salary-simulations/${cur!.id}/whatsapp`, { method: "POST", body: { prospectId: f.prospectId } }),
    onSuccess: m => setNotice(m.status === "simulated" ? "Envoi simulé (environnement local : rien n’est parti vers WhatsApp)." : "Simulation envoyée par WhatsApp."),
  });
  const grant = useMutation({
    mutationFn: () => api("whatsapp/consents", { method: "POST", body: { subjectType: "prospect", subjectId: f.prospectId, phone: consent.phone, status: "opted_in", source: consent.source, evidence: consent.evidence || undefined } }),
    onSuccess: () => { setNotice("Consentement enregistré (preuve conservée). Vous pouvez envoyer la simulation."); send.reset(); },
  });
  const [dlErr, setDlErr] = useState<string | null>(null);
  if (isForbidden(history.error) || isForbidden(prospects.error)) return <Forbidden what="les simulations de salaire" />;
  const noConsent = send.error instanceof ApiError && send.error.status === 409 && /consentement/i.test(send.error.message);
  const pickProspect = (id: string) => { const p = prospects.data?.find(x => x.id === id); setF({ ...f, prospectId: id }); setConsent({ ...consent, phone: p?.phone ?? "" }); };
  const sp = (s: Scenario, label: string, v: string, o: { hl?: boolean } = {}) => <tr key={label} style={o.hl ? { background: "var(--success, #34A853)", color: "#fff" } : undefined}><td>{label}</td><td style={{ textAlign: "right" }}>{v}</td></tr>;
  return (
    <>
      <h1>Simulations de salaire</h1>
      <div className="alert a-warning" role="note"><span>Estimation <b>non contractuelle</b> : ce n’est ni un bulletin de paie ni un engagement. Les taux (frais de gestion, ratio net/brut, grille de prélèvement à la source, jours) viennent des <b>paramètres approuvés</b> de la société ; s’ils manquent, la simulation est refusée. Le document est réservé au destinataire.</span></div>
      <div className="split">
        <div className="main stack" style={{ gap: 16 }}>
          <section className="card" aria-labelledby="s-new">
            <div className="card-h"><h2 id="s-new">Nouvelle simulation</h2></div>
            <form className="card-b stack" onSubmit={e => { e.preventDefault(); create.mutate(); }}>
              <div className="field"><label className="label" htmlFor="sp">Prospect destinataire (optionnel)</label>
                <select id="sp" className="input" value={f.prospectId} onChange={e => pickProspect(e.target.value)}><option value="">— sans prospect —</option>{prospects.data?.filter(p => p.kind === "consultant").map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                <div className="field"><label className="label" htmlFor="tjm">TJM (€)</label><input id="tjm" className="input" inputMode="decimal" value={f.tjm} onChange={upd("tjm")} required /></div>
                <div className="field"><label className="label" htmlFor="dpm">Jours travaillés / mois</label><input id="dpm" className="input" inputMode="decimal" value={f.daysPerMonth} onChange={upd("daysPerMonth")} required /></div>
                <div className="field"><label className="label" htmlFor="mu">Mutuelle / mois (€)</label><input id="mu" className="input" inputMode="decimal" value={f.mutualMonthly} onChange={upd("mutualMonthly")} required /></div>
              </div>
              <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                {([["g1", "e1"], ["g2", "e2"], ["g3", "e3"]] as const).map(([g, e], i) => <div className="stack" key={g} style={{ gap: 8 }}>
                  <div className="field"><label className="label" htmlFor={g}>Scénario {i + 1} — brut annuel (€)</label><input id={g} className="input" inputMode="decimal" value={f[g]} onChange={upd(g)} required={i === 0} /></div>
                  <div className="field"><label className="label" htmlFor={e}>Scénario {i + 1} — frais forfaitaires / jour (€)</label><input id={e} className="input" inputMode="decimal" value={f[e]} onChange={upd(e)} required={!!f[g]} /></div></div>)}
              </div>
              <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                <div className="field"><label className="label" htmlFor="cn">Contact affiché (nom)</label><input id="cn" className="input" value={f.cName} onChange={upd("cName")} placeholder="par défaut : votre e-mail" /></div>
                <div className="field"><label className="label" htmlFor="cp">Téléphone</label><input id="cp" className="input" value={f.cPhone} onChange={upd("cPhone")} /></div>
                <div className="field"><label className="label" htmlFor="ce">E-mail</label><input id="ce" className="input" type="email" value={f.cEmail} onChange={upd("cEmail")} /></div>
              </div>
              <ErrorBox error={create.error} prefix="Simulation impossible" />
              <div><button className="btn btn-primary" disabled={create.isPending}>{create.isPending ? "Calcul…" : "Générer la simulation"}</button></div>
            </form>
          </section>

          {cur && (
            <section className="card" aria-labelledby="s-res">
              <div className="card-h"><h2 id="s-res">Résultat{cur.recipient ? ` — ${cur.recipient}` : ""}</h2><span className="badge b-warning">Estimation</span></div>
              <div className="card-b stack">
                {cur.scenarios.map((s, i) => (
                  <table key={i} className="table" aria-label={`Scénario ${i + 1}`}><tbody>
                    {sp(s, "Frais professionnels", nf(s.professionalExpenses))}{sp(s, "Salaire brut annuel", nf(s.grossAnnual))}{sp(s, "Salaire brut mensuel", nf(s.grossMonthly))}
                    {sp(s, "Salaire NET avant PAS", nf(s.netBeforePas))}{sp(s, "Taux impôt à la source", `${Number(s.pasRatePercent).toLocaleString("fr-FR")} %`)}{sp(s, "Salaire NET après PAS", nf(s.netAfterPas))}
                    {sp(s, "Montant NET perçu chaque mois après impôts (net après impôts + frais + mutuelle)", nf(s.netPaidMonthly), { hl: true })}
                    {sp(s, `Par jour de congé non pris (sur ${s.paidLeaveDays} j) : salaire + frais`, `${nf(s.salaryPerLeaveDay)} + ${nf(s.expensesPerLeaveDay)} = ${nf(s.totalPerLeaveDay)}`)}{sp(s, `Montant supplémentaire si ${s.paidLeaveDays} jours non pris`, nf(s.extraForUntakenLeave))}
                    <tr className="muted small"><td>Indicateur interne (non transmis) : enveloppe restante</td><td style={{ textAlign: "right" }}>{nf(s.internalRemainingEnvelope)}</td></tr>
                  </tbody></table>
                ))}
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button className="btn" onClick={async () => setDlErr(await downloadFile(`/api/simulations/${cur.id}/pdf`, "simulation.pdf"))}>Télécharger le PDF</button>
                  <button className="btn btn-primary" disabled={!f.prospectId || send.isPending} title={f.prospectId ? undefined : "Choisissez un prospect destinataire"} onClick={() => { setNotice(null); send.mutate(); }}>{send.isPending ? "Envoi…" : "Envoyer par WhatsApp"}</button>
                </div>
                {dlErr && <div className="alert a-danger" role="alert">{dlErr}</div>}
                {notice && <div className="alert a-success" role="status">{notice}</div>}
                {send.error && !noConsent && <ErrorBox error={send.error} prefix="Envoi impossible" />}
                {noConsent && (
                  <div className="alert a-warning" role="alert">
                    <div><b>Aucun consentement WhatsApp pour ce prospect.</b> Recueillez son accord (avec preuve) avant tout envoi ; il peut le retirer à tout moment en répondant STOP.</div>
                    <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                      <input className="input" aria-label="Numéro WhatsApp" placeholder="+33 6 12 34 56 78" value={consent.phone} onChange={e => setConsent({ ...consent, phone: e.target.value })} />
                      <select className="input" aria-label="Origine du consentement" value={consent.source} onChange={e => setConsent({ ...consent, source: e.target.value })}>{Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                      <input className="input" aria-label="Preuve" placeholder="Preuve (date, canal…)" value={consent.evidence} onChange={e => setConsent({ ...consent, evidence: e.target.value })} />
                      <button className="btn" disabled={!consent.phone || grant.isPending} onClick={() => grant.mutate()}>Enregistrer le consentement</button>
                    </div>
                    <ErrorBox error={grant.error} prefix="Consentement refusé" />
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
        <aside className="side">
          <section className="card" aria-labelledby="s-h"><div className="card-h"><h2 id="s-h">Historique</h2></div>
            <div className="card-b stack">
              {history.data?.length === 0 && <div className="muted">Aucune simulation.</div>}
              {history.data?.map(h => <button key={h.id} className="btn btn-ghost" style={{ textAlign: "left" }} onClick={() => { setCur(h); setNotice(null); if (h.prospectId) pickProspect(h.prospectId); }}>
                <b>{h.recipient ?? "Sans prospect"}</b><div className="small muted">{fmtDateTime(h.createdAt)} · TJM {nf(h.scenarios[0]!.variables.tjm)} · {h.scenarios.length} scénario(s)</div></button>)}
            </div></section>
        </aside>
      </div>
    </>
  );
}
