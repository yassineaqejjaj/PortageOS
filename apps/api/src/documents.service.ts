import { BadRequestException, ConflictException, ForbiddenException, GoneException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException, UnprocessableEntityException } from "@nestjs/common";
import jwt from "jsonwebtoken";
import { createHash, randomUUID } from "node:crypto";
import { loadConfig } from "./config";
import { PrismaService, Tx } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext } from "./auth.guard";
import { can } from "./permissions";
import { detectMime, safeName } from "./file-type";
import { ScanUnavailable, scanBuffer } from "./scanner";

export const MAX_BYTES = 10 * 1024 * 1024;
export const OWNER_TYPES = ["consultant", "expense_claim", "contract", "general"] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];
export const CATEGORIES: Record<OwnerType, string[]> = { consultant: ["identity_document", "bank_details", "rc_pro", "contract_copy", "other"], expense_claim: ["receipt"], contract: ["contract_copy"], general: ["other"] };
/** Catégories sensibles : réservées à la RH/administration et à la personne concernée, jamais partageables par lien. */
export const SENSITIVE = ["identity_document", "bank_details"];
export const DISCLOSURE = { scanner: "Analyse antivirus (ClamAV) : active seulement si CLAMAV_HOST est configuré ; sinon les fichiers sont stockés « non analysés »." };
const BASE_CATEGORY: Record<OwnerType, string> = { consultant: "other", expense_claim: "receipt", contract: "contract_copy", general: "other" };
type Action = "read" | "write" | "delete";

