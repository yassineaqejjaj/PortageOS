import { NextRequest, NextResponse } from "next/server";
import { API_URL, COOKIE, REFRESH, clearSessionCookies, setSessionCookies } from "@/lib/server";

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
  /^pilotage\/(overview|export\.csv)$/, /^auth\/sessions(\/revoke-others)?$/, new RegExp(`^auth/sessions/${U}$`), /^auth\/password$/, /^auth\/mfa\/(setup|enable|disable)$/,
  /^members$/, new RegExp(`^members/${U}(/reset-link)?$`), /^invitations$/, new RegExp(`^invitations/${U}$`), /^tenant\/security$/,
  /^accounting\/(accounts|periods|balance|vat|third-parties|entries|dossier|export\/fec|export\/balance\.csv)$/, /^accounting\/accounts\/\d{3,8}$/,
  /^accounting\/periods\/\d{4}-\d{2}\/(checks|close|reopen)$/, new RegExp(`^accounting/entries/${U}/reverse$`),
  /^documents\/policy$/, /^documents$/, new RegExp(`^documents/${U}(/link|/purge)?$`),
  /^notifications$/, /^notifications\/(unread-count|read-all)$/, new RegExp(`^notifications/${U}/read$`), /^notification-preferences$/,
  /^crm\/(scoring|prospects|tasks|campaigns|referrers|referrals|commissions|agreements|imports|simulations)$/, new RegExp(`^crm/prospects/${U}(/interactions)?$`), new RegExp(`^crm/tasks/${U}/(done|cancel)$`),
  new RegExp(`^crm/campaigns/${U}/(transition|prospects|stats)$`), new RegExp(`^crm/referrers/${U}$`), new RegExp(`^crm/commissions/${U}/transition$`), new RegExp(`^crm/agreements/${U}/transition$`),
  /^crm\/imports\/preview$/, new RegExp(`^crm/imports/${U}(/commit|/cancel|/rollback)?$`),
  /^support\/tickets$/, new RegExp(`^support/tickets/${U}(/messages|/transition|/assign)?$`), /^support\/(staff|templates)$/,
];

async function callApi(req: NextRequest, p: string, token: string, body: string | undefined) {
  return fetch(`${API_URL}/${p}${req.nextUrl.search}`, { method: req.method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body });
}

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const p = path.join("/");
  if (!ALLOWED.some(r => r.test(p))) return NextResponse.json({ error: { message: "Introuvable" } }, { status: 404 });
  let token = req.cookies.get(COOKIE)?.value; const refresh = req.cookies.get(REFRESH)?.value;
  if (!token && !refresh) return NextResponse.json({ error: { message: "Non authentifié" } }, { status: 401 });
  if (req.method !== "GET") { const o = req.headers.get("origin"); if (o !== req.nextUrl.origin) return NextResponse.json({ error: { message: "Origine refusée" } }, { status: 403 }); } // CSRF
  const body = req.method === "GET" ? undefined : await req.text();
  let renewed: { accessToken: string; refreshToken?: string; expiresIn: number } | null = null;
  let r = token ? await callApi(req, p, token, body) : null;
  if ((!r || r.status === 401) && refresh) {
    // jeton d'accès expiré : rotation du jeton de rafraîchissement, puis une seule relance
    const rr = await fetch(`${API_URL}/auth/refresh`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: refresh }) });
    if (!rr.ok) { const res = NextResponse.json({ error: { message: "Session expirée" } }, { status: 401 }); clearSessionCookies(res); return res; }
    renewed = await rr.json(); token = renewed!.accessToken; r = await callApi(req, p, token, body);
  }
  const headers: Record<string, string> = { "content-type": r!.headers.get("content-type")?.startsWith("text/csv") ? "text/csv; charset=utf-8" : r!.headers.get("content-type")?.startsWith("text/plain") ? "text/plain; charset=utf-8" : "application/json" };
  const cd = r!.headers.get("content-disposition"); if (cd && /^attachment; filename="[\w.-]+"$/.test(cd)) headers["content-disposition"] = cd;
  const res = new NextResponse(await r!.text(), { status: r!.status, headers });
  if (renewed) setSessionCookies(res, renewed);
  return res;
}
export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
