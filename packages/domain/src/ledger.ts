import { Money } from "./money.js";

export interface JournalLine { account: string; debit: Money; credit: Money; ref?: string }
export interface JournalEntry {
  id: string; tenantId: string; consultantId?: string; valueDate: string;
  lines: JournalLine[]; reversalOf?: string; sourceDocument?: string;
}

/** Journal append-only: pas de mise à jour, corrections par contrepassation. */
export class Ledger {
  private entries: JournalEntry[] = [];

  post(e: JournalEntry): void {
    if (this.entries.some(x => x.id === e.id)) throw new Error("Écriture déjà enregistrée (idempotence)");
    if (e.lines.length < 2) throw new Error("Une écriture exige au moins deux lignes");
    const d = e.lines.reduce((s, l) => s.add(l.debit), Money.zero());
    const c = e.lines.reduce((s, l) => s.add(l.credit), Money.zero());
    if (!d.eq(c)) throw new Error(`Écriture déséquilibrée: débit ${d} ≠ crédit ${c}`);
    this.entries.push(Object.freeze({ ...e, lines: Object.freeze([...e.lines]) as JournalLine[] }));
  }

  reverse(id: string, newId: string, valueDate: string): JournalEntry {
    const o = this.entries.find(x => x.id === id);
    if (!o) throw new Error("Écriture introuvable");
    if (this.entries.some(x => x.reversalOf === id)) throw new Error("Déjà contrepassée");
    const rev: JournalEntry = { ...o, id: newId, valueDate, reversalOf: id,
      lines: o.lines.map(l => ({ ...l, debit: l.credit, credit: l.debit })) };
    this.post(rev);
    return rev;
  }

  balance(account: string, tenantId: string, consultantId?: string): Money {
    return this.entries
      .filter(e => e.tenantId === tenantId && (!consultantId || e.consultantId === consultantId))
      .flatMap(e => e.lines).filter(l => l.account === account)
      .reduce((s, l) => s.add(l.debit).sub(l.credit), Money.zero());
  }
  all(): readonly JournalEntry[] { return this.entries; }
}
