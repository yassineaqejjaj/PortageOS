import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { Tx } from "./prisma.service";

/** Plan comptable par défaut (comptes PCG usuels) — configurable par tenant dans un lot ultérieur. */
export const ACCOUNTS = { clients: "411", prestations: "706", tvaCollectee: "44571", banque: "512", fraisDeplacement: "6251" } as const;

/** Plan comptable par défaut (comptes usuels) — créé à la première écriture, à valider et compléter par l'expert-comptable. */
export const DEFAULT_CHART = [
  { code: "411", label: "Clients", type: "asset" }, { code: "512", label: "Banque", type: "asset" },
  { code: "44571", label: "TVA collectée", type: "liability" }, { code: "706", label: "Prestations de services", type: "revenue" },
  { code: "6251", label: "Voyages et déplacements", type: "expense" },
];
export async function ensureChart(tx: Tx, tenantId: string) {
  if ((await tx.account.count()) === 0) await tx.account.createMany({ data: DEFAULT_CHART.map(a => ({ tenantId, ...a, system: true })), skipDuplicates: true });
}

export interface PostInput { reason?: string; tenantId: string; key: string; label: string; valueDate: string; sourceType: string; sourceId: string; consultantId?: string; reversalOf?: string; lines: { account: string; debit?: string; credit?: string }[] }

@Injectable()
export class LedgerService {
  /** Écriture append-only, idempotente par clé; l'équilibre est de plus imposé par un trigger en base. */
  async post(tx: Tx, e: PostInput) {
    await ensureChart(tx, e.tenantId);
    const codes = [...new Set(e.lines.map(l => l.account))];
    const known = await tx.account.findMany({ where: { code: { in: codes }, active: true }, select: { code: true } });
    const missing = codes.filter(c => !known.some(k => k.code === c));
    if (missing.length) throw new BadRequestException(`Compte inconnu ou inactif : ${missing.join(", ")}`);
    const period = e.valueDate.slice(0, 7);
    if (await tx.closingPeriod.findFirst({ where: { period, status: "closed" } })) throw new ConflictException(`Période comptable ${period} close : utilisez une date dans une période ouverte (écriture d'ajustement)`);
    const existing = await tx.journalEntry.findUnique({ where: { tenantId_key: { tenantId: e.tenantId, key: e.key } } });
    if (existing) throw new ConflictException("Écriture déjà passée (idempotence)");
    const lines = e.lines.filter(l => Number(l.debit ?? 0) > 0 || Number(l.credit ?? 0) > 0);
    return tx.journalEntry.create({ data: {
      tenantId: e.tenantId, key: e.key, label: e.label, valueDate: new Date(e.valueDate), sourceType: e.sourceType, sourceId: e.sourceId,
      consultantId: e.consultantId, reversalOf: e.reversalOf, reason: e.reason,
      lines: { create: lines.map(l => ({ tenantId: e.tenantId, account: l.account, debit: l.debit ?? "0", credit: l.credit ?? "0" })) } }, include: { lines: true } });
  }
}
