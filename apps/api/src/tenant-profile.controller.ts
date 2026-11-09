import { Body, Controller, Get, Put, Req } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext, RequirePermission } from "./auth.guard";
import { parseZod } from "./workflow";
import { sellerComplete } from "./invoice-pdf";

const opt = (s: z.ZodString) => s.optional().or(z.literal("")).transform(v => v || undefined);
const Profile = z.object({ legalName: z.string().min(2).max(200), legalForm: opt(z.string().max(60)), siren: opt(z.string().regex(/^\d{9}$/, "SIREN : 9 chiffres")), vatNumber: opt(z.string().max(20)),
  address: opt(z.string().max(200)), postalCode: opt(z.string().regex(/^\d{5}$/, "Code postal : 5 chiffres")), city: opt(z.string().max(100)), iban: opt(z.string().regex(/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/, "IBAN invalide (sans espaces, majuscules)")) });
type R = { ctx: RequestContext };

@Controller("tenant")
export class TenantProfileController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}
  @Get("profile") @RequirePermission("company.read")
  get(@Req() { ctx }: R) { return this.prisma.forTenant(ctx.tenantId, async tx => { const p = await tx.tenantProfile.findUnique({ where: { tenantId: ctx.tenantId } }); return { profile: p, complete: p ? sellerComplete(p) : false }; }); }
  @Put("profile") @RequirePermission("member.manage")
  put(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parseZod(Profile, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const before = await tx.tenantProfile.findUnique({ where: { tenantId: ctx.tenantId } });
      const data = { legalName: d.legalName, legalForm: d.legalForm ?? null, siren: d.siren ?? null, vatNumber: d.vatNumber ?? null, address: d.address ?? null, postalCode: d.postalCode ?? null, city: d.city ?? null, iban: d.iban ?? null, updatedBy: ctx.userId };
      const p = await tx.tenantProfile.upsert({ where: { tenantId: ctx.tenantId }, update: data, create: { tenantId: ctx.tenantId, ...data } });
      await this.audit.record(tx, ctx, { action: "tenant.profile_updated", entity: "TenantProfile", entityId: ctx.tenantId, before: before ? { legalName: before.legalName, siren: before.siren } : undefined, after: { legalName: p.legalName, siren: p.siren } });
      return { profile: p, complete: sellerComplete(p) };
    });
  }
}
