import { NextRequest, NextResponse } from "next/server";

/** Connecté = cookie de session présent (le proxy renouvelle le jeton d'accès expiré). L'autorisation réelle reste côté API. */
export function middleware(req: NextRequest) {
  const has = req.cookies.has("portage_session"); // témoin de session ; le jeton de rafraîchissement n'est envoyé qu'au chemin /api
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/invite") || pathname === "/forgot-password") return;
  if (!has && pathname !== "/login") return NextResponse.redirect(new URL("/login", req.url));
  if (has && pathname === "/login") return NextResponse.redirect(new URL("/", req.url));
}
export const config = { matcher: ["/((?!api|_next|favicon.ico).*)"] };
