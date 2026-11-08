"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { NAV, ICONS } from "@/lib/nav";

interface Me { userId: string; roles: string[]; permissions: string[]; email?: string; tenant?: { slug: string; name: string } }

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("me") });
  if (me.error instanceof ApiError && me.error.status === 401) { router.replace("/login"); return null; }
  async function logout() { await fetch("/api/session", { method: "DELETE" }); router.replace("/login"); router.refresh(); }
  const unread = useQuery({ queryKey: ["unread"], queryFn: () => api<{ count: number }>("notifications/unread-count"), refetchInterval: 30_000, enabled: !!me.data });
  const roles = me.data?.roles ?? [];
  const items = NAV.filter(i => me.data?.permissions.includes(i.permission));
  const groups = [...new Set(items.map(i => i.group))];
  const initials = (me.data?.email ?? "?").slice(0, 2).toUpperCase();
  return (
    <div className="app">
      <a className="skip" href="#contenu">Aller au contenu</a>
      <div className="app-nav" style={{ background: "var(--color-bg-nav)" }}>
        <nav className="nav-shell" aria-label="Navigation principale">
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 18px 14px" }}>
            <svg width="28" height="28" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="10" fill="#4F46E5" /><path d="M11 24l9-6 9 6" stroke="#fff" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /><path d="M11 17l9-6 9 6" stroke="#5EEAD4" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span style={{ fontFamily: "var(--type-display)", fontWeight: 800, letterSpacing: ".04em", color: "#fff" }}>PORTAGE<span style={{ color: "#5EEAD4" }}> OS</span></span>
          </div>
          <div style={{ flex: 1, padding: "4px 10px 12px" }}>
            {groups.map(g => (
              <div key={g}>
                <div className="nav-group">{g}</div>
                {items.filter(i => i.group === g).map(i => (
                  <Link key={i.key} href={i.href} className="nav-link" aria-current={pathname.startsWith(i.href) ? "page" : undefined}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[i.icon]} /></svg>
                    <span>{i.label}</span>
                  </Link>
                ))}
              </div>
            ))}
          </div>
          <div style={{ borderTop: "1px solid var(--navy-700)", padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
            <span className="av" aria-hidden="true" style={{ width: 32, height: 32, background: "var(--navy-700)", color: "#fff" }}>{initials}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "#fff", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{me.data?.email ?? "…"}</div>
              <div style={{ fontSize: 11.5, color: "#8C9AB3" }}>{roles.join(", ")}</div>
            </div>
          </div>
        </nav>
      </div>
      <div className="app-main">
        <header className="topbar">
          <span className="btn btn-secondary" style={{ cursor: "default" }} aria-label={`Société : ${me.data?.tenant?.name ?? ""}`}>
            <span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: 5, background: "var(--teal-500)", color: "#fff", fontSize: 10, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{(me.data?.tenant?.name ?? "?").slice(0, 2).toUpperCase()}</span>
            {me.data?.tenant?.name ?? "…"}
          </span>
          <div style={{ marginLeft: "auto" }} className="row">
            <Link href="/notifications" className="btn btn-ghost" aria-label={`Notifications, ${unread.data?.count ?? 0} non lue(s)`} style={{ position: "relative", padding: "0 10px" }}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0" /></svg>
              {!!unread.data?.count && <span aria-hidden="true" style={{ position: "absolute", top: 2, right: 2, minWidth: 16, height: 16, borderRadius: 8, background: "var(--color-status-danger)", color: "#fff", fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>{unread.data.count > 99 ? "99+" : unread.data.count}</span>}
            </Link>
            <button className="btn btn-secondary btn-sm" onClick={logout}>Se déconnecter</button>
          </div>
        </header>
        <main id="contenu" className="content">{children}</main>
      </div>
    </div>
  );
}
