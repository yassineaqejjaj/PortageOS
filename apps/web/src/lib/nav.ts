/** Tracés d'icônes du design (Sidebar.dc.html, trait 2 px, grille 24). */
export const ICONS = {
  home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  crm: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  bld: "M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M3 21h18M8 8h3M8 12h3M8 16h3",
  users: "M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 20v-1a4 4 0 0 0-3-3.9M16 4.1a3.5 3.5 0 0 1 0 6.8",
  bag: "M4 7h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18",
  cal: "M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM16 3v4M8 3v4M4 10h16",
  eur: "M17 6.5A7 7 0 1 0 17 17.5M4 10h9M4 14h9",
  led: "M4 19V5M4 19h16M8 15l4-4 3 3 5-6",
  sh: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM9 12l2 2 4-4",
} as const;

export interface NavItem { key: string; label: string; href: string; icon: keyof typeof ICONS; permission: string; group: string }

/**
 * Seules les routes RÉELLEMENT implémentées figurent ici (pas de liens morts). Le filtrage par permission est un
 * confort d'UI : les permissions viennent de l'API (/me) et l'autorisation réelle est appliquée par l'API.
 */
export const NAV: NavItem[] = [
  { key: "prospects", label: "Prospects", href: "/crm/prospects", icon: "crm", permission: "prospect.read", group: "Relation" },
  { key: "companies", label: "Clients", href: "/companies", icon: "bld", permission: "company.read", group: "Relation" },
  { key: "consultants", label: "Consultants", href: "/consultants", icon: "users", permission: "consultant.read", group: "Relation" },
  { key: "missions", label: "Missions", href: "/missions", icon: "bag", permission: "mission.read", group: "Opérations" },
  { key: "timesheets", label: "Activité / CRA", href: "/timesheets", icon: "cal", permission: "timesheet.read", group: "Opérations" },
  { key: "invoices", label: "Facturation", href: "/invoices", icon: "eur", permission: "invoice.read", group: "Opérations" },
  { key: "ledger", label: "Registre financier", href: "/ledger", icon: "led", permission: "ledger.read", group: "Opérations" },
  { key: "audit", label: "Journal d’audit", href: "/audit", icon: "sh", permission: "audit.read", group: "Gouvernance" },
  { key: "me", label: "Mes CRA", href: "/me/timesheets", icon: "cal", permission: "portal.self", group: "Mon espace" },
  { key: "client", label: "CRA à valider", href: "/client/timesheets", icon: "cal", permission: "portal.client", group: "Mon espace" },
];
