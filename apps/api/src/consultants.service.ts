import { Injectable } from "@nestjs/common";
import { Tx } from "./prisma.service";

export const DEFAULT_TASKS: { key: string; label: string; required: boolean }[] = [
  { key: "identity_document", label: "Pièce d'identité collectée", required: true },
  { key: "bank_details", label: "Coordonnées bancaires collectées", required: true },
  { key: "employment_contract_signed", label: "Contrat de travail signé", required: true },
  { key: "dpae_done", label: "DPAE effectuée (saisie manuelle, non connectée)", required: true },
  { key: "occupational_health", label: "Visite médicale planifiée", required: true },
  { key: "rc_pro", label: "Attestation RC Pro reçue", required: true },
];

@Injectable()
export class ConsultantsService {
  async create(tx: Tx, tenantId: string, d: { firstName: string; lastName: string; email?: string | null; sourceProspectId?: string }) {
    return tx.consultant.create({ data: { tenantId, firstName: d.firstName, lastName: d.lastName, email: d.email ?? null, sourceProspectId: d.sourceProspectId,
      tasks: { create: DEFAULT_TASKS.map(t => ({ tenantId, ...t })) } }, include: { tasks: true } });
  }
}
