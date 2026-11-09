import { NextRequest, NextResponse } from "next/server";
import { API_URL, COOKIE, REFRESH, clearSessionCookies, setSessionCookies } from "@/lib/server";

const sameOrigin = (req: NextRequest) => { const o = req.headers.get("origin"); return !o || o === req.nextUrl.origin; };
const forbidden = () => NextResponse.json({ error: { message: "Origine refusée" } }, { status: 403 });

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return forbidden();
  const r = await fetch(`${API_URL}/auth/login`, { method: "POST", headers: { "content-type": "application/json", "user-agent": req.headers.get("user-agent") ?? "" }, body: await req.text() });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return NextResponse.json({ error: { message: r.status === 429 ? "Trop de tentatives, réessayez plus tard" : "Identifiants invalides" } }, { status: r.status === 429 ? 429 : 401 });
  if (data.mfaRequired) return NextResponse.json({ mfaRequired: true, mfaToken: data.mfaToken }); // aucune session tant que le second facteur n'est pas validé
  const res = NextResponse.json({ ok: true }); setSessionCookies(res, data); return res;
}

export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return forbidden();
  const token = req.cookies.get(COOKIE)?.value;
  if (token) await fetch(`${API_URL}/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${token}` } }).catch(() => undefined); // révoque la session côté serveur
  void REFRESH;
  const res = NextResponse.json({ ok: true }); clearSessionCookies(res); return res;
}
