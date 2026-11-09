import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/** Journal structuré JSON (une ligne par requête). Jamais de corps, d'en-têtes, de requête (query) ni d'identifiants dans le chemin. */
const ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
export const routeLabel = (path: string) => path.replace(ID, ":id").replace(/\/\d{4}-\d{2}(?=\/|$)/g, "/:period").slice(0, 120);

export const metrics = { started: Date.now(), requests: new Map<string, number>(), durationMsSum: 0, durationCount: 0, buckets: [50, 100, 250, 500, 1000, 2500].map(le => ({ le, n: 0 })) };
export function observe(method: string, route: string, status: number, ms: number) {
  const k = `${method}|${route}|${Math.floor(status / 100)}xx`; metrics.requests.set(k, (metrics.requests.get(k) ?? 0) + 1);
  if (metrics.requests.size > 2000) metrics.requests.clear(); // borne mémoire
  metrics.durationMsSum += ms; metrics.durationCount++; for (const b of metrics.buckets) if (ms <= b.le) b.n++;
}
export function renderMetrics() {
  const L = ["# HELP portage_http_requests_total Requêtes HTTP", "# TYPE portage_http_requests_total counter"];
  for (const [k, n] of metrics.requests) { const [m, r, c] = k.split("|"); L.push(`portage_http_requests_total{method="${m}",route="${r!.replace(/"/g, "")}",class="${c}"} ${n}`); }
  L.push("# TYPE portage_http_request_duration_ms histogram");
  for (const b of metrics.buckets) L.push(`portage_http_request_duration_ms_bucket{le="${b.le}"} ${b.n}`);
  L.push(`portage_http_request_duration_ms_bucket{le="+Inf"} ${metrics.durationCount}`, `portage_http_request_duration_ms_sum ${metrics.durationMsSum}`, `portage_http_request_duration_ms_count ${metrics.durationCount}`);
  L.push("# TYPE portage_uptime_seconds gauge", `portage_uptime_seconds ${Math.round((Date.now() - metrics.started) / 1000)}`);
  return L.join("\n") + "\n";
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const inbound = req.header("x-request-id"); const reqId = inbound && /^[A-Za-z0-9-]{8,64}$/.test(inbound) ? inbound : randomUUID();
  (req as Request & { reqId: string }).reqId = reqId; res.setHeader("x-request-id", reqId);
  const t0 = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6; const route = routeLabel(req.path);
    observe(req.method, route, res.statusCode, ms);
    if (process.env.NODE_ENV === "test" || route === "/health" || route === "/health/ready") return;
    const ctx = (req as Request & { ctx?: { tenantId?: string; userId?: string } }).ctx;
    process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level: res.statusCode >= 500 ? "error" : "info", msg: "http", reqId, method: req.method, route, status: res.statusCode, ms: Math.round(ms), tenantId: ctx?.tenantId, userId: ctx?.userId }) + "\n");
  });
  next();
}
