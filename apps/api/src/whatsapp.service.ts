import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { WHATSAPP_TEMPLATES, WhatsappSubjectType, advanceStatus, isStopKeyword, isTemplateKey, isWithinServiceWindow, renderTemplatePreview } from "@portage/domain";
import { PrismaService, Tx } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext } from "./auth.guard";
import { open, seal } from "./secretbox";
import { FakeProvider, MetaCloudProvider, WaCreds, WaProvider } from "./whatsapp.provider";

const SYSTEM = "00000000-0000-0000-0000-000000000000";
export type WaInbound = { phone_number_id: string; from: string; id: string; text?: string; type: string; name?: string };

@Injectable()
export class WhatsappService {
  private log = new Logger("whatsapp");
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /** Le faux fournisseur n'existe qu'en dehors de la production. En production sans jeton valide : « non connecté ». */
  provider(): WaProvider {
    if (process.env.WHATSAPP_PROVIDER === "fake" && process.env.NODE_ENV !== "production") return new FakeProvider();
    return new MetaCloudProvider();
  }
  get webhookConfigured() { return !!process.env.WHATSAPP_APP_SECRET && !!process.env.WHATSAPP_VERIFY_TOKEN; }

  async creds(tx: Tx, tenantId: string): Promise<WaCreds | null> {
    const ch = await tx.whatsappChannel.findUnique({ where: { tenantId } });
    if (!ch || ch.status === "disabled") return null;
    if (this.provider().name === "fake") return { phoneNumberId: ch.phoneNumberId, accessToken: "fake" };
    return ch.accessTokenSealed ? { phoneNumberId: ch.phoneNumberId, accessToken: open(ch.accessTokenSealed) } : null;
  }

  async channelView(tx: Tx, tenantId: string) {
    const ch = await tx.whatsappChannel.findUnique({ where: { tenantId } });
    const templates = await tx.whatsappTemplate.findMany({ where: { tenantId } });
    return {
      provider: this.provider().name,
      simulated: this.provider().name === "fake",
      webhookConfigured: this.webhookConfigured,
      channel: ch ? { phoneNumberId: ch.phoneNumberId, wabaId: ch.wabaId, displayPhone: ch.displayPhone, status: ch.status, hasToken: !!ch.accessTokenSealed, lastCheckedAt: ch.lastCheckedAt, lastError: ch.lastError } : null,
      templates: (Object.keys(WHATSAPP_TEMPLATES) as (keyof typeof WHATSAPP_TEMPLATES)[]).map(key => {
        const t = templates.find(x => x.key === key);
        return { key, label: WHATSAPP_TEMPLATES[key].label, params: WHATSAPP_TEMPLATES[key].params, preview: WHATSAPP_TEMPLATES[key].preview, suggestedName: WHATSAPP_TEMPLATES[key].suggestedName,
          metaName: t?.metaName ?? null, language: t?.language ?? "fr", enabled: t?.enabled ?? false };
      }),
    };
  }

  async saveChannel(tx: Tx, ctx: RequestContext, d: { phoneNumberId: string; wabaId?: string; accessToken?: string }) {
    const taken = await this.prisma.whatsappRoute.findUnique({ where: { phoneNumberId: d.phoneNumberId } });
    if (taken && taken.tenantId !== ctx.tenantId) throw new ConflictException("Ce numéro WhatsApp est déjà rattaché à une autre société");
    const existing = await tx.whatsappChannel.findUnique({ where: { tenantId: ctx.tenantId } });
    if (!d.accessToken && !existing?.accessTokenSealed && this.provider().name !== "fake") throw new BadRequestException("Jeton d'accès requis pour une première configuration");
    const data = { phoneNumberId: d.phoneNumberId, wabaId: d.wabaId ?? null, status: "configured", lastError: null, lastCheckedAt: null, ...(d.accessToken ? { accessTokenSealed: seal(d.accessToken) } : {}) };
    await tx.whatsappChannel.upsert({ where: { tenantId: ctx.tenantId }, create: { tenantId: ctx.tenantId, ...data }, update: data });
    if (existing && existing.phoneNumberId !== d.phoneNumberId) await this.prisma.whatsappRoute.deleteMany({ where: { tenantId: ctx.tenantId } });
    await this.prisma.whatsappRoute.upsert({ where: { phoneNumberId: d.phoneNumberId }, create: { phoneNumberId: d.phoneNumberId, tenantId: ctx.tenantId }, update: {} });
    await this.audit.record(tx, ctx, { action: "whatsapp.channel_saved", entity: "WhatsappChannel", entityId: ctx.tenantId, after: { phoneNumberId: d.phoneNumberId, tokenChanged: !!d.accessToken } });
  }

