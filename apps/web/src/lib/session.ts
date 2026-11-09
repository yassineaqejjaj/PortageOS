import { NextRequest } from "next/server";
import { API_URL, COOKIE, REFRESH } from "./server";

export interface Renewed { accessToken: string; refreshToken?: string; expiresIn: number }
/** Appelle l'API avec le jeton de session ; si l'accès a expiré, effectue UNE rotation du jeton de rafraîchissement puis relance. */
export async function withSession(req: NextRequest, call: (token: string) => Promise<Response>): Promise<{ res: Response | null; renewed: Renewed | null; expired: boolean }> {
  let token = req.cookies.get(COOKIE)?.value; const refresh = req.cookies.get(REFRESH)?.value;
  if (!token && !refresh) return { res: null, renewed: null, expired: false };
  let res = token ? await call(token) : null; let renewed: Renewed | null = null;
  if ((!res || res.status === 401) && refresh) {
    const rr = await fetch(`${API_URL}/auth/refresh`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: refresh }) });
    if (!rr.ok) return { res: null, renewed: null, expired: true };
    renewed = await rr.json(); token = renewed!.accessToken; res = await call(token);
  }
  return { res, renewed, expired: false };
}