@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /** Autorisation par objet : le propriétaire de l'objet lié, ou un rôle interne disposant du droit (catégories sensibles : droit dédié). */
  async authorize(tx: Tx, ctx: RequestContext, ownerType: OwnerType, ownerId: string, category: string, action: Action) {
    const sensitive = SENSITIVE.includes(category);
    const staff = (p: Parameters<typeof can>[1]) => { if (!can(ctx.roles, p) || (sensitive && !can(ctx.roles, "document.sensitive"))) throw new ForbiddenException("Accès au document refusé"); };
    if (ownerType === "consultant") {
      if (!(await tx.consultant.findUnique({ where: { id: ownerId }, select: { id: true } }))) throw new NotFoundException();
      if (ctx.consultantId === ownerId && action !== "delete") return; // la personne concernée, pour son propre dossier
      return staff(action === "read" ? "document.read" : action === "write" ? "document.write" : "document.delete");
    }
    if (ownerType === "expense_claim") {
      const c = await tx.expenseClaim.findUnique({ where: { id: ownerId }, select: { ownerUserId: true, status: true } });
      if (!c) throw new NotFoundException();
      if (c.ownerUserId === ctx.userId) { if (action === "write" && c.status !== "draft") throw new ConflictException("Note de frais non modifiable : ajout de justificatif impossible"); if (action !== "delete") return; }
      if (action === "read" && can(ctx.roles, "expense.read")) return;
      if (action === "delete" && can(ctx.roles, "document.delete")) return;
      throw c.ownerUserId === ctx.userId ? new ForbiddenException("Accès au document refusé") : new NotFoundException();
    }
    if (ownerType === "contract") {
      if (!(await tx.contract.findUnique({ where: { id: ownerId }, select: { id: true } }))) throw new NotFoundException();
      return staff(action === "read" ? "contract.read" : action === "write" ? "contract.write" : "document.delete");
    }
    return staff(action === "read" ? "document.read" : action === "write" ? "document.write" : "document.delete");
  }

  async upload(ctx: RequestContext, file: { buffer: Buffer; originalname: string } | undefined, d: { ownerType: OwnerType; ownerId: string; category: string }) {
    if (!file?.buffer?.length) throw new BadRequestException("Fichier manquant ou vide");
    if (file.buffer.length > MAX_BYTES) throw new BadRequestException("Fichier trop volumineux (10 Mo maximum)");
    if (!CATEGORIES[d.ownerType].includes(d.category)) throw new BadRequestException("Catégorie incompatible avec l'objet");
    const mime = detectMime(file.buffer);
    if (!mime) throw new BadRequestException("Type de fichier refusé : PDF, PNG, JPEG ou WebP uniquement (vérifié sur le contenu)");
    // 1) autorisation d'abord (inutile d'analyser un envoi non autorisé)
    await this.prisma.forTenant(ctx.tenantId, tx => this.authorize(tx, ctx, d.ownerType, d.ownerId, d.category, "write"));
    // 2) analyse antivirus (fail-closed si le démon est configuré mais injoignable)
    let scan; try { scan = await scanBuffer(file.buffer); } catch (e) { if (e instanceof ScanUnavailable) throw new ServiceUnavailableException("Analyse antivirus indisponible : envoi refusé par prudence"); throw e; }
    if (scan.status === "infected") {
      // transaction distincte : l'événement d'audit doit survivre au refus
      await this.prisma.forTenant(ctx.tenantId, tx => this.audit.record(tx, ctx, { action: "document.infected_rejected", entity: "Document", after: { ownerType: d.ownerType, ownerId: d.ownerId, signature: scan.signature, engine: scan.engine } }));
      throw new UnprocessableEntityException(`Fichier refusé : contenu malveillant détecté (${scan.signature})`);
    }
    // 3) stockage
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      await this.authorize(tx, ctx, d.ownerType, d.ownerId, d.category, "write");
      const sha256 = createHash("sha256").update(file.buffer).digest("hex");
      const doc = await tx.document.create({ data: { tenantId: ctx.tenantId, ownerType: d.ownerType, ownerId: d.ownerId, category: d.category, name: safeName(file.originalname, mime), mime, size: file.buffer.length, sha256, scanStatus: scan.status, scanEngine: scan.engine, uploadedBy: ctx.userId } });
      await tx.documentBlob.create({ data: { documentId: doc.id, tenantId: ctx.tenantId, data: new Uint8Array(file.buffer) } });
      await this.audit.record(tx, ctx, { action: "document.upload", entity: "Document", entityId: doc.id, after: { ownerType: d.ownerType, ownerId: d.ownerId, category: d.category, mime, size: doc.size, sha256, scanStatus: doc.scanStatus } });
      return this.view(doc);
    });
  }

  view(d: { id: string; ownerType: string; ownerId: string; category: string; name: string; mime: string; size: number; scanStatus: string; uploadedBy: string; createdAt: Date; deletedAt: Date | null }) {
    return { id: d.id, ownerType: d.ownerType, ownerId: d.ownerId, category: d.category, name: d.name, mime: d.mime, size: d.size, scanStatus: d.scanStatus, uploadedBy: d.uploadedBy, createdAt: d.createdAt, sensitive: SENSITIVE.includes(d.category), deleted: !!d.deletedAt };
  }

  async list(tx: Tx, ctx: RequestContext, ownerType: OwnerType, ownerId: string) {
    await this.authorize(tx, ctx, ownerType, ownerId, BASE_CATEGORY[ownerType], "read"); // objet inexistant (ou d'une autre société) : 404 ; accès de base refusé : 403
    const docs = await tx.document.findMany({ where: { ownerType, ownerId, deletedAt: null }, orderBy: { createdAt: "desc" }, take: 200 });
    const out = [];
    for (const d of docs) { try { await this.authorize(tx, ctx, ownerType, ownerId, d.category, "read"); out.push(this.view(d)); } catch (e) { if (!(e instanceof ForbiddenException)) throw e; } }
    return out;
  }

  private async load(tx: Tx, ctx: RequestContext, id: string, action: Action) {
    const d = await tx.document.findUnique({ where: { id } });
    if (!d) throw new NotFoundException();
    await this.authorize(tx, ctx, d.ownerType as OwnerType, d.ownerId, d.category, action);
    return d;
  }
  async meta(tx: Tx, ctx: RequestContext, id: string) { const d = await this.load(tx, ctx, id, "read"); return this.view(d); }

  async download(tx: Tx, ctx: RequestContext, id: string) {
    const d = await this.load(tx, ctx, id, "read");
    if (d.deletedAt || d.purgedAt) throw new NotFoundException();
    const blob = await tx.documentBlob.findUnique({ where: { documentId: id } }); if (!blob) throw new NotFoundException();
    await this.audit.record(tx, ctx, { action: "document.download", entity: "Document", entityId: id, after: { category: d.category, via: "authenticated" } }); // journal d'accès
    return { doc: d, data: Buffer.from(blob.data) };
  }

  async createLink(tx: Tx, ctx: RequestContext, id: string, minutes: number) {
    if (!can(ctx.roles, "document.share")) throw new ForbiddenException("Partage non autorisé pour votre rôle");
    const d = await this.load(tx, ctx, id, "read");
    if (SENSITIVE.includes(d.category)) throw new ForbiddenException("Un document sensible ne peut pas être partagé par lien");
    if (d.deletedAt) throw new NotFoundException();
    const exp = Math.floor(Date.now() / 1000) + minutes * 60;
    const token = jwt.sign({ purpose: "doc-share", sub: id, tid: ctx.tenantId, by: ctx.userId, jti: randomUUID(), exp }, loadConfig().jwtSecret, { algorithm: "HS256" });
    await this.audit.record(tx, ctx, { action: "document.link_created", entity: "Document", entityId: id, after: { minutes, category: d.category } });
    return { path: `/documents/shared/${token}`, expiresAt: new Date(exp * 1000).toISOString() };
  }

  async sharedDownload(token: string) {
    let c: { purpose?: string; sub: string; tid: string; by: string };
    try { c = jwt.verify(token, loadConfig().jwtSecret, { algorithms: ["HS256"] }) as never; } catch { throw new UnauthorizedException("Lien invalide ou expiré"); }
    if (c.purpose !== "doc-share") throw new UnauthorizedException("Lien invalide ou expiré");
    return this.prisma.forTenant(c.tid, async tx => {
      const d = await tx.document.findUnique({ where: { id: c.sub } });
      if (!d || d.deletedAt || d.purgedAt || SENSITIVE.includes(d.category)) throw new GoneException("Document indisponible");
      const blob = await tx.documentBlob.findUnique({ where: { documentId: d.id } }); if (!blob) throw new GoneException("Document indisponible");
      await this.audit.record(tx, { tenantId: c.tid, userId: c.by }, { action: "document.shared_access", entity: "Document", entityId: d.id, after: { category: d.category, via: "temporary_link" } });
      return { doc: d, data: Buffer.from(blob.data) };
    });
  }

  async remove(tx: Tx, ctx: RequestContext, id: string, reason: string) {
    const d = await this.load(tx, ctx, id, "delete");
    if (d.deletedAt) throw new ConflictException("Déjà supprimé");
    await tx.document.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: ctx.userId, deleteReason: reason } });
    await this.audit.record(tx, ctx, { action: "document.delete", entity: "Document", entityId: id, after: { reason, category: d.category } });
  }

  /** Purge physique du contenu (droit à l'effacement) : possible seulement après suppression logique ; les métadonnées et l'audit sont conservés. */
  async purge(tx: Tx, ctx: RequestContext, id: string, reason: string) {
    const d = await this.load(tx, ctx, id, "delete");
    if (!d.deletedAt) throw new ConflictException("Supprimez d'abord le document (suppression logique)");
    if (d.purgedAt) throw new ConflictException("Contenu déjà purgé");
    await tx.documentBlob.delete({ where: { documentId: id } });
    await tx.document.update({ where: { id }, data: { purgedAt: new Date() } });
    await this.audit.record(tx, ctx, { action: "document.purge", entity: "Document", entityId: id, after: { reason, sha256: d.sha256 } });
  }
}