  async verifyChannel(tx: Tx, ctx: RequestContext) {
    const c = await this.creds(tx, ctx.tenantId);
    if (!c) throw new ConflictException("Canal WhatsApp non configuré");
    const p = this.provider();
    try {
      const r = await p.check(c);
      await tx.whatsappChannel.update({ where: { tenantId: ctx.tenantId }, data: { status: "verified", lastCheckedAt: new Date(), lastError: null, displayPhone: r.displayPhone ?? undefined } });
      await this.audit.record(tx, ctx, { action: "whatsapp.channel_verified", entity: "WhatsappChannel", entityId: ctx.tenantId, after: { provider: p.name } });
      return { status: "verified", provider: p.name, displayPhone: r.displayPhone ?? null, verifiedName: r.verifiedName ?? null };
    } catch (e) {
      const msg = (e as Error).message.slice(0, 200);
      await tx.whatsappChannel.update({ where: { tenantId: ctx.tenantId }, data: { status: "error", lastCheckedAt: new Date(), lastError: msg } });
      return { status: "error", provider: p.name, error: msg };
    }
  }

  async disableChannel(tx: Tx, ctx: RequestContext) {
    const ch = await tx.whatsappChannel.findUnique({ where: { tenantId: ctx.tenantId } });
    if (!ch) throw new NotFoundException();
    await tx.whatsappChannel.update({ where: { tenantId: ctx.tenantId }, data: { status: "disabled", accessTokenSealed: null } });
    await this.prisma.whatsappRoute.deleteMany({ where: { tenantId: ctx.tenantId } });
    await this.audit.record(tx, ctx, { action: "whatsapp.channel_disabled", entity: "WhatsappChannel", entityId: ctx.tenantId });
  }

  async ensureConversation(tx: Tx, tenantId: string, phone: string, subject?: { type: string; id: string; name?: string }) {
    const existing = await tx.whatsappConversation.findUnique({ where: { tenantId_phone: { tenantId, phone } } });
    if (existing) {
      if (subject && !existing.subjectId) return tx.whatsappConversation.update({ where: { id: existing.id }, data: { subjectType: subject.type, subjectId: subject.id, displayName: subject.name } });
      return existing;
    }
    return tx.whatsappConversation.create({ data: { tenantId, phone, subjectType: subject?.type, subjectId: subject?.id, displayName: subject?.name } });
  }

  async subjectName(tx: Tx, type: WhatsappSubjectType, id: string): Promise<string> {
    if (type === "consultant") { const c = await tx.consultant.findUnique({ where: { id } }); if (!c) throw new NotFoundException("Consultant introuvable"); return `${c.firstName} ${c.lastName}`; }
    const c = await tx.companyContact.findUnique({ where: { id } }); if (!c) throw new NotFoundException("Contact introuvable"); return c.name;
  }

  async setConsent(tx: Tx, ctx: RequestContext, d: { subjectType: WhatsappSubjectType; subjectId: string; phone: string; status: "opted_in" | "opted_out"; source: string; evidence?: string }) {
    const name = await this.subjectName(tx, d.subjectType, d.subjectId);
    const before = await tx.whatsappConsent.findUnique({ where: { tenantId_subjectType_subjectId: { tenantId: ctx.tenantId, subjectType: d.subjectType, subjectId: d.subjectId } } });
    const row = await tx.whatsappConsent.upsert({
      where: { tenantId_subjectType_subjectId: { tenantId: ctx.tenantId, subjectType: d.subjectType, subjectId: d.subjectId } },
      create: { tenantId: ctx.tenantId, subjectType: d.subjectType, subjectId: d.subjectId, phone: d.phone, status: d.status, source: d.source, evidence: d.evidence, recordedBy: ctx.userId },
      update: { phone: d.phone, status: d.status, source: d.source, evidence: d.evidence ?? null, recordedBy: ctx.userId } });
    await this.ensureConversation(tx, ctx.tenantId, d.phone, { type: d.subjectType, id: d.subjectId, name });
    await this.audit.record(tx, ctx, { action: `whatsapp.consent_${d.status}`, entity: "WhatsappConsent", entityId: row.id, before: before ? { status: before.status, phone: before.phone } : undefined, after: { status: d.status, source: d.source, subjectType: d.subjectType, subjectId: d.subjectId } });
    return row;
  }

