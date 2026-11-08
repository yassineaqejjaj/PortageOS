import { z } from "zod";
import { Permission } from "./permissions";

export type ToolKind = "read" | "write";
export interface ToolDef { name: string; kind: ToolKind; permission: Permission; input: z.ZodTypeAny; description: string }

const uuid = z.string().uuid();
const empty = z.object({}).strict();
/** Outils strictement typés. Lecture et écriture sont distinctes ; une écriture n'est jamais exécutée par l'agent : elle devient une PROPOSITION soumise à approbation humaine. */
export const TOOLS: Record<string, ToolDef> = {
  read_timesheets_status: { name: "read_timesheets_status", kind: "read", permission: "timesheet.read", input: z.object({ period: z.string().regex(/^\d{4}-\d{2}$/).optional() }).strict(), description: "CRA par statut (période optionnelle)" },
  read_expenses_pending: { name: "read_expenses_pending", kind: "read", permission: "expense.read", input: empty, description: "Notes de frais à approuver" },
  read_leaves_pending: { name: "read_leaves_pending", kind: "read", permission: "leave.read", input: empty, description: "Demandes d'absence en attente" },
  read_validated_timesheets_uninvoiced: { name: "read_validated_timesheets_uninvoiced", kind: "read", permission: "invoice.read", input: empty, description: "CRA validés sans facture, avec montants calculés" },
  read_consultants_onboarding: { name: "read_consultants_onboarding", kind: "read", permission: "consultant.read", input: empty, description: "Dossiers en onboarding et tâches manquantes" },
  read_contracts_pending: { name: "read_contracts_pending", kind: "read", permission: "contract.read", input: z.object({ olderThanDays: z.number().int().min(0).max(365) }).strict(), description: "Contrats brouillon/envoyés depuis plus de N jours" },
  read_my_summary: { name: "read_my_summary", kind: "read", permission: "portal.self", input: empty, description: "Synthèse du dossier du consultant connecté (jamais celui d'un autre)" },
  propose_validate_timesheet: { name: "propose_validate_timesheet", kind: "write", permission: "timesheet.write", input: z.object({ timesheetId: uuid }).strict(), description: "Proposer la validation interne d'un CRA approuvé par le client" },
  propose_invoice: { name: "propose_invoice", kind: "write", permission: "invoice.write", input: z.object({ timesheetId: uuid }).strict(), description: "Proposer la préparation d'une facture brouillon pour un CRA validé" },
};

export interface PlaybookDef { key: string; label: string; description: string; permissions: Permission[]; params: z.ZodTypeAny; selfService?: boolean }
export interface AgentDef { key: string; name: string; description: string; allowedTools: string[]; playbooks: PlaybookDef[]; available: boolean; unavailableReason?: string }

export const AGENTS: AgentDef[] = [
  { key: "onboarding", name: "Onboarding Agent", description: "Contrôle de complétude des dossiers consultants (lecture seule).", allowedTools: ["read_consultants_onboarding"], available: true,
    playbooks: [{ key: "completeness_check", label: "Contrôler la complétude des dossiers", description: "Liste les tâches d'onboarding manquantes par consultant.", permissions: ["consultant.read"], params: z.object({}).strict() }] },
  { key: "contract", name: "Contract Agent", description: "Suivi des contrats en attente (lecture seule).", allowedTools: ["read_contracts_pending"], available: true,
    playbooks: [{ key: "followup", label: "Suivre les contrats en attente", description: "Contrats brouillon ou envoyés depuis plus de N jours.", permissions: ["contract.read"], params: z.object({ olderThanDays: z.number().int().min(0).max(365).default(7) }).strict() }] },
  { key: "operations", name: "Operations Agent", description: "Préparation de la clôture : bloqueurs CRA, frais, absences ; propose les validations de CRA.", allowedTools: ["read_timesheets_status", "read_expenses_pending", "read_leaves_pending", "propose_validate_timesheet"], available: true,
    playbooks: [{ key: "closing_check", label: "Préparer la clôture", description: "Détecte ce qui bloque la clôture et propose la validation interne des CRA approuvés par les clients.", permissions: ["timesheet.read", "expense.read", "leave.read"], params: z.object({ period: z.string().regex(/^\d{4}-\d{2}$/).optional() }).strict() }] },
  { key: "finance", name: "Finance Agent", description: "Préparation des factures à partir des CRA validés.", allowedTools: ["read_validated_timesheets_uninvoiced", "propose_invoice"], available: true,
    playbooks: [{ key: "invoice_preparation", label: "Préparer les factures", description: "Propose une facture brouillon par CRA validé non facturé (montants calculés par le serveur).", permissions: ["invoice.read", "invoice.write"], params: z.object({}).strict() }] },
  { key: "payroll", name: "Payroll Agent", description: "Contrôle des variables de paie et explication des écarts.", allowedTools: [], available: false, unavailableReason: "Aucun prestataire de paie n'est connecté : ni variables de paie ni runs à comparer.", playbooks: [] },
  { key: "consultant", name: "Consultant Agent", description: "Synthèse du dossier du consultant connecté (son seul périmètre).", allowedTools: ["read_my_summary"], available: true,
    playbooks: [{ key: "my_summary", label: "Ma synthèse", description: "Solde de congés, CRA et notes de frais en cours.", permissions: ["portal.self"], params: z.object({}).strict(), selfService: true }] },
];
export const agentByKey = (k: string) => AGENTS.find(a => a.key === k);

/** Défense en profondeur : un agent ne peut appeler QUE les outils de sa liste blanche. */
export function assertToolAllowed(agentKey: string, tool: string): ToolDef {
  const a = agentByKey(agentKey); const t = TOOLS[tool];
  if (!a || !t || !a.allowedTools.includes(tool)) throw new Error(`Outil non autorisé pour l'agent ${agentKey} : ${tool}`);
  return t;
}
export const LLM_STATUS = { status: "not_connected", note: "Aucun fournisseur LLM n'est connecté : les agents exécutent des playbooks déterministes. Un planificateur en langage naturel, la recherche documentaire (RAG) et l'évaluation de modèles ne sont pas implémentés." } as const;
