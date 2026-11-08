import { Permission } from "./permissions";

/** Tracés d'icônes du design (Sidebar.dc.html, trait 2 px, grille 24). */
export const ICONS = {
  home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  bld: "M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M3 21h18M8 8h3M8 12h3M8 16h3",
  sh: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM9 12l2 2 4-4",
} as const;

export interface NavItem { key: string; label: string; href: string; icon: keyof typeof ICONS; permission: Permission; group: string }

/**
 * Seules les routes RÉELLEMENT implémentées figurent ici (pas de liens morts).
 * Sitemap complet du design : docs/DESIGN_HANDOFF.md. Le filtrage par permission est un confort d'UI ;
 * l'autorisation réelle est appliquée par l'API.
 */
export const BO_NAV: NavItem[] = [
  { key: "companies", label: "Clients", href: "/companies", icon: "bld", permission: "company.read", group: "Relation" },
  { key: "audit", label: "Journal d’audit", href: "/audit", icon: "sh", permission: "audit.read", group: "Gouvernance" },
];
