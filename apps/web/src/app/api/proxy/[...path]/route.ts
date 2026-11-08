import { NextRequest, NextResponse } from "next/server";
import { API_URL, COOKIE } from "@/lib/server";

// Liste blanche: le front ne peut atteindre que ces routes de l'API.
const U = "[0-9a-f-]{36}";
const ALLOWED = [
  /^me$/, new RegExp(`^companies(/${U})?$`), /^audit$/, /^members$/,
  new RegExp(`^prospects(/${U}(/transition)?)?$`),
  new RegExp(`^consultants(/${U}(/activate|/tasks/[a-z_]+)?)?$`),
  new RegExp(`^missions(/${U})?$`),
  new RegExp(`^timesheets(/${U}(/transition)?|/missions/${U}/\\d{4}-\\d{2})?$`),
  /^me\/(missions|timesheets)$/, new RegExp(`^me/timesheets/missions/${U}/\\d{4}-\\d{2}$`), new RegExp(`^me/timesheets/${U}/transition$`),
  new RegExp(`^client/timesheets(/${U}/transition)?$`),
  new RegExp(`^invoices(/${U}(/issue|/payments|/cancel)?)?$`),
  /^ledger\/(entries|trial-balance|reconciliation)$/,
];

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const p = path.join("/");
  if (!ALLOWED.some(r => r.test(p))) return NextResponse.json({ error: { message: "Introuvable" } }, { status: 404 });
  const token = req.cookies.get(COOKIE)?.value;
  if (!token) return NextResponse.json({ error: { message: "Non authentifié" } }, { status: 401 });
  if (req.method !== "GET") {
    const o = req.headers.get("origin");
    if (o !== req.nextUrl.origin) return NextResponse.json({ error: { message: "Origine refusée" } }, { status: 403 }); // CSRF
  }
  const r = await fetch(`${API_URL}/${p}${req.nextUrl.search}`, {
    method: req.method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: req.method === "GET" ? undefined : await req.text(),
  });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
export { handle as GET, handle as POST, handle as PATCH, handle as PUT };
