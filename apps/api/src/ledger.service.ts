import { ConflictException, Injectable } from "@nestjs/common";
import { Tx } from "./prisma.service";

/** Plan comptable par défaut (comptes PCG usuels) — configurable par tenant dans un lot ultérieur. */
export const ACCOUNTS = { clients: "411", prestations: "706", tvaCollectee: "44571", banque: "512" } as const;

export interface PostInput { tenantId: string; key: string; label: string; valueDate: string; sourceType: string; sourceId: string; consultantId?: string; reversalOf?: string; lines: { account: string; debit?: string; credit?: string }[] }

@Injectable()
export class LedgerService {
  /** Écriture append-only, idempotente par clé; l'équilibre est de plus imposé par un trigger en base. */
  async post(tx: Tx, e: PostInput) {
    const existing = await tx.journalEntry.findUnique({ where: { tenantId_key: { tenantId: e.tenantId, key: e.key } } });
    if (existing) throw new ConflictException("Écriture déjà passée (idempotence)");
    const lines = e.lines.filter(l => Number(l.debit ?? 0) > 0 || Number(l.credit ?? 0) > 0);
    return tx.journalEntry.create({ data: {
      tenantId: e.tenantId, key: e.key, label: e.label, valueDate: new Date(e.valueDate), sourceType: e.sourceType, sourceId: e.sourceId,
      consultantId: e.consultantId, reversalOf: e.reversalOf,
      lines: { create: lines.map(l => ({ tenantId: e.tenantId, account: l.account, debit: l.debit ?? "0", credit: l.credit ?? "0" })) } }, include: { lines: true } });
  }
}
