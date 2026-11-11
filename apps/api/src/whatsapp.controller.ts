import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UnauthorizedException } from "@nestjs/common";
import { z } from "zod";
import { WHATSAPP_CONSENT_SOURCES, WHATSAPP_SUBJECT_TYPES, WHATSAPP_TEMPLATES, isTemplateKey, normalizePhone, isWithinServiceWindow } from "@portage/domain";
import { PrismaService } from "./prisma.service";
import { Public, RequestContext, RequirePermission } from "./auth.guard";
import { WhatsappService } from "./whatsapp.service";
import { parseZod } from "./workflow";

type R = { ctx: RequestContext };
const Phone = z.string().min(6).max(30).transform((v, c) => { const p = normalizePhone(v); if (!p) c.addIssue({ code: "custom", message: "Numéro invalide (format international, ex. +33 6 12 34 56 78)" }); return p ?? ""; });
const Channel = z.object({ phoneNumberId: z.string().regex(/^\d{5,25}$/, "Identifiant de numéro Meta (chiffres)"), wabaId: z.string().regex(/^\d{5,25}$/).optional(), accessToken: z.string().min(20).max(1000).optional() });
const Templates = z.object({ templates: z.array(z.object({ key: z.string(), metaName: z.string().regex(/^[a-z0-9_]{1,512}$/, "Nom de modèle Meta (minuscules, chiffres, _)"), language: z.string().regex(/^[a-z]{2}(_[A-Z]{2})?$/).default("fr"), enabled: z.boolean() })).max(20) });
const Consent = z.object({ subjectType: z.enum(WHATSAPP_SUBJECT_TYPES), subjectId: z.string().uuid(), phone: Phone, status: z.enum(["opted_in", "opted_out"]), source: z.enum(WHATSAPP_CONSENT_SOURCES), evidence: z.string().max(300).optional() });
const Text = z.object({ text: z.string().trim().min(1).max(1000) });
const SendTpl = z.object({ subjectType: z.enum(WHATSAPP_SUBJECT_TYPES), subjectId: z.string().uuid(), key: z.string(), params: z.array(z.string().max(200)).max(10) });

@Controller("whatsapp")
export class WhatsappController {
  constructor(private prisma: PrismaService, private svc: WhatsappService) {}

  @Get("channel") @RequirePermission("whatsapp.read")
  channel(@Req() { ctx }: R) { return this.prisma.forTenant(ctx.tenantId, tx => this.svc.channelView(tx, ctx.tenantId)); }

  @Put("channel") @RequirePermission("whatsapp.admin")
  async saveChannel(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parseZod(Channel, body);
    await this.prisma.forTenant(ctx.tenantId, tx => this.svc.saveChannel(tx, ctx, d));
    return this.prisma.forTenant(ctx.tenantId, tx => this.svc.channelView(tx, ctx.tenantId));
  }

  @Post("channel/verify") @RequirePermission("whatsapp.admin") @HttpCode(200)
  verify(@Req() { ctx }: R) { return this.prisma.forTenant(ctx.tenantId, tx => this.svc.verifyChannel(tx, ctx)); }

  @Delete("channel") @RequirePermission("whatsapp.admin") @HttpCode(204)
  async disable(@Req() { ctx }: R) { await this.prisma.forTenant(ctx.tenantId, tx => this.svc.disableChannel(tx, ctx)); }

  @Put("templates") @RequirePermission("whatsapp.admin")
  async saveTemplates(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parseZod(Templates, body);
    for (const t of d.templates) if (!isTemplateKey(t.key)) throw new BadRequestException(`Modèle inconnu : ${t.key}`);
    await this.prisma.forTenant(ctx.tenantId, async tx => {
      for (const t of d.templates) await tx.whatsappTemplate.upsert({ where: { tenantId_key: { tenantId: ctx.tenantId, key: t.key } }, create: { tenantId: ctx.tenantId, ...t }, update: { metaName: t.metaName, language: t.language, enabled: t.enabled } });
      await tx.auditEvent.create({ data: { tenantId: ctx.tenantId, actorId: ctx.userId, action: "whatsapp.templates_saved", entity: "WhatsappTemplate", after: d.templates as never } });
    });
    return this.prisma.forTenant(ctx.tenantId, tx => this.svc.channelView(tx, ctx.tenantId));
  }

  @Get("consents") @RequirePermission("whatsapp.read")
  consents(@Req() { ctx }: R, @Query("subjectType") subjectType?: string, @Query("subjectId") subjectId?: string) {
    return this.prisma.forTenant(ctx.tenantId, tx => tx.whatsappConsent.findMany({ where: { ...(subjectType ? { subjectType } : {}), ...(subjectId ? { subjectId } : {}) }, orderBy: { updatedAt: "desc" }, take: 200 }));
  }

