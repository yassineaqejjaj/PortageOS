import { NextRequest, NextResponse } from "next/server";
import { API_URL, COOKIE } from "@/lib/server";

function sameOrigin(req: NextRequest) {
  const o = req.headers.get("origin");
  return !o || o === req.nextUrl.origin;
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: { message: "Origine refusée" } }, { status: 403 });
  const r = await fetch(`${API_URL}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: await req.text() });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return NextResponse.json({ error: { message: r.status === 429 ? "Trop de tentatives, réessayez plus tard" : "Identifiants invalides" } }, { status: r.status === 429 ? 429 : 401 });
  const res = NextResponse.json({ ok: true });
  // Jeton en cookie httpOnly: jamais exposé au JavaScript du navigateur.
  res.cookies.set(COOKIE, data.accessToken, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: data.expiresIn });
  return res;
}

export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: { message: "Origine refusée" } }, { status: 403 });
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(COOKIE);
  return res;
}
