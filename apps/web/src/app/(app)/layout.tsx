"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { Sidebar, readCollapsed } from "./sidebar";

interface Me { userId: string; roles: string[]; permissions: string[]; mfaEnrollmentRequired?: boolean; email?: string; tenant?: { slug: string; name: string } }

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("me") });
  if (me.error instanceof ApiError && me.error.status === 401) { router.replace("/login"); return null; }
  async function logout() { await fetch("/api/session", { method: "DELETE" }); router.replace("/login"); router.refresh(); }
  const unread = useQuery({ queryKey: ["unread"], queryFn: () => api<{ count: number }>("notifications/unread-count"), refetchInterval: 30_000, enabled: !!me.data });
  useEffect(() => { if (me.data?.mfaEnrollmentRequired && pathname !== "/security") router.replace("/security"); }, [me.data, pathname, router]);
  const [navOpen, setNavOpen] = useState(false); const [collapsed, setCollapsed] = useState(false);
  const closeNav = useCallback(() => setNavOpen(false), []);
  useEffect(() => { setCollapsed(readCollapsed()); }, []);
  return (
    <div className="app">
      <a className="skip" href="#contenu">Aller au contenu</a>
      <Sidebar me={me.data} open={navOpen} onClose={closeNav} collapsed={collapsed} onCollapse={setCollapsed} />
      <div className="app-main">
        <header className="topbar">
          <button type="button" className="btn btn-secondary btn-sm nav-toggle" aria-controls="menu" aria-expanded={navOpen} onClick={() => setNavOpen(o => !o)}>Menu</button>
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
