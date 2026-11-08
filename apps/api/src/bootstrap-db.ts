/**
 * Démarrage production : active la connexion du rôle applicatif `portage_app` (créé NOLOGIN par migration)
 * avec le mot de passe APP_DB_PASSWORD. Exécuté avec le rôle propriétaire (DATABASE_URL).
 */
import { PrismaClient } from "@prisma/client";

async function main() {
  const pw = process.env.APP_DB_PASSWORD ?? "";
  if (!/^[A-Za-z0-9_-]{24,}$/.test(pw)) throw new Error("APP_DB_PASSWORD requis : >= 24 caractères [A-Za-z0-9_-]");
  const db = new PrismaClient();
  try {
    await db.$executeRawUnsafe(`ALTER ROLE portage_app LOGIN PASSWORD '${pw}'`); // pw validé par regex ci-dessus
    console.log("rôle portage_app prêt");
  } finally { await db.$disconnect(); }
}
main().catch(e => { console.error(e.message); process.exit(1); });
