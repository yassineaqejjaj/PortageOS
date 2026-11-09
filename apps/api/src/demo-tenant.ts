/**
 * Société de DÉMONSTRATION en ligne (environnement de test déployé). Données entièrement fictives et marquées « (fictive) ».
 * Garde-fous : ALLOW_ONLINE_DEMO=1 explicite, slug commençant par « demo », mot de passe fourni (≥ 14 car.), idempotent,
 * n'écrit que dans son propre tenant. NE JAMAIS l'utiliser pour une société réelle (voir bootstrap-tenant.ts).
 * Usage : ALLOW_ONLINE_DEMO=1 DEMO_ONLINE_PASSWORD=... [DEMO_TENANT_SLUG=demo-en-ligne] node dist/demo-tenant.js
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "./password";
import { DEFAULT_TASKS } from "./consultants.service";

async function main() {
  const e = process.env; const slug = e.DEMO_TENANT_SLUG ?? "demo-en-ligne", pw = e.DEMO_ONLINE_PASSWORD;
  if (e.ALLOW_ONLINE_DEMO !== "1") throw new Error("ALLOW_ONLINE_DEMO=1 requis (démonstration explicite)");
  if (!/^demo[a-z0-9-]{0,40}$/.test(slug)) throw new Error("Le slug d'une société de démonstration doit commencer par « demo »");
  if (!pw || pw.length < 14) throw new Error("DEMO_ONLINE_PASSWORD (14 caractères minimum) requis");
  const db = new PrismaClient();
  try {
    const tenant = await db.tenant.upsert({ where: { slug }, update: {}, create: { slug, name: "Société de portage DÉMO (fictive)" } }); const tenantId = tenant.id;
    const company = (await db.company.findFirst({ where: { tenantId, name: "Banque Méridienne (fictive)" } })) ?? await db.company.create({ data: { tenantId, name: "Banque Méridienne (fictive)", paymentTermsDays: 30 } });
    const consultant = (await db.consultant.findFirst({ where: { tenantId, lastName: "Moreau (fictive)" } })) ?? await db.consultant.create({ data: { tenantId, firstName: "Camille", lastName: "Moreau (fictive)", status: "active",
      tasks: { create: DEFAULT_TASKS.map(t => ({ tenantId, ...t, doneAt: new Date(), doneBy: "demo" })) } } });
    if (!(await db.mission.findFirst({ where: { tenantId, consultantId: consultant.id } }))) await db.mission.create({ data: { tenantId, consultantId: consultant.id, companyId: company.id, title: "Mission de démonstration", dailyRate: "650.00", vatRate: "20", startDate: new Date("2026-01-01") } });
    const camp = (await db.campaign.findFirst({ where: { tenantId, name: "Campagne démo (fictive)" } })) ?? await db.campaign.create({ data: { tenantId, name: "Campagne démo (fictive)", kind: "consultants", channel: "event", status: "active", budget: "1000", createdBy: "demo" } });
    if ((await db.prospect.count({ where: { tenantId } })) === 0) for (const [name, stage, email] of [["Alex Durand (fictif)", "new", "alex.durand@example.test"], ["Sam Lefèvre (fictif)", "contacted", "sam.lefevre@example.test"], ["Jo Bernard (fictif)", "qualified", "jo.bernard@example.test"], ["Cabinet Horizon (fictif)", "contacted", "contact@horizon.example.test"]] as const)
      await db.prospect.create({ data: { tenantId, kind: name.startsWith("Cabinet") ? "company" : "consultant", name, email, stage, campaignId: camp.id, source: "démo" } });
    const users: [string, string[], { companyId?: string; consultantId?: string }][] = [
      ["admin", ["tenant_admin"], {}], ["commerce", ["commerce"], {}], ["ops", ["operations"], {}], ["finance", ["finance"], {}], ["hr", ["hr"], {}], ["direction", ["direction"], {}], ["compliance", ["compliance"], {}], ["accountant", ["external_accountant"], {}],
      ["consultant", ["consultant"], { consultantId: consultant.id }], ["client", ["client_user"], { companyId: company.id }]];
    const hash = await hashPassword(pw);
    for (const [local, roles, link] of users) {
      const email = `${local}@${slug}.test`;
      const user = await db.user.upsert({ where: { email }, update: {}, create: { email, passwordHash: hash } });
      await db.membership.upsert({ where: { userId_tenantId: { userId: user.id, tenantId } }, update: { roles, ...link }, create: { userId: user.id, tenantId, roles, ...link } });
    }
    await db.auditEvent.create({ data: { tenantId, actorId: "system", action: "tenant.demo_seeded", entity: "Tenant", entityId: tenantId } });
    console.log(`Société de démonstration '${slug}' prête (${users.length} comptes ${"<rôle>"}@${slug}.test).`);
  } finally { await db.$disconnect(); }
}
main().catch(err => { console.error(err.message); process.exit(1); });
