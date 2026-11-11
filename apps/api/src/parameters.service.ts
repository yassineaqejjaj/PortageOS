import { Injectable } from "@nestjs/common";
import { ParameterCatalog } from "@portage/domain";
import { Tx } from "./prisma.service";

/** Lecture des paramètres APPROUVÉS en vigueur à une date. Aucune valeur par défaut : absent = null (l'appelant refuse ou signale). */
@Injectable()
export class ParametersService {
  async at(tx: Tx, key: string, date: string): Promise<{ id: string; key: string; value: string; unit: string; source: string; validFrom: string } | null> {
    const rows = await tx.ruleParameter.findMany({ where: { key, status: "approved" } });
    const cat = new ParameterCatalog();
    for (const r of rows) cat.add({ key: r.key, value: r.id, validFrom: r.validFrom.toISOString().slice(0, 10), validTo: r.validTo?.toISOString().slice(0, 10), source: r.source, status: "approved", approvedBy: r.approvedBy! });
    try {
      const hit = cat.at(key, date);
      const r = rows.find(x => x.id === hit.value)!;
      return { id: r.id, key: r.key, value: r.value, unit: r.unit, source: r.source, validFrom: hit.validFrom };
    } catch { return null; }
  }

  /** Tous les paramètres approuvés dont la clé commence par `prefix`, en vigueur à `date` (clé → ligne). */
  async atPrefix(tx: Tx, prefix: string, date: string) {
    const keys = [...new Set((await tx.ruleParameter.findMany({ where: { key: { startsWith: prefix }, status: "approved" }, select: { key: true } })).map(r => r.key))];
    const out = new Map<string, { id: string; key: string; value: string; unit: string; source: string; validFrom: string }>();
    for (const k of keys) { const p = await this.at(tx, k, date); if (p) out.set(k, p); }
    return out;
  }
}
