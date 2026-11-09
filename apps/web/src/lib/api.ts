export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const r = await fetch(`/api/proxy/${path}`, {
    method: init?.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, `${data?.error?.message ?? "Erreur"}${Array.isArray(data?.error?.details) ? " — " + data.error.details.join(" ; ") : ""}`);
  return data as T;
}

/** Texte brut (CSV) via le proxy : n'accepte que du texte, jamais de binaire. */
export async function apiText(path: string, init?: { method?: string; body?: unknown }): Promise<string> {
  const r = await fetch(`/api/proxy/${path}`, { method: init?.method ?? "GET", headers: { "content-type": "application/json" }, body: init?.body ? JSON.stringify(init.body) : undefined });
  const t = await r.text();
  if (!r.ok) { let m = "Erreur"; try { m = JSON.parse(t)?.error?.message ?? m; } catch { /* texte */ } throw new ApiError(r.status, m); }
  return t;
}
