import { ForbiddenException, BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";
import { checkPassword } from "@portage/domain";
import { loadConfig } from "./config";
import { PrismaService } from "./prisma.service";
import { AuditService } from "./audit.service";
import { hashPassword, verifyPassword } from "./password";
import { newSecret, otpauthUri, verifyTotp } from "./totp";
import { newToken, open, seal, sha256 } from "./secretbox";
import { checkLimit, clearLimit, recordFailure } from "./limiter";
import { ROLES } from "./permissions";
import { MailService } from "./mail.service";

const REFRESH_GRACE_MS = 15_000; // requêtes parallèles du navigateur portant l'ancien jeton juste après une rotation
const SESSION_ABSOLUTE_MS = 30 * 86400_000, SESSION_IDLE_MS = 7 * 86400_000, INVITE_TTL_MS = 7 * 86400_000;
const DUMMY = hashPassword("dummy-password-for-timing");
export interface Meta { userAgent?: string }

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private audit: AuditService, private mail: MailService) {}

  passwordIssues(pw: string, email?: string) { return checkPassword(pw, { email }); }
  private assertPassword(pw: string, email?: string) { const i = this.passwordIssues(pw, email); if (i.length) throw new BadRequestException(`Mot de passe refusé : ${i.join(", ")}`); }

  // ---------- connexion ----------
  async login(email: string, password: string, tenantSlug: string, meta: Meta) {
    const key = `login|${email.toLowerCase()}|${tenantSlug}`; checkLimit(key);
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    const m = user && tenant ? await this.prisma.membership.findUnique({ where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } } }) : null;
    const ok = await verifyPassword(password, user?.passwordHash ?? (await DUMMY));
    if (!user || !tenant || !m || !ok || user.disabledAt) {
      recordFailure(key);
      if (user && tenant && m) await this.prisma.forTenant(tenant.id, tx => this.audit.record(tx, { tenantId: tenant.id, userId: user.id }, { action: "auth.login_failed", entity: "User", entityId: user.id }));
      throw new UnauthorizedException("Identifiants invalides");
    }
    clearLimit(key);
    if (tenant.status === "suspended") throw new ForbiddenException("Cette société est suspendue : contactez l'exploitant de la plateforme.");
    if (user.mfaEnabledAt) {
      const mfaToken = jwt.sign({ sub: user.id, tid: tenant.id, purpose: "mfa" }, loadConfig().jwtSecret, { algorithm: "HS256", expiresIn: 300 });
      return { mfaRequired: true as const, mfaToken };
    }
    return this.issueSession(user.id, tenant.id, false, meta);
  }

  async verifyMfaLogin(mfaToken: string, code: string | undefined, recoveryCode: string | undefined, meta: Meta) {
    let claims: { sub: string; tid: string; purpose?: string };
    try { claims = jwt.verify(mfaToken, loadConfig().jwtSecret, { algorithms: ["HS256"] }) as never; } catch { throw new UnauthorizedException("Étape expirée, reconnectez-vous"); }
    if (claims.purpose !== "mfa") throw new UnauthorizedException("Jeton invalide");
    const key = `mfa|${claims.sub}`; checkLimit(key);
    const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user || user.disabledAt || !user.mfaSecretEnc) throw new UnauthorizedException("Vérification impossible");
    let ok = false;
    if (code) {
      const step = verifyTotp(open(user.mfaSecretEnc), code, Date.now(), user.mfaLastStep);
      if (step !== null) { const r = await this.prisma.user.updateMany({ where: { id: user.id, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }] }, data: { mfaLastStep: step } }); ok = r.count === 1; } // anti-rejeu atomique
    } else if (recoveryCode) {
      const h = sha256(recoveryCode.trim().toLowerCase());
      if (user.recoveryHashes.includes(h)) { const r = await this.prisma.user.updateMany({ where: { id: user.id, recoveryHashes: { has: h } }, data: { recoveryHashes: user.recoveryHashes.filter(x => x !== h) } }); ok = r.count === 1; }
    }
    if (!ok) { recordFailure(key); await this.prisma.forTenant(claims.tid, tx => this.audit.record(tx, { tenantId: claims.tid, userId: user.id }, { action: "auth.mfa_failed", entity: "User", entityId: user.id })); throw new UnauthorizedException("Code invalide"); }
    clearLimit(key);
    if (recoveryCode) await this.prisma.forTenant(claims.tid, tx => this.audit.record(tx, { tenantId: claims.tid, userId: user.id }, { action: "auth.mfa_recovery_used", entity: "User", entityId: user.id }));
    return this.issueSession(user.id, claims.tid, true, meta);
  }

  async issueSession(userId: string, tenantId: string, mfaVerified: boolean, meta: Meta) {
    const cfg = loadConfig(); const refreshToken = newToken();
    const s = await this.prisma.session.create({ data: { userId, tenantId, refreshHash: sha256(refreshToken), mfaVerified, userAgent: meta.userAgent?.slice(0, 200), expiresAt: new Date(Date.now() + SESSION_ABSOLUTE_MS) } });
    const accessToken = jwt.sign({ sub: userId, tid: tenantId, sid: s.id }, cfg.jwtSecret, { algorithm: "HS256", expiresIn: cfg.tokenTtlSeconds });
    await this.prisma.forTenant(tenantId, tx => this.audit.record(tx, { tenantId, userId }, { action: "auth.login", entity: "Session", entityId: s.id, after: { mfa: mfaVerified } }));
    return { accessToken, refreshToken, expiresIn: cfg.tokenTtlSeconds };
  }

  /** Rotation du jeton de rafraîchissement. Réutilisation d'un ancien jeton = vol présumé : la session est révoquée. */
  async refresh(refreshToken: string) {
    const h = sha256(refreshToken);
    const s = await this.prisma.session.findUnique({ where: { refreshHash: h } });
    if (!s) {
      const reused = await this.prisma.session.findFirst({ where: { prevRefreshHash: h, revokedAt: null } });
      if (reused) {
        // Rejeu IMMÉDIAT (requêtes parallèles légitimes) : nouveau jeton d'accès, sans nouvelle rotation. Au-delà de la fenêtre : vol présumé, session révoquée.
        if (reused.prevRotatedAt && Date.now() - reused.prevRotatedAt.getTime() < REFRESH_GRACE_MS) return this.graceAccess(reused);
        await this.prisma.session.update({ where: { id: reused.id }, data: { revokedAt: new Date(), revokedReason: "refresh_reuse" } });
        await this.prisma.forTenant(reused.tenantId, tx => this.audit.record(tx, { tenantId: reused.tenantId, userId: reused.userId }, { action: "auth.refresh_reuse_detected", entity: "Session", entityId: reused.id }));
      }
      throw new UnauthorizedException("Session invalide");
    }
    const now = new Date();
    if (s.revokedAt || s.expiresAt < now || now.getTime() - s.lastUsedAt.getTime() > SESSION_IDLE_MS) throw new UnauthorizedException("Session expirée");
    const m = await this.prisma.membership.findUnique({ where: { userId_tenantId: { userId: s.userId, tenantId: s.tenantId } }, include: { user: true } });
    if (!m || m.user.disabledAt) throw new UnauthorizedException("Accès révoqué");
    const next = newToken();
    const r = await this.prisma.session.updateMany({ where: { id: s.id, refreshHash: h, revokedAt: null }, data: { prevRefreshHash: h, prevRotatedAt: now, refreshHash: sha256(next), lastUsedAt: now } });
    if (r.count !== 1) {
      // Course avec une requête parallèle qui vient de faire tourner le jeton : même traitement qu'un rejeu immédiat.
      const again = await this.prisma.session.findUnique({ where: { id: s.id } });
      if (again && !again.revokedAt && again.prevRefreshHash === h && again.prevRotatedAt && Date.now() - again.prevRotatedAt.getTime() < REFRESH_GRACE_MS) return this.graceAccess(again);
      throw new UnauthorizedException("Session invalide");
    }
    const cfg = loadConfig();
    return { accessToken: jwt.sign({ sub: s.userId, tid: s.tenantId, sid: s.id }, cfg.jwtSecret, { algorithm: "HS256", expiresIn: cfg.tokenTtlSeconds }), refreshToken: next, expiresIn: cfg.tokenTtlSeconds };
  }

  private graceAccess(s: { id: string; userId: string; tenantId: string }) {
    const cfg = loadConfig();
    return { accessToken: jwt.sign({ sub: s.userId, tid: s.tenantId, sid: s.id }, cfg.jwtSecret, { algorithm: "HS256", expiresIn: cfg.tokenTtlSeconds }), refreshToken: undefined as string | undefined, expiresIn: cfg.tokenTtlSeconds };
  }

  // ---------- sessions ----------
  async revoke(ctx: { userId: string; tenantId: string }, sessionId: string, reason: string) {
    const r = await this.prisma.session.updateMany({ where: { id: sessionId, userId: ctx.userId, tenantId: ctx.tenantId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
    if (r.count === 1) await this.prisma.forTenant(ctx.tenantId, tx => this.audit.record(tx, ctx, { action: "auth.session_revoked", entity: "Session", entityId: sessionId, after: { reason } }));
    return r.count === 1;
  }
  listSessions(ctx: { userId: string; tenantId: string }) { return this.prisma.session.findMany({ where: { userId: ctx.userId, tenantId: ctx.tenantId, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastUsedAt: "desc" }, select: { id: true, createdAt: true, lastUsedAt: true, userAgent: true, mfaVerified: true } }); }
  async revokeOthers(ctx: { userId: string; tenantId: string; sessionId: string }) {
    const r = await this.prisma.session.updateMany({ where: { userId: ctx.userId, tenantId: ctx.tenantId, revokedAt: null, id: { not: ctx.sessionId } }, data: { revokedAt: new Date(), revokedReason: "revoke_others" } });
    await this.prisma.forTenant(ctx.tenantId, tx => this.audit.record(tx, ctx, { action: "auth.sessions_revoked_others", entity: "Session", after: { count: r.count } }));
    return r.count;
  }

  // ---------- mot de passe ----------
  async changePassword(ctx: { userId: string; tenantId: string; sessionId: string }, current: string, next: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
    const key = `pwd|${ctx.userId}`; checkLimit(key);
    if (!(await verifyPassword(current, user.passwordHash))) { recordFailure(key); throw new UnauthorizedException("Mot de passe actuel incorrect"); }
    clearLimit(key); this.assertPassword(next, user.email);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next), passwordChangedAt: new Date() } });
    const n = await this.revokeOthers(ctx);
    await this.prisma.forTenant(ctx.tenantId, tx => this.audit.record(tx, ctx, { action: "auth.password_changed", entity: "User", entityId: user.id, after: { otherSessionsRevoked: n } }));
  }

  // ---------- MFA ----------
  async mfaSetup(ctx: { userId: string }) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
    if (u.mfaEnabledAt) throw new ConflictException("L'authentification à deux facteurs est déjà activée");
    const secret = newSecret();
    await this.prisma.user.update({ where: { id: u.id }, data: { mfaPendingEnc: seal(secret) } });
    return { secret, otpauthUri: otpauthUri(secret, u.email, "PORTAGE OS") };
  }
  async mfaEnable(ctx: { userId: string; tenantId: string }, code: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
    if (u.mfaEnabledAt) throw new ConflictException("Déjà activée");
    if (!u.mfaPendingEnc) throw new BadRequestException("Lancez d'abord la configuration");
    const key = `mfa-enable|${u.id}`; checkLimit(key);
    const secret = open(u.mfaPendingEnc); const step = verifyTotp(secret, code);
    if (step === null) { recordFailure(key); throw new BadRequestException("Code invalide"); }
    clearLimit(key);
    const codes = Array.from({ length: 10 }, () => randomBytes(6).toString("hex").replace(/(.{4})(.{4})(.{4})/, "$1-$2-$3"));
    await this.prisma.user.update({ where: { id: u.id }, data: { mfaSecretEnc: u.mfaPendingEnc, mfaPendingEnc: null, mfaEnabledAt: new Date(), mfaLastStep: step, recoveryHashes: codes.map(c => sha256(c)) } });
    await this.prisma.forTenant(ctx.tenantId, tx => this.audit.record(tx, ctx, { action: "auth.mfa_enabled", entity: "User", entityId: u.id }));
    return { recoveryCodes: codes };
  }
  async mfaDisable(ctx: { userId: string; tenantId: string }, password: string, code: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
    if (!u.mfaEnabledAt || !u.mfaSecretEnc) throw new ConflictException("Non activée");
    const key = `mfa-disable|${u.id}`; checkLimit(key);
    if (!(await verifyPassword(password, u.passwordHash)) || verifyTotp(open(u.mfaSecretEnc), code, Date.now(), u.mfaLastStep) === null) { recordFailure(key); throw new UnauthorizedException("Mot de passe ou code incorrect"); }
    clearLimit(key);
    await this.prisma.user.update({ where: { id: u.id }, data: { mfaSecretEnc: null, mfaPendingEnc: null, mfaEnabledAt: null, mfaLastStep: null, recoveryHashes: [] } });
    await this.prisma.forTenant(ctx.tenantId, tx => this.audit.record(tx, ctx, { action: "auth.mfa_disabled", entity: "User", entityId: u.id }));
  }

  /**
   * Mot de passe oublié en libre-service. Réponse IDENTIQUE que le compte existe ou non (pas d'énumération), limitée par adresse ;
   * le lien (usage unique, 1 h) n'est jamais renvoyé : il part par e-mail, sinon il est perdu (« not_connected » au journal) et
   * l'administrateur reste le recours.
   */
  async forgotPassword(email: string, tenantSlug: string) {
    const e = email.toLowerCase(); checkLimit(`forgot|${e}`, 3); recordFailure(`forgot|${e}`, 15 * 60_000);
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    const user = tenant ? await this.prisma.user.findUnique({ where: { email: e } }) : null;
    const m = tenant && user ? await this.prisma.membership.findUnique({ where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } } }) : null;
    if (tenant && user && m) {
      const token = newToken();
      await this.prisma.forTenant(tenant.id, async tx => {
        await tx.invitation.updateMany({ where: { tenantId: tenant.id, email: e, kind: "reset", acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
        const inv = await tx.invitation.create({ data: { tenantId: tenant.id, kind: "reset", email: e, roles: m.roles, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3600_000), createdBy: user.id } });
        await this.audit.record(tx, { tenantId: tenant.id, userId: user.id }, { action: "auth.password_forgot", entity: "Invitation", entityId: inv.id, after: { email: e } });
      });
      void this.mail.send({ to: e, template: "password_reset", link: `/invite?token=${token}`, tenantId: tenant.id, tenantName: tenant.name, expiresInText: "1 heure" });
    } else await new Promise(r => setTimeout(r, 40)); // lisse le temps de réponse
    return { accepted: true, message: "Si un compte correspond, un e-mail de réinitialisation vient d'être envoyé (s'il est configuré). Sinon, contactez l'administrateur de votre société." };
  }

  // ---------- invitations ----------
  private validateLinks(roles: string[], companyId?: string | null, consultantId?: string | null) {
    if (!roles.length || roles.some(r => !(ROLES as readonly string[]).includes(r))) throw new BadRequestException("Rôles invalides");
    if (roles.includes("client_user") && !companyId) throw new BadRequestException("Un utilisateur client doit être rattaché à une entreprise");
    if (roles.includes("consultant") && !consultantId) throw new BadRequestException("Un consultant doit être rattaché à un dossier consultant");
  }
  async invite(ctx: { userId: string; tenantId: string }, d: { email: string; roles: string[]; companyId?: string; consultantId?: string }, kind: "invite" | "reset" = "invite") {
    if (kind === "invite") this.validateLinks(d.roles, d.companyId, d.consultantId);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      if (d.companyId && !(await tx.company.findUnique({ where: { id: d.companyId } }))) throw new BadRequestException("Entreprise introuvable");
      if (d.consultantId && !(await tx.consultant.findUnique({ where: { id: d.consultantId } }))) throw new BadRequestException("Consultant introuvable");
      const email = d.email.toLowerCase();
      await tx.invitation.updateMany({ where: { tenantId: ctx.tenantId, email, kind, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } }); // une seule invitation active
      const token = newToken();
      const inv = await tx.invitation.create({ data: { tenantId: ctx.tenantId, kind, email, roles: d.roles, companyId: d.companyId, consultantId: d.consultantId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS), createdBy: ctx.userId } });
      await this.audit.record(tx, ctx, { action: kind === "invite" ? "member.invite" : "member.reset_link", entity: "Invitation", entityId: inv.id, after: { email, roles: d.roles } });
      return { id: inv.id, token, expiresAt: inv.expiresAt };
    });
  }
  private async findInvite(token: string) {
    const inv = await this.prisma.invitation.findUnique({ where: { tokenHash: sha256(token) } });
    if (!inv || inv.revokedAt || inv.acceptedAt || inv.expiresAt < new Date()) throw new NotFoundException("Invitation invalide, expirée ou déjà utilisée");
    return inv;
  }
  async previewInvite(token: string) {
    const inv = await this.findInvite(token);
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: inv.tenantId } });
    const exists = !!(await this.prisma.user.findUnique({ where: { email: inv.email } }));
    return { kind: inv.kind, email: inv.email, tenantName: t.name, tenantSlug: t.slug, roles: inv.roles, existingAccount: exists, expiresAt: inv.expiresAt };
  }
  async acceptInvite(token: string, password: string, currentPassword?: string) {
    const lim = `invite|${sha256(token).slice(0, 16)}`; checkLimit(lim, 10);
    const inv = await this.findInvite(token);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: inv.tenantId } });
    let user = await this.prisma.user.findUnique({ where: { email: inv.email } });
    if (inv.kind === "reset") {
      if (!user) throw new NotFoundException("Compte introuvable");
      this.assertPassword(password, inv.email);
      await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date() } });
      await this.prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: "password_reset" } });
    } else if (user) {
      // Compte existant : on exige son mot de passe actuel (on ne modifie jamais le mot de passe d'un compte existant).
      if (!currentPassword || !(await verifyPassword(currentPassword, user.passwordHash))) { recordFailure(lim); throw new UnauthorizedException("Compte existant : saisissez votre mot de passe actuel pour accepter l'invitation"); }
      if (await this.prisma.membership.findUnique({ where: { userId_tenantId: { userId: user.id, tenantId: inv.tenantId } } })) throw new ConflictException("Déjà membre de cette société");
      await this.prisma.membership.create({ data: { userId: user.id, tenantId: inv.tenantId, roles: inv.roles, companyId: inv.companyId, consultantId: inv.consultantId } });
    } else {
      this.assertPassword(password, inv.email);
      user = await this.prisma.user.create({ data: { email: inv.email, passwordHash: await hashPassword(password), passwordChangedAt: new Date() } });
      await this.prisma.membership.create({ data: { userId: user.id, tenantId: inv.tenantId, roles: inv.roles, companyId: inv.companyId, consultantId: inv.consultantId } });
    }
    const r = await this.prisma.invitation.updateMany({ where: { id: inv.id, acceptedAt: null }, data: { acceptedAt: new Date() } });
    if (r.count !== 1) throw new ConflictException("Invitation déjà utilisée");
    await this.prisma.forTenant(inv.tenantId, tx => this.audit.record(tx, { tenantId: inv.tenantId, userId: user!.id }, { action: inv.kind === "invite" ? "member.invite_accepted" : "auth.password_reset", entity: "Invitation", entityId: inv.id }));
    return { ok: true, tenantSlug: tenant.slug };
  }
}
