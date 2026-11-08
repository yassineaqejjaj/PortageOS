/**
 * Catalogue de paramètres réglementaires datés (aucune constante légale en dur).
 * Chaque valeur a une période d'effet, une source officielle et un statut de validation humaine.
 */
export interface ParameterVersion<T = string> {
  key: string;
  value: T;
  validFrom: string; // ISO date incluse
  validTo?: string;  // ISO date incluse, absent = ouvert
  source: string;    // URL / référence officielle
  status: "draft" | "approved";
  approvedBy?: string;
}

export class ParameterCatalog {
  constructor(private versions: ParameterVersion[] = []) {}

  add(v: ParameterVersion) {
    if (v.status === "approved" && !v.approvedBy) throw new Error("Une version approuvée exige un approbateur");
    if (!v.source) throw new Error("Source officielle obligatoire");
    const clash = this.versions.some(o => o.key === v.key && o.status === "approved" && v.status === "approved"
      && overlaps(o.validFrom, o.validTo, v.validFrom, v.validTo));
    if (clash) throw new Error(`Chevauchement de périodes approuvées pour ${v.key}`);
    this.versions.push(v);
  }

  /** Valeur approuvée en vigueur à `date`; lève si absente (jamais de repli silencieux). */
  at(key: string, date: string): ParameterVersion {
    const v = this.versions.find(x => x.key === key && x.status === "approved"
      && x.validFrom <= date && (!x.validTo || date <= x.validTo));
    if (!v) throw new Error(`Aucun paramètre approuvé pour ${key} au ${date}`);
    return v;
  }
}

function overlaps(a1: string, a2: string | undefined, b1: string, b2: string | undefined) {
  return a1 <= (b2 ?? "9999-12-31") && b1 <= (a2 ?? "9999-12-31");
}
