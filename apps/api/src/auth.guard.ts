import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import jwt from "jsonwebtoken";
import { loadConfig } from "./config";
import { PrismaService } from "./prisma.service";
import { Permission, can } from "./permissions";

export interface RequestContext { userId: string; tenantId: string; roles: string[]; companyId?: string; consultantId?: string }
export const PERMISSION_KEY = "permission";
export const RequirePermission = (p: Permission) => SetMetadata(PERMISSION_KEY, p);
export const PUBLIC_KEY = "public";
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/**
 * Authentifie le JWT puis RECHARGE rôles et appartenance depuis la base à chaque requête :
 * ni le tenant ni les rôles du token/front ne sont crus sans vérification de Membership.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private prisma: PrismaService, private reflector: Reflector) {}
  async canActivate(c: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [c.getHandler(), c.getClass()])) return true;
    const req = c.switchToHttp().getRequest();
    const h: string | undefined = req.headers.authorization;
    if (!h?.startsWith("Bearer ")) throw new UnauthorizedException("Jeton manquant");
    let claims: { sub: string; tid: string };
    try {
      claims = jwt.verify(h.slice(7), loadConfig().jwtSecret, { algorithms: ["HS256"] }) as never;
    } catch { throw new UnauthorizedException("Jeton invalide"); }
    const m = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId: claims.sub, tenantId: claims.tid } }, include: { user: true } });
    if (!m || m.user.disabledAt) throw new UnauthorizedException("Accès révoqué");
    const ctx: RequestContext = { userId: m.userId, tenantId: m.tenantId, roles: m.roles, companyId: m.companyId ?? undefined, consultantId: m.consultantId ?? undefined };
    req.ctx = ctx;
    const need = this.reflector.getAllAndOverride<Permission>(PERMISSION_KEY, [c.getHandler(), c.getClass()]);
    if (need && !can(ctx.roles, need)) throw new ForbiddenException("Permission insuffisante");
    return true;
  }
}
