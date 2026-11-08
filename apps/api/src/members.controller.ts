import { BadRequestException, Body, ConflictException, Controller, Get, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext, RequirePermission } from "./auth.guard";
import { ROLES } from "./permissions";
import { hashPassword } from "./password";

const Dto = z.object({ email: z.string().email().max(254), password: z.string().min(12).max(200), roles: z.array(z.enum(ROLES)).min(1) });

@Controller()
export class MembersController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /** Lot 0: création directe avec mot de passe initial. Le flux d'invitation par email (+ MFA) reste à faire. */
  @Post("members") @RequirePermission("member.manage")
  async add(@Req() { ctx }: { ctx: RequestContext }, @Body() body: unknown) {
    const p = Dto.safeParse(body);
    if (!p.success) throw new BadRequestException(p.error.issues.map(i => i.message).join("; "));
    const email = p.data.email.toLowerCase();
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) {
        const dup = await tx.membership.findUnique({ where: { userId_tenantId: { userId: existing.id, tenantId: ctx.tenantId } } });
        if (dup) throw new ConflictException("Déjà membre");
      }
      // Ne jamais modifier le mot de passe d'un utilisateur existant via cette route.
      const user = existing ?? await tx.user.create({ data: { email, passwordHash: await hashPassword(p.data.password) } });
      const m = await tx.membership.create({ data: { userId: user.id, tenantId: ctx.tenantId, roles: p.data.roles } });
      await this.audit.record(tx, ctx, { action: "member.add", entity: "Membership", entityId: m.id, after: { userId: user.id, roles: m.roles } });
      return { userId: user.id, roles: m.roles };
    });
  }

  @Get("audit") @RequirePermission("audit.read")
  audit_(@Req() { ctx }: { ctx: RequestContext }) {
    return this.prisma.forTenant(ctx.tenantId, tx => tx.auditEvent.findMany({ orderBy: { at: "desc" }, take: 200 }));
  }
}
