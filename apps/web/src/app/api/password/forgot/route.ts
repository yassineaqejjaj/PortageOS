import { NextRequest, NextResponse } from "next/server";
import { API_URL } from "@/lib/server";

export async function POST(req: NextRequest) {
  const o = req.headers.get("origin"); if (o && o !== req.nextUrl.origin) return NextResponse.json({ error: { message: "Origine refusée" } }, { status: 403 });
  const r = await fetch(`${API_URL}/auth/password/forgot`, { method: "POST", headers: { "content-type": "application/json" }, body: await req.text() });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
