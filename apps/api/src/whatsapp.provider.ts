/**
 * Fournisseurs WhatsApp. « meta » = WhatsApp Cloud API (Graph API). « fake » = local uniquement : n'envoie RIEN, interdit en production.
 * Le produit n'affirme « vérifié » qu'après un appel réel réussi à Meta (check) ; sans identifiants, aucun envoi n'est tenté.
 */
export interface WaCreds { phoneNumberId: string; accessToken: string }
export interface WaTemplateCall { name: string; language: string; params: string[] }
export interface WaProvider {
  readonly name: "meta" | "fake";
  sendText(c: WaCreds, to: string, text: string): Promise<{ id: string }>;
  sendTemplate(c: WaCreds, to: string, t: WaTemplateCall): Promise<{ id: string }>;
  check(c: WaCreds): Promise<{ displayPhone?: string; verifiedName?: string }>;
}
export class WaProviderError extends Error {}
type Fetch = typeof fetch;

export class MetaCloudProvider implements WaProvider {
  readonly name = "meta" as const;
  constructor(private f: Fetch = fetch, private version = process.env.WHATSAPP_GRAPH_VERSION ?? "v21.0", private base = "https://graph.facebook.com") {}
  private async call(c: WaCreds, path: string, init: { method: "GET" | "POST"; body?: unknown }) {
    let res: Response;
    try {
      res = await this.f(`${this.base}/${this.version}/${path}`, { method: init.method, headers: { Authorization: `Bearer ${c.accessToken}`, "content-type": "application/json" },
        body: init.body ? JSON.stringify(init.body) : undefined, signal: AbortSignal.timeout(10_000) });
    } catch (e) { throw new WaProviderError(`Meta injoignable : ${(e as Error).name === "TimeoutError" ? "délai dépassé" : "erreur réseau"}`); }
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number }; messages?: { id: string }[]; display_phone_number?: string; verified_name?: string };
    if (!res.ok) throw new WaProviderError(`Meta ${res.status}${json.error?.code ? ` (code ${json.error.code})` : ""} : ${(json.error?.message ?? "erreur").slice(0, 160)}`);
    return json;
  }
  private digits = (to: string) => to.replace(/^\+/, "");
  async sendText(c: WaCreds, to: string, text: string) {
    const j = await this.call(c, `${c.phoneNumberId}/messages`, { method: "POST", body: { messaging_product: "whatsapp", to: this.digits(to), type: "text", text: { body: text } } });
    const id = j.messages?.[0]?.id; if (!id) throw new WaProviderError("Réponse Meta sans identifiant de message"); return { id };
  }
  async sendTemplate(c: WaCreds, to: string, t: WaTemplateCall) {
    const body = { messaging_product: "whatsapp", to: this.digits(to), type: "template",
      template: { name: t.name, language: { code: t.language }, ...(t.params.length ? { components: [{ type: "body", parameters: t.params.map(text => ({ type: "text", text })) }] } : {}) } };
    const j = await this.call(c, `${c.phoneNumberId}/messages`, { method: "POST", body });
    const id = j.messages?.[0]?.id; if (!id) throw new WaProviderError("Réponse Meta sans identifiant de message"); return { id };
  }
  async check(c: WaCreds) {
    const j = await this.call(c, `${c.phoneNumberId}?fields=display_phone_number,verified_name`, { method: "GET" });
    return { displayPhone: j.display_phone_number, verifiedName: j.verified_name };
  }
}

/** Faux fournisseur local : aucun appel réseau ; les messages sont marqués « simulated ». */
export class FakeProvider implements WaProvider {
  readonly name = "fake" as const;
  static sent: { to: string; kind: string; payload: unknown }[] = [];
  async sendText(_c: WaCreds, to: string, text: string) { FakeProvider.sent.push({ to, kind: "text", payload: text }); return { id: `fake-${FakeProvider.sent.length}-${Date.now()}` }; }
  async sendTemplate(_c: WaCreds, to: string, t: WaTemplateCall) { FakeProvider.sent.push({ to, kind: "template", payload: t }); return { id: `fake-${FakeProvider.sent.length}-${Date.now()}` }; }
  async check() { return { displayPhone: "+0 (simulé)" }; }
}
