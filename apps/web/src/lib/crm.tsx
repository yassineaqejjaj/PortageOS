"use client";
export type Band = "hot" | "warm" | "cold";
export const BAND: Record<Band, { label: string; cls: string }> = { hot: { label: "Chaud", cls: "b-danger" }, warm: { label: "Tiède", cls: "b-warning" }, cold: { label: "Froid", cls: "b-neutral" } };
export const INTERACTION: Record<string, string> = { call: "Appel", email: "Email", meeting: "Rendez-vous", note: "Note", other: "Autre" };
export const CAMPAIGN_STATUS: Record<string, { label: string; cls: string }> = { draft: { label: "Brouillon", cls: "b-neutral" }, active: { label: "Active", cls: "b-success" }, ended: { label: "Terminée", cls: "b-info" } };
export const CHANNEL: Record<string, string> = { email: "Email", phone: "Téléphone", event: "Événement", other: "Autre" };
export const COMMISSION_STATUS: Record<string, { label: string; cls: string }> = { accrued: { label: "Due", cls: "b-info" }, approved: { label: "Approuvée", cls: "b-warning" }, paid: { label: "Payée", cls: "b-success" }, cancelled: { label: "Annulée", cls: "b-neutral" } };
export const AGREEMENT_STATUS: Record<string, { label: string; cls: string }> = { draft: { label: "Brouillon", cls: "b-neutral" }, active: { label: "Actif", cls: "b-success" }, expired: { label: "Échu", cls: "b-danger" }, terminated: { label: "Résilié", cls: "b-neutral" } };
export function ScoreBadge({ score, band }: { score: number; band: Band }) {
  return <span className={`badge ${BAND[band].cls}`} title="Score indicatif d'aide à la priorisation, explicable, non décisionnel">{BAND[band].label} · {score}</span>;
}
export const SCORE_NOTE = "Score indicatif d'aide à la priorisation : il n'est pas une décision automatisée. Chaque point est justifié ci-dessous et les pondérations sont réglables par l'administrateur.";
