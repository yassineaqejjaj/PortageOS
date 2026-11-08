import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext, RequirePermission } from "./auth.guard";

const siren = z.string().regex(/^\d{9}$/, "SIREN: 9 chiffres").optional();
const CreateDto = z.object({ name: z.string().min(1).max(200), siren });
const UpdateDto = CreateDto.partial().refine(v => Object.keys(v).length > 0, "Aucun champ");
type Req_ = { ctx: RequestContext };
function parse<T>(s: z.ZodType<T>, b: unknown): T {
  const r = s.safeParse(b);
  if (!r.success) throw new BadRequestException(r.error.issues.map(i => i.message).join("; "));
  return r.data;
}

@Controller("companies")
export class CompaniesController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get() @RequirePermission("company.read")
  list(@Req() { ctx }: Req_) {
    return this.prisma.forTenant(ctx.tenantId, tx => tx.company.findMany({ orderBy: { createdAt: "desc" }, take: 100 }));
  }

  @Get(":id") @RequirePermission("company.read")
  async get(@Req() { ctx }: Req_, @Param("id", ParseUUIDPipe) id: string) {
    const c = await this.prisma.forTenant(ctx.tenantId, tx => tx.company.findUnique({ where: { id } }));
    if (!c) throw new NotFoundException(); // RLS: un objet d'un autre tenant est indistinguable d'un objet absent
    return c;
  }

  @Post() @RequirePermission("company.write")
  create(@Req() { ctx }: Req_, @Body() body: unknown) {
    const d = parse(CreateDto, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const c = await tx.company.create({ data: { tenantId: ctx.tenantId, name: d.name, siren: d.siren } }); // tenantId jamais lu du body
      await this.audit.record(tx, ctx, { action: "company.create", entity: "Company", entityId: c.id, after: c });
      return c;
    });
  }

  @Patch(":id") @RequirePermission("company.write")
  update(@Req() { ctx }: Req_, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parse(UpdateDto, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const before = await tx.company.findUnique({ where: { id } });
      if (!before) throw new NotFoundException();
      const after = await tx.company.update({ where: { id }, data: d });
      await this.audit.record(tx, ctx, { action: "company.update", entity: "Company", entityId: id, before, after });
      return after;
    });
  }
}
