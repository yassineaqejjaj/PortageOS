/** Seeds de DÉMONSTRATION (dev/test uniquement). Données fictives, jamais en production. */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/password";

async function main() {
  if (process.env.APP_ENV === "production") throw new Error("Seed démo interdit en production");
  const pw = process.env.DEMO_PASSWORD;
  if (!pw || pw.length < 12) throw new Error("DEMO_PASSWORD (>= 12 caractères) requis");
  const db = new PrismaClient();
  const tenant = await db.tenant.upsert({ where: { slug: "demo" }, update: {}, create: { slug: "demo", name: "Société de portage DEMO" } });
  for (const [email, roles] of [["admin@demo.test", ["tenant_admin"]], ["consultant@demo.test", ["consultant"]], ["commerce@demo.test", ["commerce"]]] as const) {
    const user = await db.user.upsert({ where: { email }, update: {}, create: { email, passwordHash: await hashPassword(pw) } });
    await db.membership.upsert({ where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } }, update: {}, create: { userId: user.id, tenantId: tenant.id, roles: [...roles] } });
  }
  await db.$disconnect();
  console.log("Seed démo OK (tenant 'demo').");
}
main();
