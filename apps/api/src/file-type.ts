export const ALLOWED_MIME = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;
export type AllowedMime = (typeof ALLOWED_MIME)[number];
const EXT: Record<AllowedMime, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** Type réel déduit de la SIGNATURE BINAIRE (jamais du type MIME ni de l'extension annoncés par le client). */
export function detectMime(b: Buffer): AllowedMime | null {
  if (b.length >= 5 && b.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}
/** Nom de fichier assaini (pas de chemin, pas de caractère de contrôle), extension imposée par le type réel. */
export function safeName(original: string, mime: AllowedMime): string {
  const base = (original.split(/[\\/]/).pop() ?? "document").replace(/\.[A-Za-z0-9]{1,6}$/, "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._ ()-]/g, "_").replace(/^[.\s]+/, "").slice(0, 80).trim() || "document";
  return `${base}.${EXT[mime]}`;
}
