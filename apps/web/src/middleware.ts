import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const has = req.cookies.has("portage_session");
  const { pathname } = req.nextUrl;
  if (!has && pathname !== "/login") return NextResponse.redirect(new URL("/login", req.url));
  if (has && pathname === "/login") return NextResponse.redirect(new URL("/", req.url));
}
export const config = { matcher: ["/((?!api|_next|favicon.ico).*)"] };
