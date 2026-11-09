import { NextRequest, NextResponse } from "next/server";
import { API_URL, clearSessionCookies, setSessionCookies } from "@/lib/server";
import { withSession } from "@/lib/session";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: { message: "Introuvable" } }, { status: 404 });
  const { res, renewed, expired } = await withSession(req, token => fetch(`${API_URL}/invoices/${id}/pdf`, { headers: { authorization: `Bearer ${token}` } }));
  if (!res) { const r = NextResponse.json({ error: { message: expired ? "Session expirée" : "Non authentifié" } }, { status: 401 }); if (expired) clearSessionCookies(r); return r; }
  const ok = res.ok;
  const out = ok
    ? new NextResponse(await res.arrayBuffer(), { status: 200, headers: { "content-type": res.headers.get("content-type") ?? "application/octet-stream", "content-disposition": res.headers.get("content-disposition") ?? "attachment", "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'", "cache-control": "private, no-store" } })
    : new NextResponse(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
  if (renewed) setSessionCookies(out, renewed);
  return out;
}
