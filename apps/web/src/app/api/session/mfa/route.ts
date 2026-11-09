import { NextRequest, NextResponse } from "next/server";
import { API_URL, setSessionCookies } from "@/lib/server";

export async function POST(req: NextRequest) {
  const o = req.headers.get("origin"); if (o && o !== req.nextUrl.origin) return NextResponse.json({ error: { message: "Origine refusée" } }, { status: 403 });
  const r = await fetch(`${API_URL}/auth/mfa/verify`, { method: "POST", headers: { "content-type": "application/json", "user-agent": req.headers.get("user-agent") ?? "" }, body: await req.text() });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return NextResponse.json({ error: { message: r.status === 429 ? "Trop de tentatives, réessayez dans une minute" : "Code invalide ou expiré" } }, { status: r.status === 429 ? 429 : 401 });
  const res = NextResponse.json({ ok: true }); setSessionCookies(res, data); return res;
}
