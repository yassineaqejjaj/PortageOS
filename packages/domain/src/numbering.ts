/**
 * Numérotation séquentielle sans trou par (tenant, série, année).
 * Contrat: l'implémentation persistante DOIT s'appuyer sur une transaction DB avec verrou
 * (UPDATE ... RETURNING sur une ligne de séquence). Cette version en mémoire sert de référence de test.
 */
export class InvoiceNumbering {
  private seq = new Map<string, number>();
  next(tenantId: string, series: string, year: number): string {
    const k = `${tenantId}|${series}|${year}`;
    const n = (this.seq.get(k) ?? 0) + 1;
    this.seq.set(k, n);
    return `${series}-${year}-${String(n).padStart(6, "0")}`;
  }
}
