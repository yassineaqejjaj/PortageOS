import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Req } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PrismaService } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext, RequireOperator } from "./auth.guard";
import { AuthService } from "./auth.service";
import { MailService } from "./mail.service";
import { parseZod } from "./workflow";

const RESERVED = new Set(["admin", "api", "app", "www", "operator", "platform", "support", "login", "static", "health", "metrics"]);
const Create = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,50}$/, "Identifiant : minuscules, chiffres et tirets (2 à 50)").refine(s => !RESERVED.has(s), "Identifiant réservé"),
  name: z.string().trim().min(2).max(120), plan: z.string().trim().min(1).max(60).optional(),
  maxMembers: z.number().int().min(1).max(100000).optional(), adminEmail: z.string().email().max(254),
});
const Update = z.object({ name: z.string().trim().min(2).max(120).optional(), plan: z.string().trim().min(1).max(60).nullable().optional(), maxMembers: z.number().int().min(1).max(100000).nullable().optional() })
  .refine(v => Object.keys(v).length > 0, "Aucune modification");
const Suspend = z.object({ reason: z.string().trim().min(5).max(300) });
type R = { ctx: RequestContext };

/**
 * Console opérateur : MÉTADONNÉES des sociétés uniquement (création, plan, quota, suspension, première invitation).
 * Aucune route ne lit de donnée métier d'un tenant ; chaque action est tracée dans le journal du tenant visé ET dans celui de la plateforme.
 * Accès : administrateur du tenant plateforme (créé hors API), avec MFA obligatoire.
 */
@Controller("operator")
export class OperatorController {
  constructor(private prisma: PrismaService, private audit: AuditService, private auth: AuthService, private mail: MailService) {}

  private view(t: { id: string; slug: string; name: string; status: string; plan: string | null; maxMembers: number | null; isPlatform: boolean; createdAt: Date; suspendedAt: Date | null; suspendedReason: string | null; mfaRequired: boolean }, members: number) {
    return { id: t.id, slug: t.slug, name: t.name, status: t.status, plan: t.plan, maxMembers: t.maxMembers, isPlatform: t.isPlatform, createdAt: t.createdAt, suspendedAt: t.suspendedAt, suspendedReason: t.suspendedReason, mfaRequired: t.mfaRequired, members };
  }
  /** Journal des deux côtés : tenant visé (pour que la société voie l'intervention) et plateforme. */
  private async trace(ctx: RequestContext, targetId: string, e: { action: string; entityId: string; before?: unknown; after?: unknown }) {
    await this.prisma.forTenant(targetId, tx => this.audit.record(tx, { tenantId: targetId, userId: ctx.userId }, { action: e.action, entity: "Tenant", entityId: e.entityId, before: e.before, after: { ...(e.after as object), byOperator: true } }));
    await this.prisma.forTenant(ctx.tenantId, tx => this.audit.record(tx, ctx, { action: e.action, entity: "Tenant", entityId: e.entityId, before: e.before, after: e.after }));
  }
  private async inviteAdmin(ctx: RequestContext, tenant: { id: string; name: string }, email: string) {
    const r = await this.auth.invite({ userId: ctx.userId, tenantId: tenant.id }, { email, roles: ["tenant_admin"] });
    const emailStatus = await this.mail.send({ to: email, template: "invitation", link: `/invite?token=${r.token}`, tenantId: tenant.id, tenantName: tenant.name, expiresInText: "7 jours" });
    return { expiresAt: r.expiresAt, link: `/invite?token=${r.token}`, emailStatus, note: emailStatus === "sent" ? "Invitation envoyée par e-mail. Le lien n'est affiché qu'une fois." : "Aucun e-mail envoyé (fournisseur non connecté ou en échec) : transmettez ce lien par un canal sûr, il n'est affiché qu'une fois." };
  }

  @Get("tenants") @RequireOperator()
  async list() {
    const [tenants, counts] = await Promise.all([this.prisma.tenant.findMany({ orderBy: { createdAt: "desc" }, take: 500 }), this.prisma.membership.groupBy({ by: ["tenantId"], _count: { _all: true } })]);
    const n = new Map(counts.map(c => [c.tenantId, c._count._all]));
    return tenants.map(t => this.view(t, n.get(t.id) ?? 0));
  }

