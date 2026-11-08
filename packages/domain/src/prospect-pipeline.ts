import { StateMachine } from "./state-machine.js";

export const PROSPECT_STAGES = ["new", "contacted", "qualified", "converted", "lost"] as const;
export type ProspectStage = (typeof PROSPECT_STAGES)[number];
export interface ProspectContext { kind: "consultant" | "company"; hasContact: boolean; lostReason?: string }

const SALES = ["tenant_admin", "commerce"];

/** Workflow 1 (début): prospect -> contacté -> qualifié -> converti | perdu. Les étapes suivantes (inscription, contrat) viendront avec les modules concernés. */
export const prospectPipeline = new StateMachine<ProspectStage, ProspectContext>([
  { from: "new", to: "contacted", event: "contact", allowedRoles: SALES, guard: c => (c.hasContact ? null : "aucun moyen de contact (email ou téléphone)") },
  { from: "contacted", to: "qualified", event: "qualify", allowedRoles: SALES },
  { from: "qualified", to: "converted", event: "convert", allowedRoles: SALES },
  { from: "new", to: "lost", event: "lose", allowedRoles: SALES, guard: c => (c.lostReason ? null : "motif de perte obligatoire") },
  { from: "contacted", to: "lost", event: "lose", allowedRoles: SALES, guard: c => (c.lostReason ? null : "motif de perte obligatoire") },
  { from: "qualified", to: "lost", event: "lose", allowedRoles: SALES, guard: c => (c.lostReason ? null : "motif de perte obligatoire") },
  { from: "lost", to: "new", event: "reopen", allowedRoles: SALES },
]);