  @Post("consents") @RequirePermission("whatsapp.write")
  setConsent(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parseZod(Consent, body);
    // Un consentement « opted_in » exige une trace de preuve (formulaire écrit, saisie en app, message entrant) : jamais « other » sans précision.
    if (d.status === "opted_in" && d.source === "other" && !d.evidence) throw new BadRequestException("Précisez la preuve du consentement");
    return this.prisma.forTenant(ctx.tenantId, tx => this.svc.setConsent(tx, ctx, d));
  }

  @Get("conversations") @RequirePermission("whatsapp.read")
  conversations(@Req() { ctx }: R) {
    return this.prisma.forTenant(ctx.tenantId, tx => tx.whatsappConversation.findMany({ orderBy: { lastMessageAt: "desc" }, take: 100 }));
  }

  @Get("conversations/:id/messages") @RequirePermission("whatsapp.read")
  async messages(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) {
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const conv = await tx.whatsappConversation.findUnique({ where: { id } });
      if (!conv) throw new NotFoundException();
      if (conv.unreadCount) await tx.whatsappConversation.update({ where: { id }, data: { unreadCount: 0 } });
      const consent = await tx.whatsappConsent.findFirst({ where: { phone: conv.phone } });
      const messages = await tx.whatsappMessage.findMany({ where: { conversationId: id }, orderBy: { createdAt: "asc" }, take: 500 });
      
      return { conversation: { ...conv, unreadCount: 0 }, consent: consent ? { status: consent.status, source: consent.source } : null, windowOpen: isWithinServiceWindow(conv.lastInboundAt), messages };
    });
  }

  @Post("conversations/:id/messages") @RequirePermission("whatsapp.write")
  async reply(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parseZod(Text, body);
    const m = await this.prisma.forTenant(ctx.tenantId, tx => this.svc.queueText(tx, ctx, id, d.text));
    await this.svc.flush(ctx.tenantId);
    return this.prisma.forTenant(ctx.tenantId, tx => tx.whatsappMessage.findUnique({ where: { id: m.id } }));
  }

  @Post("send-template") @RequirePermission("whatsapp.write")
  async sendTemplate(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parseZod(SendTpl, body);
    const r = await this.prisma.forTenant(ctx.tenantId, tx => this.svc.queueTemplate(tx, ctx, { ...d, automatic: false }));
    if (!r.queued) throw new BadRequestException({ message: r.reason === "no_consent" ? "Aucun consentement WhatsApp enregistré pour cette personne." : "Modèle non déclaré : renseignez son nom approuvé par Meta dans la configuration.", code: r.reason });
    await this.svc.flush(ctx.tenantId);
    return this.prisma.forTenant(ctx.tenantId, tx => tx.whatsappMessage.findUnique({ where: { id: r.messageId } }));
  }

  /** Relance l'envoi des messages restés en file (pas de tâche de fond durable : voir docs/BLOCKERS.md). */
  @Post("flush") @RequirePermission("whatsapp.write") @HttpCode(200)
  flush(@Req() { ctx }: R) { return this.svc.flush(ctx.tenantId); }

  @Get("catalog") @RequirePermission("whatsapp.read")
  catalog() { return WHATSAPP_TEMPLATES; }
}

/** Webhook Meta : public (pas de session), authentifié par signature HMAC-SHA256 du corps brut. Sans secret d'application configuré : refus (« non connecté »). */
@Controller("webhooks/whatsapp")
export class WhatsappWebhookController {
  constructor(private svc: WhatsappService) {}

  @Public() @Get()
  verify(@Query("hub.mode") mode: string, @Query("hub.verify_token") token: string, @Query("hub.challenge") challenge: string, @Res() res: any) {
    const expected = process.env.WHATSAPP_VERIFY_TOKEN;
    if (!expected || mode !== "subscribe" || token !== expected || !challenge) throw new ForbiddenException("Vérification refusée");
    res.type("text/plain").send(String(challenge).slice(0, 100));
  }

  @Public() @Post() @HttpCode(200)
  async receive(@Req() req: { rawBody?: Buffer; headers: Record<string, string | undefined>; body: unknown }) {
    if (!this.svc.webhookConfigured) throw new ForbiddenException("Webhook WhatsApp non configuré");
    if (!this.svc.verifySignature(req.rawBody, req.headers["x-hub-signature-256"])) throw new UnauthorizedException("Signature invalide");
    return this.svc.handlePayload(req.body);
  }
}
