"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { NAV } from "@/lib/nav";

/** Accueil provisoire : redirige vers la première entrée de navigation autorisée (le tableau de bord du design n'est pas encore construit). */
export default function Home() {
  const router = useRouter();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ permissions: string[] }>("me") });
  useEffect(() => {
    if (!me.data) return;
    const first = NAV.find(i => me.data.permissions.includes(i.permission));
    if (first) router.replace(first.href);
  }, [me.data, router]);
  if (me.data && !NAV.some(i => me.data.permissions.includes(i.permission)))
    return <div className="alert a-warning" role="alert"><span>Aucun module n’est accessible avec votre rôle. Contactez un administrateur.</span></div>;
  return <p className="muted" aria-live="polite">Chargement…</p>;
}
