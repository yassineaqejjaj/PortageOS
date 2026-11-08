import { BadRequestException, Body, Controller, Get, HttpCode, Post, Req, UnauthorizedException, HttpException } from "@nestjs/common";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { loadConfig } from "./config";
import { PrismaService } from "./prisma.service";
import { AuditService } from "./audit.service";
import { Public, RequestContext } from "./auth.guard";
import { hashPassword, verifyPassword } from "./password";
import { ROLE_PERMISSIONS, can, Permission } from "./permissions";

const LoginDto = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200), tenantSlug: z.string().min(1).max(100) });
const DUMMY_HASH_PROMISE = hashPassword("dummy-password-for-timing");

/** Limiteur mémoire minimal des ÉCHECS par email+tenant (5/min), remis à zéro après un succès. Remplacer par Redis en multi-instance. */
const attempts = new Map<string, { n: number; reset: number }>();
export function resetLoginThrottle() { attempts.clear(); }
function checkThrottle(key: string) {
  const a = attempts.get(key);
  if (a && a.reset > Date.now() && a.n >= 5) throw new HttpException("Trop de tentatives", 429);
}
function recordFailure(key: string) {
  const now = Date.now(); const a = attempts.get(key);
  if (!a || a.reset < now) attempts.set(key, { n: 1, reset: now + 60_000 }); else a.n++;
}

@Controller()
export class AuthController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Public() @Post("auth/login") @HttpCode(200)
  async login(@Body() body: unknown) {
    const p = LoginDto.safeParse(body);
    if (!p.success) throw new BadRequestException("Requête invalide");
    const { email, password, tenantSlug } = p.data;
    const tkey = `${email.toLowerCase()}|${tenantSlug}`;
    checkThrottle(tkey);
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    const m = user && tenant ? await this.prisma.membership.findUnique({ where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } } }) : null;
    const ok = await verifyPassword(password, user?.passwordHash ?? (await DUMMY_HASH_PROMISE));
    if (!user || !tenant || !m || !ok || user.disabledAt) { recordFailure(tkey); throw new UnauthorizedException("Identifiants invalides"); }
    attempts.delete(tkey);
    const cfg = loadConfig();
    const token = jwt.sign({ sub: user.id, tid: tenant.id }, cfg.jwtSecret, { algorithm: "HS256", expiresIn: cfg.tokenTtlSeconds });
    await this.prisma.forTenant(tenant.id, tx => this.audit.record(tx, { tenantId: tenant.id, userId: user.id }, { action: "auth.login", entity: "User", entityId: user.id }));
    return { accessToken: token, expiresIn: cfg.tokenTtlSeconds };
  }

  @Get("me")
  async me(@Req() req: { ctx: RequestContext }) {
    const { userId, tenantId, roles } = req.ctx;
    const [user, tenant] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true, name: true } }),
    ]);
    const all = [...new Set(Object.values(ROLE_PERMISSIONS).flat())] as Permission[];
    return { userId, tenantId, roles, email: user?.email, tenant, permissions: all.filter(p => can(roles, p)) };
  }

  @Public() @Get("health")
  health() { return { status: "ok" }; }
}
