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
    ["admin@demo.test", ["tenant_admin"], {}], ["commerce@demo.test", ["commerce"], {}], ["ops@demo.test", ["operations"], {}], ["finance@demo.test", ["finance"], {}], ["hr@demo.test", ["hr"], {}], ["direction@demo.test", ["direction"], {}], ["accountant@demo.test", ["external_accountant"], {}], ["compliance@demo.test", ["compliance"], {}],
    ["consultant@demo.test", ["consultant"], { consultantId: consultant.id }], ["client@demo.test", ["client_user"], { companyId: company.id }],
  ];
  for (const [email, roles, link] of users) {
    const user = await db.user.upsert({ where: { email }, update: {}, create: { email, passwordHash: await hashPassword(pw) } });
    await db.membership.upsert({ where: { userId_tenantId: { userId: user.id, tenantId } }, update: { roles, ...link }, create: { userId: user.id, tenantId, roles, ...link } });
  }
  // Démo : tenant d'exploitation de la plateforme + un exploitant fictif (MFA non imposé ICI uniquement pour les tests E2E ; en production, le tenant plateforme est créé par bootstrap avec MFA obligatoire).
  if (!(await db.tenant.findFirst({ where: { isPlatform: true } }))) {
    // isPlatform est immuable (trigger) : on ne peut le poser qu'à la création.
    if (!(await db.tenant.findUnique({ where: { slug: "plateforme-demo" } }))) await db.tenant.create({ data: { slug: "plateforme-demo", name: "Exploitation plateforme (démo)", isPlatform: true } });
  }
  const platT = await db.tenant.findFirst({ where: { isPlatform: true } });
  if (platT) {
    const op = await db.user.upsert({ where: { email: "operator@demo.test" }, update: { passwordHash: await hashPassword(pw) }, create: { email: "operator@demo.test", passwordHash: await hashPassword(pw) } });
    await db.membership.upsert({ where: { userId_tenantId: { userId: op.id, tenantId: platT.id } }, update: { roles: ["tenant_admin"] }, create: { userId: op.id, tenantId: platT.id, roles: ["tenant_admin"] } });
  }
  // Démo : budget quotidien d'exécutions relevé pour permettre les tests répétés (valeur par défaut en production : 20).
  for (const agentKey of ["onboarding", "contract", "operations", "finance", "consultant"]) await db.agentConfig.upsert({ where: { tenantId_agentKey: { tenantId, agentKey } }, update: { maxRunsPerDay: 500 }, create: { tenantId, agentKey, maxRunsPerDay: 500 } });
  await db.$disconnect();
  console.log("Seed démo OK (tenant 'demo').");
}
main();
