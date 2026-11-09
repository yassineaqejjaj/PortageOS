import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "./prisma.service";
import { MfaExempt, Public, RequestContext } from "./auth.guard";
import { AuthService } from "./auth.service";
import { ROLE_PERMISSIONS, can, Permission } from "./permissions";
import { resetLimiters } from "./limiter";
import { parseZod } from "./workflow";

export const resetLoginThrottle = resetLimiters;

const Login = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200), tenantSlug: z.string().min(1).max(100) });
const Mfa = z.object({ mfaToken: z.string().min(10).max(2000), code: z.string().max(10).optional(), recoveryCode: z.string().max(30).optional() }).refine(v => !!v.code !== !!v.recoveryCode, "Fournir un code OU un code de secours");
const Refresh = z.object({ refreshToken: z.string().min(20).max(200) });
const Pwd = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) });
const Code = z.object({ code: z.string().regex(/^\d{6}$/, "Code à 6 chiffres") });
const MfaOff = z.object({ password: z.string().min(1).max(200), code: z.string().regex(/^\d{6}$/, "Code à 6 chiffres") });
const Accept = z.object({ token: z.string().min(20).max(200), password: z.string().min(1).max(200), currentPassword: z.string().max(200).optional() });
type R = { ctx: RequestContext; headers: Record<string, string | undefined> };
const meta = (req: R) => ({ userAgent: req.headers["user-agent"] });

@Controller()
export class AuthController {
  constructor(private prisma: PrismaService, private auth: AuthService) {}

  @Public() @Post("auth/login") @HttpCode(200)
  login(@Body() body: unknown, @Req() req: R) { const d = parseZod(Login, body); return this.auth.login(d.email, d.password, d.tenantSlug, meta(req)); }

  @Public() @Post("auth/mfa/verify") @HttpCode(200)
  verify(@Body() body: unknown, @Req() req: R) { const d = parseZod(Mfa, body); return this.auth.verifyMfaLogin(d.mfaToken, d.code, d.recoveryCode, meta(req)); }

  @Public() @Post("auth/refresh") @HttpCode(200)
  refresh(@Body() body: unknown) { return this.auth.refresh(parseZod(Refresh, body).refreshToken); }

  @MfaExempt() @Post("auth/logout") @HttpCode(200)
  async logout(@Req() { ctx }: R) { await this.auth.revoke(ctx, ctx.sessionId, "logout"); return { ok: true }; }

  @MfaExempt() @Get("me")
  async me(@Req() { ctx }: R) {
    const [user, tenant] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: ctx.userId }, select: { email: true, mfaEnabledAt: true } }),
      this.prisma.tenant.findUnique({ where: { id: ctx.tenantId }, select: { slug: true, name: true, mfaRequired: true } }),
    ]);
    const all = [...new Set(Object.values(ROLE_PERMISSIONS).flat())] as Permission[];
    const mfaEnabled = !!user?.mfaEnabledAt;
    return { userId: ctx.userId, tenantId: ctx.tenantId, roles: ctx.roles, consultantId: ctx.consultantId, companyId: ctx.companyId, email: user?.email, tenant: tenant ? { slug: tenant.slug, name: tenant.name } : undefined,
      mfaEnabled, mfaEnrollmentRequired: !!tenant?.mfaRequired && !mfaEnabled, permissions: [...all.filter(p => can(ctx.roles, p)), "support.create", "notification.read"] };
  }

  @Public() @Get("health") health() { return { status: "ok" }; }

  // ----- sessions et mot de passe -----
  @MfaExempt() @Get("auth/sessions")
  async sessions(@Req() { ctx }: R) { return (await this.auth.listSessions(ctx)).map(s => ({ ...s, current: s.id === ctx.sessionId })); }

  @Post("auth/sessions/revoke-others") @HttpCode(200)
  async revokeOthers(@Req() { ctx }: R) { return { revoked: await this.auth.revokeOthers(ctx) }; }

  @Delete("auth/sessions/:id")
  async revokeOne(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) { if (!(await this.auth.revoke(ctx, id, "user_revoked"))) throw new NotFoundException(); return { ok: true }; }

  @Post("auth/password") @HttpCode(200)
  async password(@Req() { ctx }: R, @Body() body: unknown) { const d = parseZod(Pwd, body); await this.auth.changePassword(ctx, d.currentPassword, d.newPassword); return { ok: true }; }

  // ----- MFA -----
  @MfaExempt() @Post("auth/mfa/setup") @HttpCode(200)
  setup(@Req() { ctx }: R) { return this.auth.mfaSetup(ctx); }

  @MfaExempt() @Post("auth/mfa/enable") @HttpCode(200)
  enable(@Req() { ctx }: R, @Body() body: unknown) { return this.auth.mfaEnable(ctx, parseZod(Code, body).code); }

  @Post("auth/mfa/disable") @HttpCode(200)
  async disable(@Req() { ctx }: R, @Body() body: unknown) { const d = parseZod(MfaOff, body); await this.auth.mfaDisable(ctx, d.password, d.code); return { ok: true }; }

  // ----- invitations : aperçu et acceptation (publics, jeton à usage unique) -----
  @Public() @Get("auth/invitations/preview")
  preview(@Query("token") token?: string) { if (!token || token.length > 200) throw new BadRequestException("Jeton requis"); return this.auth.previewInvite(token); }

  @Public() @Post("auth/invitations/accept") @HttpCode(200)
  accept(@Body() body: unknown) { const d = parseZod(Accept, body); return this.auth.acceptInvite(d.token, d.password, d.currentPassword); }
}
