import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Req } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext, RequirePermission } from "./auth.guard";
import { AuthService } from "./auth.service";
import { ROLES } from "./permissions";
import { parseZod } from "./workflow";

const Invite = z.object({ email: z.string().email().max(254), roles: z.array(z.enum(ROLES)).min(1), companyId: z.string().uuid().optional(), consultantId: z.string().uuid().optional() });
const Patch_ = z.object({ roles: z.array(z.enum(ROLES)).min(1).optional(), companyId: z.string().uuid().nullable().optional(), consultantId: z.string().uuid().nullable().optional() }).refine(v => Object.keys(v).length > 0, "Aucun champ");
const Security = z.object({ mfaRequired: z.boolean() });
type R = { ctx: RequestContext };

@Controller()
export class MembersController {
  constructor(private prisma: PrismaService, private audit: AuditService, private auth: AuthService) {}

  private async otherAdmins(tenantId: string, exceptUserId: string) {
    return this.prisma.membership.count({ where: { tenantId, roles: { has: "tenant_admin" }, userId: { not: exceptUserId }, user: { disabledAt: null } } });
  }

  @Get("members") @RequirePermission("member.manage")
  async list(@Req() { ctx }: R) {
    const rows = await this.prisma.membership.findMany({ where: { tenantId: ctx.tenantId }, include: { user: { select: { email: true, disabledAt: true, mfaEnabledAt: true } } }, orderBy: { createdAt: "asc" }, take: 500 });
    return rows.map(m => ({ userId: m.userId, email: m.user.email, roles: m.roles, companyId: m.companyId, consultantId: m.consultantId, disabled: !!m.user.disabledAt, mfaEnabled: !!m.user.mfaEnabledAt, you: m.userId === ctx.userId }));
  }

  @Patch("members/:userId") @RequirePermission("member.manage")
  update(@Req() { ctx }: R, @Param("userId", ParseUUIDPipe) userId: string, @Body() body: unknown) {
    const d = parseZod(Patch_, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const m = await this.prisma.membership.findUnique({ where: { userId_tenantId: { userId, tenantId: ctx.tenantId } } });
      if (!m) throw new NotFoundException();
      const roles = d.roles ?? m.roles; const companyId = d.companyId === undefined ? m.companyId : d.companyId; const consultantId = d.consultantId === undefined ? m.consultantId : d.consultantId;
      if (roles.includes("client_user") && !companyId) throw new BadRequestException("Un utilisateur client doit être rattaché à une entreprise");
      if (roles.includes("consultant") && !consultantId) throw new BadRequestException("Un consultant doit être rattaché à un dossier consultant");
      if (companyId && !(await tx.company.findUnique({ where: { id: companyId } }))) throw new BadRequestException("Entreprise introuvable");
      if (consultantId && !(await tx.consultant.findUnique({ where: { id: consultantId } }))) throw new BadRequestException("Consultant introuvable");
      if (m.roles.includes("tenant_admin") && !roles.includes("tenant_admin") && (await this.otherAdmins(ctx.tenantId, userId)) === 0) throw new ConflictException("Impossible de retirer le dernier administrateur");
      await this.prisma.membership.update({ where: { userId_tenantId: { userId, tenantId: ctx.tenantId } }, data: { roles, companyId, consultantId } });
      await this.audit.record(tx, ctx, { action: "member.update", entity: "Membership", entityId: userId, before: { roles: m.roles, companyId: m.companyId, consultantId: m.consultantId }, after: { roles, companyId, consultantId } });
      return { userId, roles, companyId, consultantId };
    });
  }

  @Delete("members/:userId") @RequirePermission("member.manage")
  remove(@Req() { ctx }: R, @Param("userId", ParseUUIDPipe) userId: string) {
    if (userId === ctx.userId) throw new ForbiddenException("Vous ne pouvez pas retirer votre propre accès");
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const m = await this.prisma.membership.findUnique({ where: { userId_tenantId: { userId, tenantId: ctx.tenantId } } });
      if (!m) throw new NotFoundException();
      if (m.roles.includes("tenant_admin") && (await this.otherAdmins(ctx.tenantId, userId)) === 0) throw new ConflictException("Impossible de retirer le dernier administrateur");
      await this.prisma.membership.delete({ where: { userId_tenantId: { userId, tenantId: ctx.tenantId } } });
      await this.prisma.session.updateMany({ where: { userId, tenantId: ctx.tenantId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: "member_removed" } });
      await this.audit.record(tx, ctx, { action: "member.remove", entity: "Membership", entityId: userId, before: { roles: m.roles } });
      return { ok: true };
    });
  }

  // ----- invitations (aucun e-mail n'est envoyé : le lien est à transmettre à la personne) -----
  @Post("invitations") @RequirePermission("member.manage")
  async invite(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parseZod(Invite, body);
    const r = await this.auth.invite(ctx, d);
    return { id: r.id, expiresAt: r.expiresAt, link: `/invite?token=${r.token}`, note: "Lien affiché une seule fois. Aucun e-mail n'est envoyé (fournisseur non connecté) : transmettez-le par un canal sûr." };
  }

  @Get("invitations") @RequirePermission("member.manage")
  invitations(@Req() { ctx }: R) {
    return this.prisma.invitation.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, kind: true, email: true, roles: true, expiresAt: true, acceptedAt: true, revokedAt: true, createdAt: true } });
  }

  @Delete("invitations/:id") @RequirePermission("member.manage")
  revokeInvitation(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) {
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const r = await this.prisma.invitation.updateMany({ where: { id, tenantId: ctx.tenantId, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      if (r.count !== 1) throw new NotFoundException();
      await this.audit.record(tx, ctx, { action: "member.invite_revoked", entity: "Invitation", entityId: id });
      return { ok: true };
    });
  }

  /** Réinitialisation de mot de passe initiée par un administrateur (pas d'e-mail disponible) : lien à usage unique. */
  @Post("members/:userId/reset-link") @RequirePermission("member.manage")
  async resetLink(@Req() { ctx }: R, @Param("userId", ParseUUIDPipe) userId: string) {
    const m = await this.prisma.membership.findUnique({ where: { userId_tenantId: { userId, tenantId: ctx.tenantId } }, include: { user: true } });
    if (!m) throw new NotFoundException();
    const r = await this.auth.invite(ctx, { email: m.user.email, roles: m.roles }, "reset");
    return { id: r.id, expiresAt: r.expiresAt, link: `/invite?token=${r.token}`, note: "Lien à usage unique, affiché une seule fois." };
  }

  // ----- sécurité du tenant -----
  @Get("tenant/security") @RequirePermission("member.manage")
  async security(@Req() { ctx }: R) { const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }); return { mfaRequired: t.mfaRequired }; }

  @Put("tenant/security") @RequirePermission("member.manage")
  setSecurity(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parseZod(Security, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      if (d.mfaRequired && !(await this.prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } })).mfaEnabledAt) throw new ConflictException("Activez d'abord votre propre authentification à deux facteurs : sinon vous seriez vous-même bloqué.");
      const before = await this.prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
      await this.prisma.tenant.update({ where: { id: ctx.tenantId }, data: { mfaRequired: d.mfaRequired } });
      await this.audit.record(tx, ctx, { action: "tenant.security", entity: "Tenant", entityId: ctx.tenantId, before: { mfaRequired: before.mfaRequired }, after: d });
      return d;
    });
  }

  @Get("audit") @RequirePermission("audit.read")
  audit_(@Req() { ctx }: R) { return this.prisma.forTenant(ctx.tenantId, tx => tx.auditEvent.findMany({ orderBy: { at: "desc" }, take: 200 })); }
}
