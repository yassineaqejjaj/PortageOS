/**
 * Navigation conforme au design (artboard nav/Sidebar) : un menu par portail (Gestion, Consultant, Client), groupes
 * Pilotage / Relation / Opérations / Gouvernance pour la gestion, libellés et icônes du design.
 * Seules les routes RÉELLEMENT implémentées figurent ici (aucun lien mort) ; les entrées du design sans écran
 * (Operations Center, Trésorerie complète, Paie, RH, Simulateur, Litiges…) sont volontairement absentes.
 * Le filtrage par permission est un confort d'UI : l'API applique l'autorisation réelle.
 */
export const ICONS = {
  home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  crm: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  bld: "M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M3 21h18M8 8h3M8 12h3M8 16h3",
  users: "M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 20v-1a4 4 0 0 0-3-3.9M16 4.1a3.5 3.5 0 0 1 0 6.8",
  bag: "M4 7h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18",
  cal: "M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM16 3v4M8 3v4M4 10h16",
  eur: "M17 6.5A7 7 0 1 0 17 17.5M4 10h9M4 14h9",
  bank: "M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18",
  led: "M4 19V5M4 19h16M8 15l4-4 3 3 5-6",
  doc: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6",
  rec: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3",
  book: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11",
  ai: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6",
  chat: "M4 5h16v11H8l-4 4z",
  chart: "M4 20V10M10 20V4M16 20v-7M2 20h20",
  key: "M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zM11.4 11.6L15.5 7.5m0 0l3 3L22 7l-3-3",
  sh: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM9 12l2 2 4-4",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4",
} as const;
export type IconKey = keyof typeof ICONS;

export type Portal = "bo" | "consultant" | "client";
export interface NavLeaf { key: string; label: string; href: string; icon: IconKey; permission: string }
export interface NavParent { key: string; label: string; icon: IconKey; children: NavLeaf[] }
export type NavEntry = NavLeaf | NavParent;
export interface NavGroup { label?: string; entries: NavEntry[] }
export const isParent = (e: NavEntry): e is NavParent => "children" in e;

const L = (key: string, label: string, href: string, icon: IconKey, permission: string): NavLeaf => ({ key, label, href, icon, permission });

export const PORTALS: Record<Portal, { label: string; groups: NavGroup[] }> = {
  bo: { label: "Gestion", groups: [
    { label: "Pilotage", entries: [L("pilotage", "Pilotage", "/pilotage", "chart", "pilotage.read"), L("agents", "Agents IA", "/agents", "ai", "agent.read")] },
    { label: "Relation", entries: [
      { key: "crm", label: "CRM", icon: "crm", children: [
        L("prospects", "Prospects", "/crm/prospects", "crm", "prospect.read"), L("crm-tasks", "Tâches commerciales", "/crm/tasks", "cal", "prospect.read"), L("crm-campaigns", "Campagnes", "/crm/campaigns", "chart", "prospect.read"),
        L("crm-referrers", "Apporteurs et commissions", "/crm/referrers", "users", "commission.read"), L("crm-agreements", "Accords-cadres", "/crm/agreements", "doc", "prospect.read"), L("crm-imports", "Imports de prospects", "/crm/imports", "rec", "prospect.write")] },
      L("companies", "Clients", "/companies", "bld", "company.read"), L("consultants", "Consultants", "/consultants", "users", "consultant.read"), L("contracts", "Contrats", "/contracts", "doc", "contract.read"), L("missions", "Missions", "/missions", "bag", "mission.read")] },
    { label: "Opérations", entries: [
      L("timesheets", "Activité / CRA", "/timesheets", "cal", "timesheet.read"), L("expenses", "Notes de frais", "/expenses", "rec", "expense.read"), L("leaves", "Absences et congés", "/leaves", "cal", "leave.read"), L("invoices", "Facturation", "/invoices", "eur", "invoice.read"),
      { key: "treasury", label: "Trésorerie", icon: "bank", children: [L("bank", "Rapprochement bancaire", "/bank", "bank", "payment.write"), L("ledger", "Registre financier", "/ledger", "led", "ledger.read")] },
      L("accounts", "Comptes d’activité", "/accounts", "led", "account.read")] },
    { label: "Gouvernance", entries: [
      L("rules", "Conformité", "/rules", "sh", "rules.read"), L("accounting", "Comptabilité", "/accounting", "book", "accounting.read"), L("support", "Support", "/support", "chat", "support.create"),
      { key: "config", label: "Configuration", icon: "gear", children: [L("members", "Membres et accès", "/members", "users", "member.manage"), L("audit", "Journal d’audit", "/audit", "sh", "audit.read")] }] },
  ] },
  consultant: { label: "Consultant", groups: [{ entries: [
    { key: "cra", label: "CRA et absences", icon: "cal", children: [L("me-ts", "Mes CRA", "/me/timesheets", "cal", "portal.self"), L("me-leaves", "Mes absences", "/me/leaves", "cal", "portal.self")] },
    L("me-expenses", "Notes de frais", "/me/expenses", "rec", "portal.self"), L("me-account", "Compte d’activité", "/me/account", "led", "portal.self"), L("me-docs", "Mes documents", "/me/documents", "doc", "portal.self"),
    L("support", "Demandes et support", "/support", "chat", "support.create"), L("me-agent", "Assistant", "/me/assistant", "ai", "portal.self")] }] },
  client: { label: "Client", groups: [{ entries: [L("client-ts", "CRA à valider", "/client/timesheets", "cal", "portal.client"), L("support", "Demandes et support", "/support", "chat", "support.create")] }] },
};

/** Portail déduit des rôles : consultant seul → Consultant, client seul → Client, sinon Gestion. */
export function portalOf(roles: string[]): Portal {
  const staff = roles.some(r => !["consultant", "client_user", "referrer"].includes(r));
  if (staff) return "bo";
  if (roles.includes("consultant")) return "consultant";
  if (roles.includes("client_user")) return "client";
  return "bo";
}

/** Entrées visibles pour des permissions données ; un parent sans enfant visible disparaît, un groupe vide aussi. */
export function visibleNav(portal: Portal, permissions: string[]): NavGroup[] {
  const ok = (l: NavLeaf) => permissions.includes(l.permission);
  return PORTALS[portal].groups.map(g => ({ label: g.label, entries: g.entries.flatMap((e): NavEntry[] => isParent(e) ? (e.children.some(ok) ? [{ ...e, children: e.children.filter(ok) }] : []) : ok(e) ? [e] : []) })).filter(g => g.entries.length > 0);
}
export const leaves = (groups: NavGroup[]): NavLeaf[] => groups.flatMap(g => g.entries.flatMap(e => (isParent(e) ? e.children : [e])));
/** Actif = la route elle-même ou une sous-route (jamais un préfixe de nom : /crm/prospects ≠ /crm/prospects-x). */
export const isActive = (href: string, pathname: string) => pathname === href || pathname.startsWith(`${href}/`);
/** Une seule entrée active : la plus spécifique (href le plus long), pour éviter deux entrées « page courante ». */
export function activeKey(groups: NavGroup[], pathname: string): string | null {
  const m = leaves(groups).filter(l => isActive(l.href, pathname)).sort((a, b) => b.href.length - a.href.length)[0]; return m?.key ?? null;
}
export const ROLE_LABEL: Record<string, string> = { tenant_admin: "Administrateur", direction: "Direction", commerce: "Commerce", operations: "Opérations", hr: "Ressources humaines", payroll: "Paie", finance: "Finance", compliance: "Conformité", consultant: "Consultant", client_user: "Utilisateur client", external_accountant: "Expert-comptable", referrer: "Apporteur" };
