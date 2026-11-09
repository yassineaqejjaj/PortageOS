import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import jwt from "jsonwebtoken";
import { loadConfig } from "./config";
import { PrismaService } from "./prisma.service";
import { Permission, can } from "./permissions";

export interface RequestContext { userId: string; tenantId: string; roles: string[]; sessionId: string; companyId?: string; consultantId?: string }
export const PERMISSION_KEY = "permission";
export const RequirePermission = (p: Permission) => SetMetadata(PERMISSION_KEY, p);
export const PUBLIC_KEY = "public";
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** Routes accessibles même si le tenant impose le MFA et que l'utilisateur n'est pas encore inscrit (inscription au MFA, profil, déconnexion). */
/** Routes de la console opérateur : réservées à un administrateur du tenant plateforme (jamais attribuable via les rôles ni les invitations). */
export const OPERATOR_KEY = "operator";
export const RequireOperator = () => SetMetadata(OPERATOR_KEY, true);
export const MFA_EXEMPT_KEY = "mfa_exempt";
export const MfaExempt = () => SetMetadata(MFA_EXEMPT_KEY, true);

/**
 * Authentifie le JWT d'accès, puis vérifie en base : session non révoquée et non expirée, utilisateur actif, appartenance au tenant.
 * Rôles et appartenance sont RECHARGÉS à chaque requête (jamais pris du jeton). Le MFA obligatoire du tenant est appliqué ici.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private prisma: PrismaService, private reflector: Reflector) {}
  async canActivate(c: ExecutionContext): Promise<boolean> {
    const targets = [c.getHandler(), c.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    const req = c.switchToHttp().getRequest();
    const h: string | undefined = req.headers.authorization;
    if (!h?.startsWith("Bearer ")) throw new UnauthorizedException("Jeton manquant");
    let claims: { sub: string; tid: string; sid: string; purpose?: string };
    try { claims = jwt.verify(h.slice(7), loadConfig().jwtSecret, { algorithms: ["HS256"] }) as never; } catch { throw new UnauthorizedException("Jeton invalide"); }
    if (!claims.sid || claims.purpose) throw new UnauthorizedException("Jeton invalide");
    const session = await this.prisma.session.findUnique({ where: { id: claims.sid } });
    if (!session || session.userId !== claims.sub || session.tenantId !== claims.tid || session.revokedAt || session.expiresAt < new Date()) throw new UnauthorizedException("Session expirée ou révoquée");
    const m = await this.prisma.membership.findUnique({ where: { userId_tenantId: { userId: claims.sub, tenantId: claims.tid } }, include: { user: true, tenant: true } });
    if (!m || m.user.disabledAt) throw new UnauthorizedException("Accès révoqué");
    if (m.tenant.status === "suspended") throw new ForbiddenException({ message: "Cette société est suspendue : contactez l'exploitant de la plateforme.", code: "tenant_suspended" });
    const ctx: RequestContext = { userId: m.userId, tenantId: m.tenantId, roles: m.roles, sessionId: session.id, companyId: m.companyId ?? undefined, consultantId: m.consultantId ?? undefined };
    req.ctx = ctx;
    if (m.tenant.mfaRequired && !m.user.mfaEnabledAt && !this.reflector.getAllAndOverride<boolean>(MFA_EXEMPT_KEY, targets)) {
      throw new ForbiddenException({ message: "L'authentification à deux facteurs est obligatoire pour cette société : activez-la dans « Sécurité ».", code: "mfa_enrollment_required" });
    }
    if (this.reflector.getAllAndOverride<boolean>(OPERATOR_KEY, targets) && !(m.tenant.isPlatform && m.roles.includes("tenant_admin"))) throw new ForbiddenException("Réservé à l'exploitant de la plateforme");
    const need = this.reflector.getAllAndOverride<Permission>(PERMISSION_KEY, targets);
    if (need && !can(ctx.roles, need)) throw new ForbiddenException("Permission insuffisante");
    return true;
  }
}
