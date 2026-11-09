"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ICONS, IconKey, NavGroup, PORTALS, Portal, ROLE_LABEL, activeKey, isParent, leaves, portalOf, visibleNav } from "@/lib/nav";

const Icon = ({ k }: { k: IconKey }) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[k]} /></svg>;
const KEY = "portage.nav.collapsed";
const read = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
const write = (v: boolean) => { try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* stockage indisponible : le menu reste fonctionnel */ } };

/** Navigation latérale conforme au design : marque, pastille de portail, groupes, sous-menus repliables, utilisateur, réduction 72 px ; tiroir sous 900 px. */
export function Sidebar({ me, open, onClose, collapsed, onCollapse }: { me?: { email?: string; roles: string[]; permissions: string[] }; open: boolean; onClose: () => void; collapsed: boolean; onCollapse: (v: boolean) => void }) {
  const pathname = usePathname();
  const portal: Portal = portalOf(me?.roles ?? []);
  const groups: NavGroup[] = useMemo(() => visibleNav(portal, me?.permissions ?? []), [portal, me?.permissions]);
  const current = activeKey(groups, pathname);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const parentOfCurrent = groups.flatMap(g => g.entries).find(e => isParent(e) && e.children.some(c => c.key === current))?.key;
  useEffect(() => { if (parentOfCurrent) setExpanded(x => (x[parentOfCurrent] ? x : { ...x, [parentOfCurrent]: true })); }, [parentOfCurrent]);
  const first = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => { if (open) first.current?.focus(); }, [open]);
  useEffect(() => { if (!open) return; const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; document.addEventListener("keydown", h); return () => document.removeEventListener("keydown", h); }, [open, onClose]);
  const email = me?.email ?? "";
  const initials = (email.split("@")[0] ?? "?").replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase() || "?";
  const role = (me?.roles ?? []).map(r => ROLE_LABEL[r] ?? r).join(", ");
  let firstLink = true;
  return (
    <>
      {open && <div className="nav-backdrop" onClick={onClose} aria-hidden="true" />}
      <aside id="menu" className={`app-nav${collapsed ? " is-collapsed" : ""}${open ? " is-open" : ""}`}>
        <nav className="nav-shell" aria-label="Navigation principale">
          <div className="nav-brand">
            <svg width="28" height="28" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="10" fill="#4F46E5" /><path d="M11 24l9-6 9 6" stroke="#fff" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /><path d="M11 17l9-6 9 6" stroke="#5EEAD4" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span className="nav-label nav-name">PORTAGE<span style={{ color: "#5EEAD4" }}> OS</span></span>
            <span className="nav-label nav-chip">{PORTALS[portal].label}</span>
          </div>
          <div className="nav-scroll">
            {groups.map((g, gi) => (
              <div key={g.label ?? gi}>
                {g.label && <div className="nav-group nav-label">{g.label}</div>}
                {g.entries.map(e => {
                  if (!isParent(e)) {
                    const ref = firstLink ? (el: HTMLAnchorElement | null) => { first.current = el; } : undefined; firstLink = false;
                    return <Link key={e.key} ref={ref} href={e.href} className="nav-link" aria-current={current === e.key ? "page" : undefined} title={collapsed ? e.label : undefined} onClick={onClose}><Icon k={e.icon} /><span className="nav-label">{e.label}</span></Link>;
                  }
                  const isOpen = !!expanded[e.key] && !collapsed; const holdsCurrent = e.children.some(c => c.key === current);
                  return (
                    <div key={e.key}>
                      <button type="button" className={`nav-link nav-parent${holdsCurrent ? " has-current" : ""}`} aria-expanded={isOpen} aria-controls={`sub-${e.key}`} title={collapsed ? e.label : undefined}
                        onClick={() => { if (collapsed) { onCollapse(false); write(false); setExpanded(x => ({ ...x, [e.key]: true })); } else setExpanded(x => ({ ...x, [e.key]: !x[e.key] })); }}>
                        <Icon k={e.icon} /><span className="nav-label">{e.label}</span>
                        <svg className="nav-label nav-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: isOpen ? "rotate(90deg)" : undefined }}><path d="M9 6l6 6-6 6" /></svg>
                      </button>
                      {isOpen && <div id={`sub-${e.key}`} className="nav-sub">{e.children.map(c => <Link key={c.key} href={c.href} className="nav-link" aria-current={current === c.key ? "page" : undefined} onClick={onClose}><span className="nav-label">{c.label}</span></Link>)}</div>}
                    </div>
                  );
                })}
              </div>
            ))}
            {groups.length === 0 && me && <p className="nav-label small" style={{ padding: "12px 10px", color: "#8C9AB3" }}>Aucun module n’est accessible avec votre rôle.</p>}
          </div>
          <div className="nav-user">
            <span className="av" aria-hidden="true" style={{ width: 32, height: 32, background: "var(--navy-700)", color: "#fff", flex: "none" }}>{initials}</span>
            <div className="nav-label" style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "#fff", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={email}>{email || "…"}</div>
              <div style={{ fontSize: 11.5, color: "#8C9AB3" }}>{role}</div>
              <Link href="/security" className="nav-sec" onClick={onClose} aria-current={pathname.startsWith("/security") ? "page" : undefined}>Sécurité du compte</Link>
            </div>
            <button type="button" className="nav-collapse" aria-label={collapsed ? "Développer la navigation" : "Réduire la navigation"} aria-pressed={collapsed} onClick={() => { onCollapse(!collapsed); write(!collapsed); }}>{collapsed ? "»" : "«"}</button>
          </div>
        </nav>
      </aside>
    </>
  );
}
export { read as readCollapsed };
export const firstLeafHref = (roles: string[], permissions: string[]) => leaves(visibleNav(portalOf(roles), permissions))[0]?.href;
