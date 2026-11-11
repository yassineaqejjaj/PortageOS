/**
 * Environnement de DÉMONSTRATION « BG Consulting » (société pilote) — données 100 % fictives.
 *
 * Joue le parcours complet À TRAVERS L'API (donc avec les machines d'état, droits, numérotation, journal et audit réels) :
 *   lead generation → qualification → conversion → onboarding → contrat signé → mission → CRA → validation client →
 *   facture → encaissement ; puis vie du consultant (CRA, notes de frais, congés), relances CRA WhatsApp et agents.
 *
 * Prérequis : API démarrée avec WHATSAPP_PROVIDER=fake (faux fournisseur LOCAL, n'envoie rien), WHATSAPP_APP_SECRET et
 * WHATSAPP_VERIFY_TOKEN définis (mêmes valeurs ici). Garde-fous : APP_ENV ≠ production, slug « demo… », idempotent (stoppe si déjà présent).
 *
 * Usage : DEMO_PASSWORD=... WHATSAPP_APP_SECRET=... pnpm -F @portage/api demo:bg
 */
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/password";

const API = process.env.API_URL ?? "http://localhost:3001";
const SLUG = process.env.DEMO_TENANT_SLUG ?? "demo-bgconsulting";
const DOMAIN = `${SLUG}.test`;
const PNID = "104000000000001"; // identifiant de numéro fictif (faux fournisseur)
const db = new PrismaClient();
const tok: Record<string, string> = {};
const out = { ok: 0, ko: [] as string[] };

