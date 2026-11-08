"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ userId: string; roles: string[] }>("me") });
  if (me.error instanceof ApiError && me.error.status === 401) { router.replace("/login"); return null; }
  async function logout() { await fetch("/api/session", { method: "DELETE" }); router.replace("/login"); router.refresh(); }
  return (
    <div className="shell">
      <nav className="nav" aria-label="Navigation principale">
        <strong>PORTAGE OS</strong>
        <Link href="/companies">Clients</Link>
        <Link href="/audit">Journal d&apos;audit</Link>
        <span className="muted" style={{ fontSize: "0.85rem" }}>{me.data ? `Rôles : ${me.data.roles.join(", ")}` : "…"}</span>
        <button className="secondary" onClick={logout}>Se déconnecter</button>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
