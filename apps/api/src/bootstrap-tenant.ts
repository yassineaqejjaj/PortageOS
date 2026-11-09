/**
 * Création du premier tenant et de son administrateur (hors UI, une fois par société).
 * Usage : BOOTSTRAP_TENANT_SLUG=... BOOTSTRAP_TENANT_NAME=... BOOTSTRAP_ADMIN_EMAIL=... BOOTSTRAP_ADMIN_PASSWORD=... \
 *   [BOOTSTRAP_PLATFORM=1 pour le tenant d'exploitation de la plateforme] DATABASE_URL=<propriétaire> node dist/bootstrap-tenant.js
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "./password";

async function main() {
  const e = process.env;
  const slug = e.BOOTSTRAP_TENANT_SLUG, name = e.BOOTSTRAP_TENANT_NAME, email = e.BOOTSTRAP_ADMIN_EMAIL?.toLowerCase(), pw = e.BOOTSTRAP_ADMIN_PASSWORD;
  if (!slug || !/^[a-z0-9-]{2,50}$/.test(slug)) throw new Error("BOOTSTRAP_TENANT_SLUG invalide ([a-z0-9-], 2-50)");
  if (!name || !email || !pw) throw new Error("BOOTSTRAP_TENANT_NAME, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD requis");
  if (pw.length < 14) throw new Error("Mot de passe : 14 caractères minimum");
  const db = new PrismaClient();
  try {
    const platform = e.BOOTSTRAP_PLATFORM === "1"; // tenant d'exploitation (console opérateur) : MFA obligatoire, un seul possible
    const tenant = await db.tenant.create({ data: { slug, name, ...(platform ? { isPlatform: true, mfaRequired: true } : {}) } });
    const user = await db.user.upsert({ where: { email }, update: {}, create: { email, passwordHash: await hashPassword(pw) } });
    await db.membership.create({ data: { userId: user.id, tenantId: tenant.id, roles: ["tenant_admin"] } });
    await db.auditEvent.create({ data: { tenantId: tenant.id, actorId: user.id, action: platform ? "tenant.bootstrap_platform" : "tenant.bootstrap", entity: "Tenant", entityId: tenant.id } });
    console.log(`Tenant '${slug}' créé avec son administrateur.`);
  } finally { await db.$disconnect(); }
}
main().catch(err => { console.error(err.message); process.exit(1); });