async function api<T = any>(who: string | null, method: string, path: string, body?: unknown, expect: number[] = [200, 201]): Promise<T> {
  const res = await fetch(`${API}${path}`, { method, headers: { "content-type": "application/json", ...(who ? { Authorization: `Bearer ${tok[who]}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json: any; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!expect.includes(res.status)) throw new Error(`${method} ${path} → ${res.status} ${(json?.error?.message ?? json?.message ?? text).toString().slice(0, 200)}`);
  return json as T;
}
/** Exécute une étape ; un échec est consigné mais n'interrompt pas la démo. */
async function step<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try { const r = await fn(); out.ok++; return r; } catch (e) { out.ko.push(`${label} : ${(e as Error).message}`); console.warn(`  ✗ ${label} — ${(e as Error).message}`); return undefined; }
}
const log = (s: string) => console.log(`\n▸ ${s}`);

// ---------- utilitaires ----------
const sirenOk = (base8: string) => { for (let c = 0; c < 10; c++) { const s = base8 + c; let sum = 0; for (let i = 0; i < 9; i++) { let d = Number(s[8 - i]); if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } sum += d; } if (sum % 10 === 0) return s; } throw new Error("siren"); };
const pad = (n: number) => String(n).padStart(2, "0");
function weekdays(period: string, upTo?: string, skip: Set<string> = new Set()) {
  const [y, m] = period.split("-").map(Number) as [number, number]; const days: { date: string; quantity: string }[] = [];
  for (let d = 1; d <= new Date(Date.UTC(y, m, 0)).getUTCDate(); d++) {
    const iso = `${period}-${pad(d)}`; const w = new Date(`${iso}T00:00:00Z`).getUTCDay();
    if (w === 0 || w === 6 || skip.has(iso) || (upTo && iso > upTo)) continue; days.push({ date: iso, quantity: "1" });
  }
  return days;
}
const normPhone = (p: string) => p.replace(/\s/g, "");

// ---------- jeu de données ----------
const CLIENTS = [
  { key: "bm", name: "Banque Méridienne (fictive)", payDays: 30 },
  { key: "at", name: "Assurances Atlantis (fictive)", payDays: 45 },
  { key: "he", name: "Groupe Helios Énergie (fictive)", payDays: 30 },
] as const;
const TEAM: [string, string[]][] = [
  ["admin", ["tenant_admin"]], ["commerce", ["commerce"]], ["ops", ["operations"]], ["finance", ["finance"]], ["hr", ["hr"]], ["direction", ["direction"]], ["compliance", ["compliance"]], ["accountant", ["external_accountant"]],
];
const CONSULTANTS = [
  { key: "lea", first: "Léa", last: "Fontaine", title: "Data Engineer", client: "bm", rate: "720.00", phone: "+33639980001", active: true },
  { key: "karim", first: "Karim", last: "Benali", title: "Architecte Cloud", client: "at", rate: "850.00", phone: "+33639980002", active: true },
  { key: "ines", first: "Inès", last: "Moreau", title: "Cheffe de projet PMO", client: "he", rate: "680.00", phone: "+33639980003", active: true },
  { key: "thomas", first: "Thomas", last: "Girard", title: "Développeur Full-Stack", client: "bm", rate: "610.00", phone: "+33639980004", active: true },
  { key: "sofia", first: "Sofia", last: "Nguyen", title: "Data Analyst", client: "he", rate: "560.00", phone: "+33639980005", active: false },
] as const;

async function main() {
  if (process.env.APP_ENV === "production") throw new Error("Démo interdite en production");
  if (!/^demo[a-z0-9-]{0,40}$/.test(SLUG)) throw new Error("Le slug doit commencer par « demo »");
  const pw = process.env.DEMO_PASSWORD; if (!pw || pw.length < 12) throw new Error("DEMO_PASSWORD (≥ 12 caractères) requis");
  const secret = process.env.WHATSAPP_APP_SECRET; if (!secret) throw new Error("WHATSAPP_APP_SECRET requis (même valeur que l'API) pour simuler les messages entrants");
  if (await db.tenant.findUnique({ where: { slug: SLUG } })) { console.log(`Le tenant '${SLUG}' existe déjà : rien à faire (idempotent). Utiliser un autre DEMO_TENANT_SLUG pour une nouvelle démo.`); return; }
  await fetch(`${API}/health`).catch(() => { throw new Error(`API injoignable sur ${API}`); });

  // ===== 0. Société + équipe (seule étape hors API : l'API n'expose pas de création nue d'un tenant) =====
  log("0. Société BG Consulting et équipe interne");
  const tenant = await db.tenant.create({ data: { slug: SLUG, name: "BG Consulting (démo — fictive)" } });
  const hash = await hashPassword(pw);
  for (const [local, roles] of TEAM) { const u = await db.user.create({ data: { email: `${local}@${DOMAIN}`, passwordHash: hash } }); await db.membership.create({ data: { userId: u.id, tenantId: tenant.id, roles } }); }
  const login = async (key: string, email: string) => { tok[key] = (await api<{ accessToken: string }>(null, "POST", "/auth/login", { email, password: pw, tenantSlug: SLUG })).accessToken; };
  for (const [local] of TEAM) await login(local, `${local}@${DOMAIN}`);
  for (const a of ["onboarding", "contract", "operations", "finance", "consultant"]) await step(`budget agent ${a}`, () => api("admin", "PUT", `/agents/${a}/config`, { enabled: true, maxToolCallsPerRun: 200, maxRunsPerDay: 200 }));

  // ===== 1. Lead generation =====
  log("1. Lead generation : campagnes, prospects, interactions, tâches, apporteur");
  const campC = await api("commerce", "POST", "/crm/campaigns", { name: "Salon Data & Cloud Paris — automne 2026", kind: "consultants", channel: "event", budget: "4500.00", startDate: "2026-05-01" });
  const campE = await api("commerce", "POST", "/crm/campaigns", { name: "Prospection DSI grands comptes — 2026", kind: "companies", channel: "phone", budget: "2000.00", startDate: "2026-05-01" });
  for (const c of [campC, campE]) await step("campagne lancée", () => api("commerce", "POST", `/crm/campaigns/${c.id}/transition`, { event: "launch" }));
  const P = async (kind: string, name: string, email: string, phone: string | undefined, campaignId: string, source: string) => (await api("commerce", "POST", "/prospects", { kind, name, email, phone, campaignId, source }));
  const pc = {
    lea: await P("consultant", "Léa Fontaine", `lea.fontaine@${DOMAIN}`, "+33639980001", campC.id, "salon"),
    karim: await P("consultant", "Karim Benali", `karim.benali@${DOMAIN}`, "+33639980002", campC.id, "salon"),
    ines: await P("consultant", "Inès Moreau", `ines.moreau@${DOMAIN}`, "+33639980003", campC.id, "cooptation"),
    thomas: await P("consultant", "Thomas Girard", `thomas.girard@${DOMAIN}`, "+33639980004", campC.id, "salon"),
    sofia: await P("consultant", "Sofia Nguyen", `sofia.nguyen@${DOMAIN}`, "+33639980005", campC.id, "linkedin"),
  };
  const pe = {
    bm: await P("company", CLIENTS[0].name, `dsi@banque-meridienne.${DOMAIN}`, "+33139980010", campE.id, "appel sortant"),
    at: await P("company", CLIENTS[1].name, `achats@atlantis.${DOMAIN}`, "+33139980011", campE.id, "recommandation"),
    he: await P("company", CLIENTS[2].name, `dsi@helios.${DOMAIN}`, "+33139980012", campE.id, "appel sortant"),
  };
  // Entonnoir restant visible dans le CRM (non convertis)
  const funnel = [
    await P("consultant", "Paul Lambert (fictif)", `paul.lambert@${DOMAIN}`, undefined, campC.id, "salon"),
    await P("consultant", "Yasmine Haddad (fictive)", `yasmine.haddad@${DOMAIN}`, "+33639980020", campC.id, "linkedin"),
    await P("consultant", "Romain Vidal (fictif)", `romain.vidal@${DOMAIN}`, "+33639980021", campC.id, "salon"),
    await P("company", "Mutuelle Horizon (fictive)", `dsi@horizon.${DOMAIN}`, "+33139980013", campE.id, "appel sortant"),
    await P("company", "Logistique Nordia (fictive)", `rh@nordia.${DOMAIN}`, "+33139980014", campE.id, "salon"),
  ];
  const t = (id: string, event: string, extra: object = {}) => step(`prospect ${event}`, () => api("commerce", "POST", `/prospects/${id}/transition`, { event, ...extra }));
  await t(funnel[1].id, "contact"); await t(funnel[2].id, "contact"); await t(funnel[2].id, "qualify");
  await t(funnel[3].id, "contact"); await t(funnel[3].id, "qualify"); await t(funnel[4].id, "contact"); await t(funnel[4].id, "lose", { lostReason: "Pas de besoin avant 2027" });
  for (const p of Object.values(pc)) { await api("commerce", "POST", `/crm/prospects/${p.id}/interactions`, { type: "call", summary: "Premier échange : profil, disponibilité, prétentions de TJM." }); await t(p.id, "contact"); }
  for (const p of Object.values(pe)) { await api("commerce", "POST", `/crm/prospects/${p.id}/interactions`, { type: "meeting", summary: "Rendez-vous DSI : besoins en consultants data/cloud, process d'achat, délais de paiement." }); await t(p.id, "contact"); }
  await api("commerce", "POST", `/crm/prospects/${funnel[3].id}/interactions`, { type: "email", summary: "Envoi de la plaquette portage + simulation de rémunération." });
  const today = "2026-11-11";
  await step("tâches CRM", async () => { await api("commerce", "POST", "/crm/tasks", { prospectId: funnel[3].id, title: "Relancer Mutuelle Horizon après la plaquette", dueDate: "2026-11-09" }); await api("commerce", "POST", "/crm/tasks", { prospectId: funnel[2].id, title: "Planifier l'appel de qualification Romain Vidal", dueDate: "2026-11-13" }); });
  const alpha = await step("apporteur d'affaires", () => api("commerce", "POST", "/crm/referrers", { kind: "introducer", name: "Cabinet Alpha RH (fictif)", email: `contact@alpha-rh.${DOMAIN}` }));
  if (alpha) await step("apport d'affaires Alpha RH → Inès (5 % / 12 mois)", () => api("commerce", "POST", "/crm/referrals", { prospectId: pc.ines.id, referrerId: alpha.id, ruleType: "percent_of_collected_net", ruleValue: "5", durationMonths: 12 }));
  await step("simulation de rémunération", () => api("commerce", "POST", "/crm/simulations", { prospectId: pc.sofia.id, feeRatePercent: "8", scenarios: [{ label: "Base", dailyRate: "560", daysPerMonth: "20", vatRate: "20", monthlyExpenses: "150" }, { label: "Optimiste", dailyRate: "620", daysPerMonth: "21", vatRate: "20" }] }));

  // ===== 2. Qualification → conversion (crée dossiers consultants et sociétés clientes) =====
  log("2. Qualification et conversion");
  // Léa et Karim d'abord : ils deviennent parrains/coopteurs, les parrainages doivent précéder la conversion des filleuls.
  for (const p of [pc.lea, pc.karim]) { await t(p.id, "qualify"); await t(p.id, "convert"); }
  log("2b. Parrainage et cooptation (modules Apporteurs et commissions)");
  const early: any[] = await api("ops", "GET", "/consultants");
  const idOf = (first: string) => early.find(x => x.firstName === first)?.id as string | undefined;
  const sponsor = async (first: string, last: string) => step(`parrain ${first}`, () => api("commerce", "POST", "/crm/referrers", { kind: "sponsor", name: `${first} ${last} (consultant parrain)`, consultantId: idOf(first), email: `${first.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()}.${last.toLowerCase()}@${DOMAIN}` }));
  const sLea = await sponsor("Léa", "Fontaine"), sKarim = await sponsor("Karim", "Benali");
  const ines = await step("parrain Inès", async () => { await t(pc.ines.id, "qualify"); await t(pc.ines.id, "convert"); const l: any[] = await api("ops", "GET", "/consultants"); early.splice(0, early.length, ...l); return sponsor("Inès", "Moreau"); });
  const ref = (referrerId: string | undefined, prospectId: string, ruleType: string, ruleValue: string, durationMonths: number, label: string) =>
    referrerId ? step(label, () => api("commerce", "POST", "/crm/referrals", { prospectId, referrerId, ruleType, ruleValue, durationMonths })) : undefined;
  // PARRAINAGE = % du net encaissé du filleul pendant 12 mois ; COOPTATION = prime fixe versée à la conversion du candidat.
  await ref(sLea?.id, pc.thomas.id, "percent_of_collected_net", "3", 12, "parrainage Léa → Thomas (3 % / 12 mois)");
  await ref(sKarim?.id, pc.sofia.id, "fixed_per_conversion", "500", 0, "cooptation Karim → Sofia (500 €)");
  await ref(sLea?.id, funnel[1].id, "fixed_per_conversion", "400", 0, "cooptation Léa → Yasmine (400 €, en cours)");
  await ref(ines?.id, funnel[2].id, "fixed_per_conversion", "500", 0, "cooptation Inès → Romain (500 €, en cours)");
  for (const p of [pc.thomas, pc.sofia, ...Object.values(pe)]) { await t(p.id, "qualify"); await t(p.id, "convert"); }
  const consList: any[] = await api("ops", "GET", "/consultants"); const consByKey: Record<string, any> = {};
  for (const c of CONSULTANTS) consByKey[c.key] = consList.find(x => x.firstName === c.first && x.lastName === c.last);
  const compList: any[] = await api("admin", "GET", "/companies"); const coByKey: Record<string, any> = {};
  CLIENTS.forEach((c, i) => { coByKey[c.key] = compList.find(x => x.name === c.name); });
  for (const [i, c] of CLIENTS.entries()) if (coByKey[c.key]) {
    await step(`société ${c.key}`, () => api("admin", "PATCH", `/companies/${coByKey[c.key].id}`, { name: c.name, siren: sirenOk(`81234${pad(i + 1)}${i}`.slice(0, 8)) }, [200, 201]));
    await step(`accord-cadre ${c.key}`, async () => { const a = await api("commerce", "POST", "/crm/agreements", { companyId: coByKey[c.key].id, name: `Accord-cadre ${c.name.split(" (")[0]} 2026-2027`, startDate: "2026-06-01", endDate: "2027-12-31", paymentTermsDays: c.payDays, rates: [{ label: "Senior", maxDailyRate: "900.00" }, { label: "Confirmé", maxDailyRate: "700.00" }] }); await api("commerce", "POST", `/crm/agreements/${a.id}/transition`, { event: "activate" }); });
  }

  // ===== 3. Onboarding consultants =====
  log("3. Onboarding : checklist, accès portail, activation");
  for (const c of CONSULTANTS) {
    const rec = consByKey[c.key]; if (!rec) continue;
    const detail = await api("ops", "GET", `/consultants/${rec.id}`);
    const tasks: any[] = detail.tasks ?? [];
    const todo = c.active ? tasks : tasks.slice(0, 3); // Sofia : dossier incomplet → l'agent Onboarding le signale
    for (const k of todo) await step(`tâche ${k.key}`, () => api("ops", "POST", `/consultants/${rec.id}/tasks/${k.key}`, { done: true }));
    if (c.active) await step(`activation ${c.key}`, () => api("ops", "POST", `/consultants/${rec.id}/activate`));
    const u = await db.user.create({ data: { email: `${c.first.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()}.${c.last.toLowerCase()}@${DOMAIN}`, passwordHash: hash } });
    await db.membership.create({ data: { userId: u.id, tenantId: tenant.id, roles: ["consultant"], consultantId: rec.id } });
    await login(c.key, u.email);
  }
  for (const c of CLIENTS) { // un accès portail client par société
    if (!coByKey[c.key]) continue; const u = await db.user.create({ data: { email: `client.${c.key}@${DOMAIN}`, passwordHash: hash } });
    await db.membership.create({ data: { userId: u.id, tenantId: tenant.id, roles: ["client_user"], companyId: coByKey[c.key].id } }); await login(`client_${c.key}`, u.email);
  }

  // ===== 4. Contrats =====
  log("4. Contrats : modèles publiés, envoi, signature");
  const body = "CONTRAT DE TRAVAIL EN PORTAGE SALARIAL (modèle de démonstration, sans valeur juridique)\nEntre BG Consulting et {{consultant}}, fonction : {{fonction}}.\nMission chez {{client}} à compter du {{debut}}, TJM de référence {{tjm}} € HT.";
  const tpl = await step("modèle CDI", async () => { const m = await api("hr", "POST", "/contract-templates", { kind: "employment_cdi", name: "Contrat de portage CDI — BG Consulting", body }); await api("hr", "POST", `/contract-templates/${m.id}/publish`); return m; });
  const tpls: any[] = await api("hr", "GET", "/contract-templates"); const published = tpls.find(x => x.name?.startsWith("Contrat de portage CDI") && x.status === "published") ?? tpl;
  if (published) for (const c of CONSULTANTS) {
    const rec = consByKey[c.key]; if (!rec) continue;
    const ct = await step(`contrat ${c.key}`, () => api("hr", "POST", "/contracts", { templateId: published.id, consultantId: rec.id, variables: { consultant: `${c.first} ${c.last}`, fonction: c.title, client: CLIENTS.find(x => x.key === c.client)!.name, debut: "01/06/2026", tjm: c.rate } }));
    if (!ct) continue;
    if (c.key === "sofia") continue; // reste en brouillon
    await step(`envoi ${c.key}`, () => api("hr", "POST", `/contracts/${ct.id}/transition`, { event: "send" }));
    if (c.key === "thomas") continue; // reste « envoyé » : relancé par le Contract Agent
    await step(`signature ${c.key}`, () => api("hr", "POST", `/contracts/${ct.id}/transition`, { event: "sign", signatureDeclaration: `Signature papier déclarée reçue le 28/05/2026 (${c.last})` }));
  }

  // ===== 5. Missions =====
  log("5. Missions");
  const mission: Record<string, any> = {};
  for (const c of CONSULTANTS.filter(x => x.active)) mission[c.key] = await step(`mission ${c.key}`, () => api("ops", "POST", "/missions", { consultantId: consByKey[c.key].id, companyId: coByKey[c.client].id, title: `${c.title} — ${CLIENTS.find(x => x.key === c.client)!.name.split(" (")[0]}`, dailyRate: c.rate, vatRate: "20", startDate: "2026-06-01", endDate: "2027-05-31" }));

  // ===== 6. CRA → facture → encaissement =====
  log("6. CRA, validation client, facturation, encaissements");
  const cra = async (key: string, period: string, target: "draft" | "submitted" | "client_approved" | "validated", opts: { upTo?: string; skip?: Set<string> } = {}) => {
    const m = mission[key]; if (!m) return undefined;
    const ts = await step(`CRA ${key} ${period}`, () => api(key, "PUT", `/me/timesheets/missions/${m.id}/${period}`, { lines: weekdays(period, opts.upTo, opts.skip) }));
    if (!ts || target === "draft") return ts;
    await step(`soumission ${key} ${period}`, () => api(key, "POST", `/me/timesheets/${ts.id}/transition`, { event: "submit" })); if (target === "submitted") return ts;
    const cl = CONSULTANTS.find(x => x.key === key)!.client;
    await step(`approbation client ${key} ${period}`, () => api(`client_${cl}`, "POST", `/client/timesheets/${ts.id}/transition`, { event: "approve" })); if (target === "client_approved") return ts;
    await step(`validation ${key} ${period}`, () => api("ops", "POST", `/timesheets/${ts.id}/transition`, { event: "validate" })); return ts;
  };
  const invoice = async (ts: any, pay?: "full" | "partial") => {
    if (!ts) return; const inv = await step("facture", () => api("finance", "POST", "/invoices", { timesheetId: ts.id })); if (!inv) return;
    const issued = await step("émission", () => api("finance", "POST", `/invoices/${inv.id}/issue`)); if (!issued || !pay) return;
    const gross = Number((await api("finance", "GET", `/invoices/${inv.id}`)).gross);
    const amount = pay === "full" ? gross.toFixed(2) : (gross / 2).toFixed(2);
    if (amount) await step("encaissement", () => api("finance", "POST", `/invoices/${inv.id}/payments`, { amount: String(amount), receivedOn: today, reference: `VIR-${inv.id.slice(0, 6).toUpperCase()}` }));
  };
  for (const c of CONSULTANTS.filter(x => x.active)) {
    await invoice(await cra(c.key, "2026-08", "validated"), "full");
    await invoice(await cra(c.key, "2026-09", "validated"), c.key === "thomas" ? "partial" : "full");
  }
  await invoice(await cra("lea", "2026-10", "validated"));       // facture émise, non encaissée
  await invoice(await cra("karim", "2026-10", "validated"));
  await cra("ines", "2026-10", "validated");                      // validé, NON facturé → Finance Agent
  await cra("thomas", "2026-10", "client_approved");              // approuvé client, à valider → Operations Agent
  await cra("lea", "2026-11", "submitted", { upTo: "2026-11-10" }); // en attente d'approbation client
  await cra("karim", "2026-11", "draft", { upTo: "2026-11-06" });  // brouillon partiel → relance WhatsApp
  // ines et thomas : aucun CRA de novembre → relance

  // ===== 6b. Commissions de parrainage / cooptation =====
  log("6b. Commissions : approbation (quatre yeux) et paiement");
  const coms: any[] = await api("finance", "GET", "/crm/commissions");
  console.log(`  ${coms.length} commissions nées (conversion ou encaissement)`);
  const sofiaPrime = coms.find(c => c.sourceType === "conversion");
  if (sofiaPrime) { await step("approbation prime cooptation", () => api("finance", "POST", `/crm/commissions/${sofiaPrime.id}/transition`, { event: "approve" })); await step("paiement prime cooptation", () => api("finance", "POST", `/crm/commissions/${sofiaPrime.id}/transition`, { event: "pay", reference: "VIR-COOPT-0001" })); }
  const firstPct = coms.filter(c => c.sourceType === "payment").sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))[0];
  if (firstPct) await step("approbation commission parrainage", () => api("finance", "POST", `/crm/commissions/${firstPct.id}/transition`, { event: "approve" })); // les suivantes restent « due »

  // ===== 7. Notes de frais =====
  log("7. Notes de frais");
  const claim = async (key: string, lines: object[], upTo: "draft" | "submitted" | "approved" | "reimbursed") => {
    const e = await step(`NDF ${key}`, () => api(key, "POST", "/me/expenses", { title: "Frais octobre 2026" })); if (!e) return;
    await step(`lignes NDF ${key}`, () => api(key, "PUT", `/me/expenses/${e.id}/lines`, { lines }));
    if (upTo === "draft") return; await step(`soumission NDF ${key}`, () => api(key, "POST", `/me/expenses/${e.id}/transition`, { event: "submit" })); if (upTo === "submitted") return;
    await step(`approbation NDF ${key}`, () => api("ops", "POST", `/expenses/${e.id}/transition`, { event: "approve" })); if (upTo === "approved") return;
    await step(`remboursement NDF ${key}`, () => api("finance", "POST", `/expenses/${e.id}/transition`, { event: "reimburse" }));
  };
  await claim("lea", [{ date: "2026-10-14", category: "transport", description: "Train Paris–Lyon A/R (atelier client)", amount: "148.00", receiptRef: "SNCF-1014" }, { date: "2026-10-15", category: "hotel", description: "Nuit hôtel Lyon", amount: "112.00", receiptRef: "HOT-1015", rebillable: true }], "reimbursed");
  await claim("karim", [{ date: "2026-10-20", category: "meal", description: "Déjeuner équipe projet", amount: "24.50", receiptRef: "RES-1020" }, { date: "2026-10-21", category: "transport", description: "Taxi gare", amount: "36.00", receiptRef: "TAXI-1021" }], "submitted");
  await claim("thomas", [{ date: "2026-10-27", category: "meal", description: "Déjeuner client", amount: "19.80", receiptRef: "RES-1027" }], "approved");
  await claim("ines", [{ date: "2026-10-30", category: "other", description: "Matériel de réunion", amount: "42.00" }], "draft");

  // ===== 8. Congés =====
  log("8. Congés et absences");
  for (const c of CONSULTANTS.filter(x => x.active)) await step(`solde ${c.key}`, () => api("hr", "POST", "/leave-adjustments", { consultantId: consByKey[c.key].id, days: "25.0", reason: "Solde initial des congés payés 2026-2027 (démo)" }));
  const lv = async (key: string, s: string, e: string, type = "paid_leave", reason?: string) => step(`congé ${key}`, () => api(key, "POST", "/me/leaves", { type, startDate: s, endDate: e, reason }));
  const l1 = await lv("karim", "2026-12-07", "2026-12-11", "paid_leave", "Congés de fin d'année");
  if (l1) await step("approbation congé", () => api("hr", "POST", `/leaves/${l1.id}/transition`, { event: "approve" }));
  await lv("lea", "2026-12-21", "2026-12-31", "paid_leave", "Vacances de Noël");          // en attente
  await lv("thomas", "2026-11-23", "2026-11-27", "paid_leave", "Voyage familial");        // en attente
  const l4 = await lv("ines", "2027-01-11", "2027-01-12", "paid_leave");
  if (l4) await step("refus congé", () => api("hr", "POST", `/leaves/${l4.id}/transition`, { event: "reject", rejectReason: "Pic d'activité du projet PMO, merci de décaler." }));

  // ===== 9. WhatsApp Business (faux fournisseur LOCAL) =====
  log("9. WhatsApp Business : canal, consentements, relances CRA, réponses entrantes");
  await step("canal", () => api("admin", "PUT", "/whatsapp/channel", { phoneNumberId: PNID }));
  await step("vérification canal", () => api("admin", "POST", "/whatsapp/channel/verify"));
  await step("modèle relance CRA", () => api("admin", "PUT", "/whatsapp/templates", { templates: [{ key: "timesheet_reminder", metaName: "portage_cra_relance", language: "fr", enabled: true }, { key: "salary_simulation", metaName: "portage_simulation_salaire", language: "fr", enabled: true }] }));
  for (const c of CONSULTANTS.filter(x => x.key !== "sofia")) await step(`consentement ${c.key}`, () => api("hr", "POST", "/whatsapp/consents", { subjectType: "consultant", subjectId: consByKey[c.key].id, phone: c.phone, status: "opted_in", source: "written_form", evidence: "Formulaire d'intégration signé (démo)" }));
  // Sofia n'a PAS consenti : la relance est refusée → démontre le garde-fou RGPD
  const rem = await step("relances CRA novembre", () => api("ops", "POST", "/timesheets/reminders", { period: "2026-11" }));
  console.log("  relances :", JSON.stringify(rem?.whatsapp ?? {}));
  const hook = async (from: string, id: string, text: string, name: string) => {
    const raw = JSON.stringify({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: PNID }, contacts: [{ wa_id: from.replace("+", ""), profile: { name } }], messages: [{ from: from.replace("+", ""), id, type: "text", text: { body: text } }] } }] }] });
    const sig = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
    const r = await fetch(`${API}/webhooks/whatsapp`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sig }, body: raw });
    if (!r.ok) throw new Error(`webhook ${r.status}`);
  };
  await step("réponse Thomas", () => hook(normPhone("+33639980004"), "wamid.DEMO.0001", "Bonjour, je finalise mon CRA ce soir, merci du rappel !", "Thomas Girard"));
  await step("réponse Inès", () => hook(normPhone("+33639980003"), "wamid.DEMO.0002", "Mon client valide les jours vendredi, je saisis demain matin.", "Inès Moreau"));

  // ===== 9b. Simulations de salaire (PDF) envoyées par WhatsApp =====
  log("9b. Simulations de salaire : paramètres approuvés, PDF, envoi WhatsApp");
  const SRC = "Feuille de simulation de référence de la société (taux repris tels quels ; charges patronales 45 % = hypothèse de la direction ; à faire valider par la conformité avant usage réel)";
  const PAS: [string, string][] = [["1759", "1.3"], ["3052", "7.5"], ["3476", "9.9"], ["3913", "11.9"], ["4566", "13.8"], ["5475", "15.8"], ["6851", "17.9"], ["8557", "20"], ["11877", "24"], ["16086", "28"], ["25251", "33"], ["54088", "38"]];
  const prm: [string, string, string][] = [["management_fee_rate_percent", "10", "%"], ["sim.working_days_per_year", "227", "jours"], ["sim.net_to_gross_percent", "75", "%"], ["sim.paid_leave_days", "25", "jours"], ["sim.leave_day_divisor", "250", "jours"], ["sim.pas_rate.max", "43", "%"], ["sim.employer_charges_percent", "45", "%"], ...PAS.map(([t, r]) => [`sim.pas_rate.${t}`, r, "%"] as [string, string, string])];
  for (const [key, value, unit] of prm) await step(`paramètre ${key}`, async () => { const x = await api("admin", "POST", "/rules/parameters", { key, value, unit, validFrom: "2026-01-01", source: SRC }); await api("compliance", "POST", `/rules/parameters/${x.id}/approve`); });
  const simYasmine = await step("simulation Yasmine", () => api("commerce", "POST", "/crm/salary-simulations", { prospectId: funnel[1].id, tjm: "700", daysPerMonth: "20", mutualMonthly: "100", scenarios: [{ grossAnnual: "58000", dailyExpenses: "270" }, { grossAnnual: "65000", dailyExpenses: "230" }, { grossAnnual: "70000", dailyExpenses: "200" }], contact: { name: "Conseiller BG (démo)", phone: "+33139980099", email: `commerce@${DOMAIN}` } }));
  await step("simulation Romain", () => api("commerce", "POST", "/crm/salary-simulations", { prospectId: funnel[2].id, tjm: "435", daysPerMonth: "20", mutualMonthly: "100", scenarios: [{ grossAnnual: "41000", dailyExpenses: "140" }, { grossAnnual: "43000", dailyExpenses: "130" }, { grossAnnual: "44000", dailyExpenses: "122" }], contact: { name: "Conseiller BG (démo)", phone: "+33139980099", email: `commerce@${DOMAIN}` } }));
  if (simYasmine) {
    await step("consentement prospect Yasmine", () => api("commerce", "POST", "/whatsapp/consents", { subjectType: "prospect", subjectId: funnel[1].id, phone: "+33639980020", status: "opted_in", source: "in_app", evidence: "Accord donné par téléphone, consigné par le conseiller (démo)" }));
    const sent = await step("envoi WhatsApp de la simulation", () => api("commerce", "POST", `/crm/salary-simulations/${simYasmine.id}/whatsapp`, { prospectId: funnel[1].id }));
    console.log("  envoi simulation :", sent?.status ?? "—", "(Romain : aucun consentement → envoi refusé par conception)");
  }

  // ===== 10. Agents =====
  log("10. Agents : exécutions déterministes, propositions à valider");
  const run = (who: string, agentKey: string, playbook: string, params?: object) => step(`agent ${agentKey}`, () => api(who, "POST", "/agent-runs", { agentKey, playbook, params }));
  await run("hr", "onboarding", "completeness_check"); await run("hr", "contract", "followup", { olderThanDays: 0 });
  await run("ops", "operations", "closing_check", { period: "2026-10" }); await run("finance", "finance", "invoice_preparation");
  await step("agent consultant", () => api("lea", "POST", "/me/agent-runs", { playbook: "my_summary" }));

  console.log(`\n══ Démo « ${tenant.name} » prête ══`);
  console.log(`Slug société : ${SLUG}`);
  console.log(`Comptes (mot de passe = DEMO_PASSWORD) : ${TEAM.map(([l]) => `${l}@${DOMAIN}`).join(", ")}`);
  console.log(`Consultants : prenom.nom@${DOMAIN} (ex. lea.fontaine@${DOMAIN}) · Clients : client.bm|at|he@${DOMAIN}`);
  console.log(`Étapes OK : ${out.ok} · en échec : ${out.ko.length}`); out.ko.forEach(k => console.log("  ✗", k));
}
main().catch(e => { console.error("\nÉCHEC :", e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
