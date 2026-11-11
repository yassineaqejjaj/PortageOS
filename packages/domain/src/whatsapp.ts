/**
 * WhatsApp : règles pures (aucune E/S). Les règles de la plateforme WhatsApp Business (fenêtre de service de 24 h,
 * messages modèles pré-approuvés par Meta hors fenêtre) sont paramétrées ici ; leur évolution est suivie dans docs/DECISIONS.md.
 */

/** Fenêtre de service : texte libre autorisé dans les 24 h suivant le dernier message ENTRANT du contact ; au-delà, modèle approuvé uniquement. */
export const WHATSAPP_SERVICE_WINDOW_HOURS = 24;

const E164 = /^\+[1-9]\d{7,14}$/;

/** Normalise un numéro en E.164. Accepte « +33 6 12 34 56 78 », « 0033612345678 » et la forme nationale française « 06 12 34 56 78 ». Retourne null si invalide. */
export function normalizePhone(raw: string): string | null {
  let s = raw.trim().replace(/[\s.\-()]/g, "");
  if (!s) return null;
  if (s.startsWith("00")) s = "+" + s.slice(2);
  else if (/^0[1-9]\d{8}$/.test(s)) s = "+33" + s.slice(1);
  return E164.test(s) ? s : null;
}

/** Vrai si un texte libre peut être envoyé : dernier message entrant il y a moins de 24 h. */
export function isWithinServiceWindow(lastInboundAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!lastInboundAt) return false;
  const ms = now.getTime() - lastInboundAt.getTime();
  return ms >= 0 && ms < WHATSAPP_SERVICE_WINDOW_HOURS * 3600_000;
}

const STOP_WORDS = new Set(["stop", "arret", "arrêt", "arreter", "arrêter", "desinscrire", "désinscrire", "desinscription", "désinscription", "unsubscribe"]);
/** Un message entrant composé uniquement d'un mot-clé d'arrêt vaut retrait du consentement (insensible à la casse, ponctuation ignorée). */
export function isStopKeyword(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!\s]+$/g, "");
  return STOP_WORDS.has(t);
}

export const WHATSAPP_SUBJECT_TYPES = ["consultant", "contact"] as const;
export type WhatsappSubjectType = (typeof WHATSAPP_SUBJECT_TYPES)[number];
export const WHATSAPP_CONSENT_SOURCES = ["written_form", "in_app", "inbound_message", "stop_keyword", "other"] as const;

/** Statuts de message, du plus faible au plus avancé ; « failed » est terminal. Un statut ne recule jamais (les webhooks arrivent dans le désordre). */
const RANK: Record<string, number> = { queued: 0, sending: 1, sent: 2, delivered: 3, read: 4 };
export function advanceStatus(current: string, incoming: string): string {
  if (current === "failed" || current === "not_connected" || current === "simulated") return current;
  if (incoming === "failed") return RANK[current] !== undefined && RANK[current]! >= RANK.delivered! ? current : "failed";
  if (RANK[incoming] === undefined) return current;
  return (RANK[incoming]! > (RANK[current] ?? -1)) ? incoming : current;
}

/** Catalogue des modèles métier. Le nom Meta (approuvé côté Meta) est déclaré par la société : le produit ne peut pas le vérifier. */
export const WHATSAPP_TEMPLATES = {
  timesheet_reminder: { label: "Relance de CRA", params: ["prenom", "periode", "mission"], suggestedName: "portage_cra_relance",
    preview: "Bonjour {{1}}, votre compte rendu d'activité {{2}} (mission {{3}}) est à saisir et soumettre." },
} as const;
export type WhatsappTemplateKey = keyof typeof WHATSAPP_TEMPLATES;
export const isTemplateKey = (k: string): k is WhatsappTemplateKey => Object.prototype.hasOwnProperty.call(WHATSAPP_TEMPLATES, k);

/** Texte lisible d'un modèle (pour l'historique) : substitue {{n}} par les paramètres. */
export function renderTemplatePreview(key: WhatsappTemplateKey, params: string[]): string {
  return WHATSAPP_TEMPLATES[key].preview.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? "");
}
