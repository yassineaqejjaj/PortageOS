"use client";
import { ApiError } from "./api";

export const nf = (v: string | number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(v));
export const dayFmt = (v: string | number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(Number(v));

export function Forbidden({ what }: { what: string }) {
  return <div className="alert a-warning" role="alert"><span>Accès refusé : votre rôle ne permet pas de consulter {what}.</span></div>;
}
export function ErrorBox({ error, prefix }: { error: unknown; prefix: string }) {
  if (!error) return null;
  return <div className="alert a-danger" role="alert"><span>{prefix} : {(error as Error).message}</span></div>;
}
export const isForbidden = (e: unknown) => e instanceof ApiError && e.status === 403;

/** Statut = forme + libellé + couleur (jamais la couleur seule). */
export const TS_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Brouillon", cls: "b-neutral" }, submitted: { label: "À valider par le client", cls: "b-info" },
  client_approved: { label: "Validé par le client", cls: "b-warning" }, client_rejected: { label: "Refusé par le client", cls: "b-danger" },
  validated: { label: "Validé en interne", cls: "b-success" }, invoiced: { label: "Facturé", cls: "b-success" },
};
export const INV_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Brouillon", cls: "b-neutral" }, issued: { label: "Émise", cls: "b-info" }, partially_paid: { label: "Partiellement payée", cls: "b-warning" },
  paid: { label: "Payée", cls: "b-success" }, cancelled: { label: "Annulée", cls: "b-danger" }, credited: { label: "Avoir émis", cls: "b-danger" },
};
export function Badge({ map, value }: { map: Record<string, { label: string; cls: string }>; value: string }) {
  const s = map[value] ?? { label: value, cls: "b-neutral" };
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

export type Claim = { id: string; title: string; status: string; total: string; rejectReason: string | null; lines: { id: string; date: string; category: string; description: string; amount: string; km: string | null; receiptRef: string | null; policyFlag: string | null }[] };
export const EXP_STATUS: Record<string, { label: string; cls: string }> = { draft: { label: "Brouillon", cls: "b-neutral" }, submitted: { label: "À approuver", cls: "b-info" }, approved: { label: "Approuvée", cls: "b-warning" }, rejected: { label: "Refusée", cls: "b-danger" }, reimbursed: { label: "Remboursée", cls: "b-success" } };

export type Leave = { id: string; consultant?: string; type: string; startDate: string; endDate: string; halfStart: boolean; halfEnd: boolean; days: string; status: string; reason: string | null; rejectReason: string | null; holidaysConfigured: boolean };
export const LEAVE_TYPE: Record<string, string> = { paid_leave: "Congé payé", sick: "Arrêt maladie", unpaid: "Congé sans solde", other: "Autre absence" };
export const LEAVE_STATUS: Record<string, { label: string; cls: string }> = { submitted: { label: "En attente", cls: "b-info" }, approved: { label: "Approuvée", cls: "b-success" }, rejected: { label: "Refusée", cls: "b-danger" }, cancelled: { label: "Annulée", cls: "b-neutral" } };
