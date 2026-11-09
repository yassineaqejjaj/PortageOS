import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

function key(): Buffer {
  const k = process.env.MFA_ENCRYPTION_KEY;
  if (!k) throw new Error("MFA_ENCRYPTION_KEY non configurée");
  const b = Buffer.from(k, "base64");
  if (b.length !== 32) throw new Error("MFA_ENCRYPTION_KEY doit encoder 32 octets (base64)");
  return b;
}
/** AES-256-GCM : v1.<iv>.<tag>.<texte chiffré> (base64url). */
export function seal(plain: string): string {
  const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}
export function open(sealed: string): string {
  const [v, iv, tag, ct] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("secret illisible");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url")); d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
