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
  new RegExp(`^invoices/${U}/credit$`),
  new RegExp(`^rules/parameters(/${U}/approve)?$`),
  new RegExp(`^expenses(/${U}/transition)?$`),
  /^me\/expenses$/, new RegExp(`^me/expenses/${U}/(lines|transition)$`),
  /^me\/account$/, new RegExp(`^accounts/${U}$`),
  /^contract-templates$/, new RegExp(`^contract-templates/${U}/publish$`),
  new RegExp(`^contracts(/${U}(/transition)?)?$`),
  /^me\/leaves$/, new RegExp(`^me/leaves/${U}/cancel$`), /^me\/leave-balance$/,
  /^leaves$/, new RegExp(`^leaves/${U}/transition$`), new RegExp(`^leave-balances/${U}$`), /^leave-adjustments$/,
  /^agents$/, /^agents\/[a-z]{3,20}\/config$/, /^agent-runs$/, new RegExp(`^agent-runs/${U}(/cancel)?$`), new RegExp(`^agent-proposals/${U}/decision$`), /^me\/agent-runs$/,
  /^notifications$/, /^notifications\/(unread-count|read-all)$/, new RegExp(`^notifications/${U}/read$`), /^notification-preferences$/,
  /^support\/tickets$/, new RegExp(`^support/tickets/${U}(/messages|/transition|/assign)?$`), /^support\/(staff|templates)$/,
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
