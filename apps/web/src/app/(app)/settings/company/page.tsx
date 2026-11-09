"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorBox, Forbidden, isForbidden } from "@/lib/ui";

type P = { legalName: string; legalForm: string | null; siren: string | null; vatNumber: string | null; address: string | null; postalCode: string | null; city: string | null; iban: string | null };
const FIELDS: [keyof P, string, string?][] = [["legalName", "Raison sociale"], ["legalForm", "Forme juridique"], ["siren", "SIREN", "9 chiffres"], ["vatNumber", "N° de TVA intracommunautaire"], ["address", "Adresse"], ["postalCode", "Code postal"], ["city", "Ville"], ["iban", "IBAN", "Sans espaces, en majuscules"]];
export default function CompanyProfilePage() {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ["tenant-profile"], queryFn: () => api<{ profile: P | null; complete: boolean }>("tenant/profile") });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ permissions: string[] }>("me") }); const canWrite = !!me.data?.permissions.includes("member.manage");
  const [f, setF] = useState<Record<string, string>>({}); useEffect(() => { if (q.data?.profile) setF(Object.fromEntries(Object.entries(q.data.profile).map(([k, v]) => [k, v ?? ""]))); }, [q.data]);
  const save = useMutation({ mutationFn: () => api("tenant/profile", { method: "PUT", body: Object.fromEntries(Object.entries(f).filter(([k]) => FIELDS.some(x => x[0] === k))) }), onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant-profile"] }) });
  if (isForbidden(q.error)) return <><h1>Identité de la société</h1><Forbidden what="l'identité de la société" /></>;
  return (
    <>
      <h1>Identité de la société</h1>
      <div className="alert a-info" role="note"><span>Ces informations figurent sur les factures PDF. Elles sont saisies par vous : la plateforme n'en vérifie pas l'exactitude (Sirene non connecté) et n'invente aucune mention légale.</span></div>
      {q.data && <div className={`alert ${q.data.complete ? "a-success" : "a-warning"}`} role="status"><span>{q.data.complete ? "Mentions du vendeur complètes (raison sociale, SIREN, adresse)." : "Mentions incomplètes : les PDF seront marqués « document de travail »."}</span></div>}
      <form className="card" onSubmit={e => { e.preventDefault(); save.mutate(); }} aria-labelledby="idt" style={{ maxWidth: 560 }}>
        <div className="card-h"><h2 id="idt">Vendeur</h2></div>
        <div className="card-b stack" style={{ gap: 14 }}>
          {FIELDS.map(([k, l, h]) => <div className="field" key={k}><label className="label" htmlFor={`f-${k}`}>{l}</label><input id={`f-${k}`} className="input" value={f[k] ?? ""} onChange={e => setF({ ...f, [k]: e.target.value })} required={k === "legalName"} disabled={!canWrite} />{h && <span className="hint">{h}</span>}</div>)}
          <ErrorBox error={save.error} prefix="Enregistrement impossible" />{save.isSuccess && <div className="alert a-success" role="status"><span>Identité enregistrée.</span></div>}
        </div>
        {canWrite ? <div className="card-f"><button className="btn btn-primary" type="submit" disabled={save.isPending}>Enregistrer</button></div> : <div className="card-f small muted">Lecture seule : seul un administrateur modifie l'identité de la société.</div>}
      </form>
    </>
  );
}
