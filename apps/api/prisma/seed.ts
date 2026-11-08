/** Seeds de DÉMONSTRATION (dev/test uniquement). Données fictives, jamais en production. */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/password";
import { DEFAULT_TASKS } from "../src/consultants.service";

async function main() {
  if (process.env.APP_ENV === "production") throw new Error("Seed démo interdit en production");
  const pw = process.env.DEMO_PASSWORD;
  if (!pw || pw.length < 12) throw new Error("DEMO_PASSWORD (>= 12 caractères) requis");
  const db = new PrismaClient();
  const tenant = await db.tenant.upsert({ where: { slug: "demo" }, update: {}, create: { slug: "demo", name: "Société de portage DEMO" } });
  const tenantId = tenant.id;

  let company = await db.company.findFirst({ where: { tenantId, name: "Banque Méridienne (fictive)" } });
  company ??= await db.company.create({ data: { tenantId, name: "Banque Méridienne (fictive)" } });

  let consultant = await db.consultant.findFirst({ where: { tenantId, lastName: "Moreau (fictive)" } });
  consultant ??= await db.consultant.create({ data: { tenantId, firstName: "Camille", lastName: "Moreau (fictive)", status: "active",
    tasks: { create: DEFAULT_TASKS.map(t => ({ tenantId, ...t, doneAt: new Date(), doneBy: "seed" })) } } });

  const hasMission = await db.mission.findFirst({ where: { tenantId, consultantId: consultant.id } });
  if (!hasMission) await db.mission.create({ data: { tenantId, consultantId: consultant.id, companyId: company.id, title: "Mission de démonstration", dailyRate: "650.00", vatRate: "20", startDate: new Date("2026-01-01") } });

  const users: [string, string[], { companyId?: string; consultantId?: string }][] = [
    ["admin@demo.test", ["tenant_admin"], {}], ["commerce@demo.test", ["commerce"], {}], ["ops@demo.test", ["operations"], {}], ["finance@demo.test", ["finance"], {}], ["hr@demo.test", ["hr"], {}], ["direction@demo.test", ["direction"], {}], ["compliance@demo.test", ["compliance"], {}],
    ["consultant@demo.test", ["consultant"], { consultantId: consultant.id }], ["client@demo.test", ["client_user"], { companyId: company.id }],
  ];
  for (const [email, roles, link] of users) {
    const user = await db.user.upsert({ where: { email }, update: {}, create: { email, passwordHash: await hashPassword(pw) } });
    await db.membership.upsert({ where: { userId_tenantId: { userId: user.id, tenantId } }, update: { roles, ...link }, create: { userId: user.id, tenantId, roles, ...link } });
  }
  // Démo : budget quotidien d'exécutions relevé pour permettre les tests répétés (valeur par défaut en production : 20).
  for (const agentKey of ["onboarding", "contract", "operations", "finance", "consultant"]) await db.agentConfig.upsert({ where: { tenantId_agentKey: { tenantId, agentKey } }, update: { maxRunsPerDay: 500 }, create: { tenantId, agentKey, maxRunsPerDay: 500 } });
  await db.$disconnect();
  console.log("Seed démo OK (tenant 'demo').");
}
main();