  /** Crée un message sortant « en file ». Retourne la raison si l'envoi est refusé (consentement, modèle non déclaré/activé). */
  async queueTemplate(tx: Tx, ctx: RequestContext, d: { subjectType: WhatsappSubjectType; subjectId: string; key: string; params: string[]; automatic: boolean }) {
    if (!isTemplateKey(d.key)) throw new BadRequestException("Modèle inconnu");
    if (d.params.length !== WHATSAPP_TEMPLATES[d.key].params.length) throw new BadRequestException(`Paramètres attendus : ${WHATSAPP_TEMPLATES[d.key].params.join(", ")}`);
    const consent = await tx.whatsappConsent.findUnique({ where: { tenantId_subjectType_subjectId: { tenantId: ctx.tenantId, subjectType: d.subjectType, subjectId: d.subjectId } } });
    if (!consent || consent.status !== "opted_in") return { queued: false as const, reason: "no_consent" as const };
    const tpl = await tx.whatsappTemplate.findUnique({ where: { tenantId_key: { tenantId: ctx.tenantId, key: d.key } } });
    if (!tpl || (d.automatic && !tpl.enabled)) return { queued: false as const, reason: "template_not_enabled" as const };
    const conv = await this.ensureConversation(tx, ctx.tenantId, consent.phone, { type: d.subjectType, id: d.subjectId });
    const m = await tx.whatsappMessage.create({ data: { tenantId: ctx.tenantId, conversationId: conv.id, direction: "out", kind: "template", templateKey: d.key, templateParams: d.params, body: renderTemplatePreview(d.key, d.params), status: "queued", sentBy: ctx.userId === SYSTEM ? null : ctx.userId } });
    await tx.whatsappConversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });
    return { queued: true as const, messageId: m.id };
  }

  async queueText(tx: Tx, ctx: RequestContext, conversationId: string, text: string) {
    const conv = await tx.whatsappConversation.findUnique({ where: { id: conversationId } });
    if (!conv) throw new NotFoundException();
    const consent = await tx.whatsappConsent.findFirst({ where: { tenantId: ctx.tenantId, phone: conv.phone } });
    if (consent?.status === "opted_out") throw new ConflictException({ message: "Cette personne a retiré son consentement : aucun message ne peut lui être envoyé.", code: "opted_out" });
    if (!isWithinServiceWindow(conv.lastInboundAt)) throw new ConflictException({ message: "Hors fenêtre de 24 h : seul un message modèle approuvé peut être envoyé.", code: "outside_window" });
    const m = await tx.whatsappMessage.create({ data: { tenantId: ctx.tenantId, conversationId, direction: "out", kind: "text", body: text, status: "queued", sentBy: ctx.userId } });
    await tx.whatsappConversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });
    return m;
  }

  /** Envoie les messages en file du tenant, hors transaction longue : un message est « réservé » (sending) avant tout appel réseau. */
  async flush(tenantId: string, limit = 25) {
    const claimed = await this.prisma.forTenant(tenantId, async tx => {
      const rows = await tx.whatsappMessage.findMany({ where: { status: "queued", direction: "out" }, orderBy: { createdAt: "asc" }, take: limit, include: { conversation: true } });
      const mine: typeof rows = [];
      for (const r of rows) { // réservation message par message : deux envois simultanés ne prennent jamais le même message
        if ((await tx.whatsappMessage.updateMany({ where: { id: r.id, status: "queued" }, data: { status: "sending" } })).count === 1) mine.push(r);
      }
      return mine;
    });
    if (!claimed.length) return { processed: 0, sent: 0, failed: 0, notConnected: 0 };
    const out = { processed: claimed.length, sent: 0, failed: 0, notConnected: 0 };
    const p = this.provider();
    const creds = await this.prisma.forTenant(tenantId, tx => this.creds(tx, tenantId));
    for (const m of claimed) {
      let status: string, providerMessageId: string | undefined, error: string | undefined;
      if (!creds) { status = "not_connected"; error = "Canal WhatsApp non configuré"; out.notConnected++; }
      else {
        try {
          const r = m.kind === "text" ? await p.sendText(creds, m.conversation.phone, m.body) : await this.sendTpl(tenantId, p, creds, m.conversation.phone, m.templateKey!, m.templateParams);
          providerMessageId = r.id; status = p.name === "fake" ? "simulated" : "sent"; out.sent++;
        } catch (e) { status = "failed"; error = (e as Error).message.slice(0, 200); out.failed++; this.log.error(`envoi échoué (${m.kind}): ${error}`); }
      }
      await this.prisma.forTenant(tenantId, tx => tx.whatsappMessage.update({ where: { id: m.id }, data: { status, providerMessageId, error } }));
    }
    return out;
  }
  private async sendTpl(tenantId: string, p: WaProvider, c: WaCreds, to: string, key: string, params: string[]) {
    const tpl = await this.prisma.forTenant(tenantId, tx => tx.whatsappTemplate.findUnique({ where: { tenantId_key: { tenantId, key } } }));
    if (!tpl) throw new Error("Modèle non déclaré");
    return p.sendTemplate(c, to, { name: tpl.metaName, language: tpl.language, params });
  }

  // ---------- Webhook entrant ----------
  verifySignature(raw: Buffer | undefined, header: string | undefined): boolean {
    const secret = process.env.WHATSAPP_APP_SECRET;
    if (!secret || !raw || !header?.startsWith("sha256=")) return false;
    const expected = createHmac("sha256", secret).update(raw).digest();
    let got: Buffer; try { got = Buffer.from(header.slice(7), "hex"); } catch { return false; }
    return got.length === expected.length && timingSafeEqual(got, expected);
  }

  /** Traite une charge utile Meta déjà authentifiée. Idempotent : un message entrant ou un statut rejoué est ignoré. */
  async handlePayload(payload: unknown) {
    const res = { inbound: 0, duplicates: 0, statuses: 0, optOuts: 0, unknownNumber: 0 };
    const entries = ((payload as { entry?: unknown[] })?.entry ?? []) as { changes?: { field?: string; value?: any }[] }[];
    for (const e of entries) for (const ch of e.changes ?? []) {
      const v = ch.value; const pnid: string | undefined = v?.metadata?.phone_number_id;
      if (ch.field !== "messages" || !pnid) continue;
      const route = await this.prisma.whatsappRoute.findUnique({ where: { phoneNumberId: pnid } });
      if (!route) { res.unknownNumber++; continue; }
      const names = new Map<string, string>((v.contacts ?? []).map((c: any) => [String(c.wa_id), String(c.profile?.name ?? "")]));
      await this.prisma.forTenant(route.tenantId, async tx => {
        for (const m of (v.messages ?? []) as any[]) {
          const phone = `+${String(m.from ?? "").replace(/\D/g, "")}`;
          if (!/^\+[1-9]\d{7,14}$/.test(phone) || !m.id) continue;
          const dup = await tx.whatsappMessage.findFirst({ where: { tenantId: route.tenantId, providerMessageId: String(m.id) } });
          if (dup) { res.duplicates++; continue; }
          const text: string = m.type === "text" ? String(m.text?.body ?? "").slice(0, 4096) : `[${String(m.type ?? "message").slice(0, 30)} non pris en charge]`;
          const conv = await this.ensureConversation(tx, route.tenantId, phone);
          const consent = await tx.whatsappConsent.findFirst({ where: { tenantId: route.tenantId, phone } });
          if (!conv.displayName) {
            const n = names.get(phone.slice(1)); if (n) await tx.whatsappConversation.update({ where: { id: conv.id }, data: { displayName: n.slice(0, 80) } });
          }
          await tx.whatsappMessage.create({ data: { tenantId: route.tenantId, conversationId: conv.id, direction: "in", kind: "text", body: text, status: "received", providerMessageId: String(m.id) } });
          await tx.whatsappConversation.update({ where: { id: conv.id }, data: { lastInboundAt: new Date(), lastMessageAt: new Date(), unreadCount: { increment: 1 } } });
          res.inbound++;
          if (m.type === "text" && isStopKeyword(text) && consent && consent.status !== "opted_out") {
            await tx.whatsappConsent.update({ where: { id: consent.id }, data: { status: "opted_out", source: "stop_keyword", evidence: `message ${String(m.id).slice(0, 40)}` } });
            await this.audit.record(tx, { tenantId: route.tenantId, userId: SYSTEM }, { action: "whatsapp.consent_opted_out", entity: "WhatsappConsent", entityId: consent.id, before: { status: consent.status }, after: { status: "opted_out", source: "stop_keyword" } });
            res.optOuts++;
          }
        }
        for (const s of (v.statuses ?? []) as any[]) {
          const msg = await tx.whatsappMessage.findFirst({ where: { tenantId: route.tenantId, providerMessageId: String(s.id), direction: "out" } });
          if (!msg) continue;
          const next = advanceStatus(msg.status, String(s.status));
          const error = s.status === "failed" ? String(s.errors?.[0]?.title ?? "échec signalé par Meta").slice(0, 200) : undefined;
          if (next !== msg.status) { await tx.whatsappMessage.update({ where: { id: msg.id }, data: { status: next, ...(error ? { error } : {}) } }); res.statuses++; }
        }
      });
    }
    return res;
  }
}
