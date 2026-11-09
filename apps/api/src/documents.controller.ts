import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Req, Res, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { z } from "zod";
import { PrismaService } from "./prisma.service";
import { Public, RequestContext } from "./auth.guard";
import { CATEGORIES, DISCLOSURE, DocumentsService, MAX_BYTES, OWNER_TYPES } from "./documents.service";
import { parseZod } from "./workflow";

const Upload = z.object({ ownerType: z.enum(OWNER_TYPES), ownerId: z.string().uuid(), category: z.string().max(40) });
const Reason = z.object({ reason: z.string().min(5, "Motif obligatoire (5 caractères min.)").max(500) });
const Link = z.object({ minutes: z.number().int().min(1).max(15) });
type R = { ctx: RequestContext };

function send(res: Response, doc: { mime: string; name: string }, data: Buffer) {
  res.setHeader("Content-Type", doc.mime);
  res.setHeader("Content-Disposition", `attachment; filename="${doc.name.replace(/"/g, "")}"`); // jamais affiché en ligne
  res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'"); res.setHeader("Cache-Control", "private, no-store");
  return new StreamableFile(data);
}

@Controller("documents")
export class DocumentsController {
  constructor(private prisma: PrismaService, private svc: DocumentsService) {}

  @Get("policy")
  policy() { return { maxBytes: MAX_BYTES, allowed: ["application/pdf", "image/png", "image/jpeg", "image/webp"], categories: CATEGORIES, scanner: process.env.CLAMAV_HOST ? "clamav" : "not_connected", note: DISCLOSURE.scanner }; }

  @Post() @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_BYTES, files: 1 } }))
  upload(@Req() { ctx }: R, @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined, @Body() body: unknown) {
    const d = parseZod(Upload, body);
    return this.svc.upload(ctx, file, d);
  }

  @Get()
  list(@Req() { ctx }: R, @Query("ownerType") ownerType?: string, @Query("ownerId") ownerId?: string) {
    const d = parseZod(Upload.pick({ ownerType: true, ownerId: true }), { ownerType, ownerId });
    return this.prisma.forTenant(ctx.tenantId, tx => this.svc.list(tx, ctx, d.ownerType, d.ownerId));
  }

  /** Téléchargement par lien temporaire signé (public, durée ≤ 15 min, documents non sensibles). */
  @Public() @Get("shared/:token")
  async shared(@Param("token") token: string, @Res({ passthrough: true }) res: Response) { if (token.length > 2000) throw new BadRequestException(); const r = await this.svc.sharedDownload(token); return send(res, r.doc, r.data); }

  @Get(":id")
  meta(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) { return this.prisma.forTenant(ctx.tenantId, tx => this.svc.meta(tx, ctx, id)); }

  @Get(":id/download")
  async download(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) { const r = await this.prisma.forTenant(ctx.tenantId, tx => this.svc.download(tx, ctx, id)); return send(res, r.doc, r.data); }

  @Post(":id/link")
  link(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) { const d = parseZod(Link, body); return this.prisma.forTenant(ctx.tenantId, tx => this.svc.createLink(tx, ctx, id, d.minutes)); }

  @Delete(":id")
  async remove(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) { const d = parseZod(Reason, body); await this.prisma.forTenant(ctx.tenantId, tx => this.svc.remove(tx, ctx, id, d.reason)); return { ok: true }; }

  @Post(":id/purge")
  async purge(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) { const d = parseZod(Reason, body); await this.prisma.forTenant(ctx.tenantId, tx => this.svc.purge(tx, ctx, id, d.reason)); return { ok: true }; }
}
