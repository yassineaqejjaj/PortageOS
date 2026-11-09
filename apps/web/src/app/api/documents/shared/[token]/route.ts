import { NextRequest, NextResponse } from "next/server";
import { API_URL } from "@/lib/server";

/** Lien temporaire signé : public par conception (le jeton signé et son expiration font foi, vérifiés par l'API). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (token.length > 2000 || !/^[\w.-]+$/.test(token)) return NextResponse.json({ error: { message: "Lien invalide" } }, { status: 404 });
  const res = await fetch(`${API_URL}/documents/shared/${token}`);
  if (!res.ok) return NextResponse.json({ error: { message: res.status === 410 ? "Document indisponible" : "Lien invalide ou expiré" } }, { status: res.status === 410 ? 410 : 401 });
  return new NextResponse(await res.arrayBuffer(), { status: 200, headers: { "content-type": res.headers.get("content-type") ?? "application/octet-stream", "content-disposition": res.headers.get("content-disposition") ?? "attachment", "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'", "cache-control": "private, no-store" } });
}
