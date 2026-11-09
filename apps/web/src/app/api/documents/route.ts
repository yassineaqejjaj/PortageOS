import { NextRequest, NextResponse } from "next/server";
import { API_URL, clearSessionCookies, setSessionCookies } from "@/lib/server";
import { withSession } from "@/lib/session";

const MAX = 11 * 1024 * 1024;
const json = (m: string, status: number) => NextResponse.json({ error: { message: m } }, { status });

/** Dépôt d'un fichier (multipart) : contrôle d'Origin, taille bornée, jeton jamais exposé au navigateur. */
export async function POST(req: NextRequest) {
  const o = req.headers.get("origin"); if (o !== req.nextUrl.origin) return json("Origine refusée", 403);
  if (Number(req.headers.get("content-length") ?? 0) > MAX) return json("Fichier trop volumineux (10 Mo maximum)", 413);
  const form = await req.formData().catch(() => null); if (!form) return json("Requête invalide", 400);
  const file = form.get("file");
  const { res, renewed, expired } = await withSession(req, token => {
    const fd = new FormData();
    for (const k of ["ownerType", "ownerId", "category"]) fd.append(k, String(form.get(k) ?? ""));
    if (file instanceof File) fd.append("file", file, file.name);
    return fetch(`${API_URL}/documents`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: fd });
  });
  if (!res) { const r = json(expired ? "Session expirée" : "Non authentifié", 401); if (expired) clearSessionCookies(r); return r; }
  const out = new NextResponse(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
  if (renewed) setSessionCookies(out, renewed);
  return out;
}
