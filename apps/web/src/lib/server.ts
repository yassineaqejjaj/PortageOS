import { NextResponse } from "next/server";
export const API_URL = process.env.API_URL ?? "http://localhost:3001";
export const COOKIE = "portage_session";   // jeton d'accès (15 min)
export const REFRESH = "portage_refresh";  // jeton de rafraîchissement (rotation), limité au chemin /api

export function setSessionCookies(res: NextResponse, t: { accessToken: string; refreshToken?: string; expiresIn: number }) {
  const secure = process.env.NODE_ENV === "production";
  // Le cookie reste présent 30 jours (il sert de témoin de session aux pages) ; le JWT qu'il contient expire en 15 min et le proxy le renouvelle.
  res.cookies.set(COOKIE, t.accessToken, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 30 * 86400 });
  if (t.refreshToken) res.cookies.set(REFRESH, t.refreshToken, { httpOnly: true, sameSite: "lax", secure, path: "/api", maxAge: 30 * 86400 });
}
export function clearSessionCookies(res: NextResponse) { res.cookies.delete(COOKIE); res.cookies.set(REFRESH, "", { path: "/api", maxAge: 0 }); }
