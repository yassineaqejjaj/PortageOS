"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { firstLeafHref } from "./sidebar";

/** Accueil provisoire : redirige vers la première entrée de navigation autorisée (le tableau de bord du design n'est pas encore construit). */
export default function Home() {
  const router = useRouter();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ roles: string[]; permissions: string[] }>("me") });
  useEffect(() => {
    if (!me.data) return;
    const first = firstLeafHref(me.data.roles, me.data.permissions);
    if (first) router.replace(first);
  }, [me.data, router]);
  if (me.data && !firstLeafHref(me.data.roles, me.data.permissions))
    return <div className="alert a-warning" role="alert"><span>Aucun module n’est accessible avec votre rôle. Contactez un administrateur.</span></div>;
  return <p className="muted" aria-live="polite">Chargement…</p>;
}