  @Get("tenants/:id") @RequireOperator()
  async get(@Param("id", ParseUUIDPipe) id: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id } }); if (!t) throw new NotFoundException();
    const [members, pending] = await Promise.all([this.prisma.membership.count({ where: { tenantId: id } }), this.prisma.invitation.count({ where: { tenantId: id, kind: "invite", acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } })]);
    return { ...this.view(t, members), pendingInvitations: pending };
  }

  @Post("tenants") @RequireOperator()
  async create(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parseZod(Create, body);
    if (await this.prisma.tenant.findUnique({ where: { slug: d.slug } })) throw new ConflictException("Cet identifiant est déjà utilisé");
    // INSERT explicite : le rôle applicatif n'a pas le droit d'écrire isPlatform (l'ORM l'enverrait avec sa valeur par défaut).
    const tid = randomUUID();
    await this.prisma.$executeRaw`INSERT INTO "Tenant" (id, slug, name, plan, "maxMembers") VALUES (${tid}, ${d.slug}, ${d.name}, ${d.plan ?? null}, ${d.maxMembers ?? null})`;
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tid } });
    await this.trace(ctx, t.id, { action: "operator.tenant_created", entityId: t.id, after: { slug: t.slug, name: t.name, plan: d.plan ?? null, maxMembers: d.maxMembers ?? null, adminEmail: d.adminEmail.toLowerCase() } });
    const invitation = await this.inviteAdmin(ctx, t, d.adminEmail);
    return { tenant: this.view(t, 0), invitation };
  }

  /** Nouvelle invitation du premier administrateur (la précédente est révoquée) : lien perdu ou expiré. */
  @Post("tenants/:id/admin-invitation") @RequireOperator()
  async reinvite(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parseZod(z.object({ adminEmail: z.string().email().max(254) }), body);
    const t = await this.prisma.tenant.findUnique({ where: { id } }); if (!t || t.isPlatform) throw new NotFoundException();
    await this.trace(ctx, id, { action: "operator.admin_reinvited", entityId: id, after: { adminEmail: d.adminEmail.toLowerCase() } });
    return this.inviteAdmin(ctx, t, d.adminEmail);
  }

  @Patch("tenants/:id") @RequireOperator()
  async update(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parseZod(Update, body);
    const t = await this.prisma.tenant.findUnique({ where: { id } }); if (!t) throw new NotFoundException();
    if (d.maxMembers != null) {
      const used = (await this.prisma.membership.count({ where: { tenantId: id } })) + (await this.prisma.invitation.count({ where: { tenantId: id, kind: "invite", acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }));
      if (d.maxMembers < used) throw new BadRequestException(`Le quota ne peut pas être inférieur aux membres et invitations existants (${used})`);
    }
    const u = await this.prisma.tenant.update({ where: { id }, data: d });
    await this.trace(ctx, id, { action: "operator.tenant_updated", entityId: id, before: { name: t.name, plan: t.plan, maxMembers: t.maxMembers }, after: { name: u.name, plan: u.plan, maxMembers: u.maxMembers } });
    return this.view(u, await this.prisma.membership.count({ where: { tenantId: id } }));
  }

  /** Suspension : connexions refusées et sessions actives révoquées ; les données sont conservées intactes. Réversible. */
  @Post("tenants/:id/suspend") @RequireOperator()
  async suspend(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parseZod(Suspend, body);
    const t = await this.prisma.tenant.findUnique({ where: { id } }); if (!t) throw new NotFoundException();
    if (t.isPlatform) throw new BadRequestException("Le tenant plateforme ne peut pas être suspendu");
    if (t.status === "suspended") throw new ConflictException("Déjà suspendue");
    const u = await this.prisma.tenant.update({ where: { id }, data: { status: "suspended", suspendedAt: new Date(), suspendedReason: d.reason } });
    const revoked = await this.prisma.session.updateMany({ where: { tenantId: id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: "tenant_suspended" } });
    await this.trace(ctx, id, { action: "operator.tenant_suspended", entityId: id, before: { status: "active" }, after: { status: "suspended", reason: d.reason, sessionsRevoked: revoked.count } });
    return this.view(u, await this.prisma.membership.count({ where: { tenantId: id } }));
  }

  @Post("tenants/:id/reactivate") @RequireOperator()
  async reactivate(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id } }); if (!t) throw new NotFoundException();
    if (t.status !== "suspended") throw new ConflictException("La société n'est pas suspendue");
    const u = await this.prisma.tenant.update({ where: { id }, data: { status: "active", suspendedAt: null, suspendedReason: null } });
    await this.trace(ctx, id, { action: "operator.tenant_reactivated", entityId: id, before: { status: "suspended", reason: t.suspendedReason }, after: { status: "active" } });
    return this.view(u, await this.prisma.membership.count({ where: { tenantId: id } }));
  }
}
