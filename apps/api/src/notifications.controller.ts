import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "./prisma.service";
import { RequestContext } from "./auth.guard";
import { NOTIFICATION_TYPES } from "./notifications.service";
import { parseZod } from "./workflow";

type R = { ctx: RequestContext };
const Pref = z.object({ type: z.string(), enabled: z.boolean() });

/** Boîte de notifications strictement personnelle : tout est filtré par l'utilisateur authentifié. */
@Controller()
export class NotificationsController {
  constructor(private prisma: PrismaService) {}

  @Get("notifications")
  list(@Req() { ctx }: R, @Query("unread") unread?: string) {
    return this.prisma.forTenant(ctx.tenantId, tx => tx.notification.findMany({ where: { userId: ctx.userId, ...(unread === "1" ? { readAt: null } : {}) }, orderBy: { createdAt: "desc" }, take: 100 }));
  }

  @Get("notifications/unread-count")
  count(@Req() { ctx }: R) { return this.prisma.forTenant(ctx.tenantId, async tx => ({ count: await tx.notification.count({ where: { userId: ctx.userId, readAt: null } }) })); }

  @Post("notifications/read-all")
  readAll(@Req() { ctx }: R) { return this.prisma.forTenant(ctx.tenantId, async tx => ({ updated: (await tx.notification.updateMany({ where: { userId: ctx.userId, readAt: null }, data: { readAt: new Date() } })).count })); }

  @Post("notifications/:id/read")
  read(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) {
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const r = await tx.notification.updateMany({ where: { id, userId: ctx.userId }, data: { readAt: new Date() } });
      if (r.count !== 1) throw new NotFoundException();
      return { ok: true };
    });
  }

  @Get("notification-preferences")
  async prefs(@Req() { ctx }: R) {
    const rows = await this.prisma.forTenant(ctx.tenantId, tx => tx.notificationPreference.findMany({ where: { userId: ctx.userId } }));
    const off = new Map(rows.map(r => [r.type, r.enabled]));
    return { email: { status: "not_connected", note: "Aucun fournisseur d'e-mail n'est connecté : seules les notifications dans l'application sont envoyées." },
      types: Object.entries(NOTIFICATION_TYPES).map(([type, label]) => ({ type, label, enabled: off.get(type) ?? true })) };
  }

  @Put("notification-preferences")
  setPref(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parseZod(Pref, body);
    if (!NOTIFICATION_TYPES[d.type]) throw new BadRequestException("Type inconnu");
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      await tx.notificationPreference.upsert({ where: { userId_tenantId_type: { userId: ctx.userId, tenantId: ctx.tenantId, type: d.type } }, update: { enabled: d.enabled }, create: { userId: ctx.userId, tenantId: ctx.tenantId, type: d.type, enabled: d.enabled } });
      return d;
    });
  }
}
