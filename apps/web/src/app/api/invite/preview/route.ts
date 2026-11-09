import { NextRequest, NextResponse } from "next/server";
import { API_URL } from "@/lib/server";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const r = await fetch(`${API_URL}/auth/invitations/preview?token=${encodeURIComponent(token)}`);
  return NextResponse.json(r.ok ? await r.json() : { error: { message: "Invitation invalide, expirée ou déjà utilisée" } }, { status: r.ok ? 200 : 404 });
}
