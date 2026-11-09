import { BadRequestException, Body, Controller, ForbiddenException, Get, Header, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { TIMESHEET_STATES } from "@portage/domain";
import { PrismaService } from "./prisma.service";
import { RequestContext, RequirePermission } from "./auth.guard";
import { TimesheetsService } from "./timesheets.service";
import { parseZod } from "./workflow";

const Lines = z.object({ lines: z.array(z.object({ date: z.string(), quantity: z.string() })).max(31) });
const Csv = z.object({ csv: z.string().min(1).max(60000) });
const Remind = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Période AAAA-MM") });
const Trans = z.object({ event: z.string().min(1).max(40), rejectReason: z.string().max(500).optional() });
const INTERNAL = ["submit", "recall", "reopen", "validate", "reopen_approved"];
const SELF = ["submit", "recall", "reopen"];
const CLIENT = ["approve", "reject"];
type R = { ctx: RequestContext };

function statusFilter(s?: string) {
  if (s && !(TIMESHEET_STATES as readonly string[]).includes(s)) throw new BadRequestException("Statut inconnu");
  return s ? { status: s } : {};
}

/** Gestion interne (opérations, direction, finance en lecture). */
@Controller("timesheets")
export class TimesheetsController {
  constructor(private prisma: PrismaService, private svc: TimesheetsService) {}

  @Get() @RequirePermission("timesheet.read")
  list(@Req() { ctx }: R, @Query("status") status?: string) {
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const rows = await tx.timesheet.findMany({ where: statusFilter(status), orderBy: { createdAt: "desc" }, take: 200, select: { id: true } });
      return Promise.all(rows.map(r => this.svc.view(tx, r.id, true)));
    });
  }

  @Get("export.csv") @RequirePermission("timesheet.read") @Header("content-type", "text/csv; charset=utf-8") @Header("content-disposition", "attachment; filename=\"cra.csv\"")
  export(@Req() { ctx }: R, @Query("period") period?: string, @Query("status") status?: string) {
    if (period !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new BadRequestException("Période invalide (AAAA-MM)");
    return this.prisma.forTenant(ctx.tenantId, tx => this.svc.exportCsv(tx, ctx, { period, status: statusFilter(status).status }, {}));
  }

  @Post("reminders") @RequirePermission("timesheet.write")
  remind(@Req() { ctx }: R, @Body() body: unknown) {
    const d = parseZod(Remind, body);
    return this.prisma.forTenant(ctx.tenantId, tx => this.svc.remind(tx, ctx, d.period));
  }

  @Get(":id") @RequirePermission("timesheet.read")
  async get(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) {
    return this.prisma.forTenant(ctx.tenantId, async tx => { if (!(await tx.timesheet.findUnique({ where: { id } }))) throw new NotFoundException(); return this.svc.view(tx, id, true); });
  }

  @Put("missions/:missionId/:period") @RequirePermission("timesheet.write")
  put(@Req() { ctx }: R, @Param("missionId", ParseUUIDPipe) missionId: string, @Param("period") period: string, @Body() body: unknown) {
    const d = parseZod(Lines, body);
    return this.prisma.forTenant(ctx.tenantId, tx => this.svc.putLines(tx, ctx, missionId, period, d.lines, {}));
  }

  @Put("missions/:missionId/:period/import") @RequirePermission("timesheet.write")
  import(@Req() { ctx }: R, @Param("missionId", ParseUUIDPipe) missionId: string, @Param("period") period: string, @Body() body: unknown) {
    const d = parseZod(Csv, body);
    return this.prisma.forTenant(ctx.tenantId, tx => this.svc.importCsv(tx, ctx, missionId, period, d.csv, {}));
  }

  @Post(":id/transition") @RequirePermission("timesheet.write")
  transition(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parseZod(Trans, body);
    return this.prisma.forTenant(ctx.tenantId, tx => this.svc.transition(tx, ctx, id, d.event, d.rejectReason, INTERNAL, {}));
  }
}

/** Portail consultant : uniquement les missions et CRA de son propre dossier. */
@Controller("me")
export class SelfPortalController {
  constructor(private prisma: PrismaService, private svc: TimesheetsService) {}
  private scope(ctx: RequestContext) { if (!ctx.consultantId) throw new ForbiddenException("Compte non rattaché à un dossier consultant"); return { consultantId: ctx.consultantId }; }

  @Get("missions") @RequirePermission("portal.self")
  missions(@Req() { ctx }: R) {
    const s = this.scope(ctx);
    return this.prisma.forTenant(ctx.tenantId, tx => tx.mission.findMany({ where: { consultantId: s.consultantId }, select: { id: true, title: true, timeUnit: true, annualDaysCap: true, startDate: true, endDate: true, status: true, company: { select: { name: true } } } }));
  }

  @Get("timesheets") @RequirePermission("portal.self")
  list(@Req() { ctx }: R, @Query("period") period?: string) {
    const s = this.scope(ctx);
    if (period !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new BadRequestException("Période invalide (AAAA-MM)");
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const rows = await tx.timesheet.findMany({ where: { mission: { consultantId: s.consultantId }, ...(period ? { period } : {}) }, orderBy: { period: "desc" }, take: 60, select: { id: true } });
      return Promise.all(rows.map(r => this.svc.view(tx, r.id, true)));
    });
  }

  @Put("timesheets/missions/:missionId/:period") @RequirePermission("portal.self")
  put(@Req() { ctx }: R, @Param("missionId", ParseUUIDPipe) missionId: string, @Param("period") period: string, @Body() body: unknown) {
    const d = parseZod(Lines, body); const s = this.scope(ctx);
    return this.prisma.forTenant(ctx.tenantId, tx => this.svc.putLines(tx, ctx, missionId, period, d.lines, s));
  }

  @Put("timesheets/missions/:missionId/:period/import") @RequirePermission("portal.self")
  import(@Req() { ctx }: R, @Param("missionId", ParseUUIDPipe) missionId: string, @Param("period") period: string, @Body() body: unknown) {
    const d = parseZod(Csv, body); const s = this.scope(ctx);
    return this.prisma.forTenant(ctx.tenantId, tx => this.svc.importCsv(tx, ctx, missionId, period, d.csv, s));
  }

  @Post("timesheets/:id/transition") @RequirePermission("portal.self")
  transition(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parseZod(Trans, body); const s = this.scope(ctx);
    return this.prisma.forTenant(ctx.tenantId, tx => this.svc.transition(tx, ctx, id, d.event, d.rejectReason, SELF, s));
  }
}

/** Portail client : CRA des seules missions de son entreprise ; aucune donnée tarifaire ni salariale dans les réponses. */
@Controller("client")
export class ClientPortalController {
  constructor(private prisma: PrismaService, private svc: TimesheetsService) {}
  private scope(ctx: RequestContext) { if (!ctx.companyId) throw new ForbiddenException("Compte non rattaché à une entreprise"); return { companyId: ctx.companyId }; }

  @Get("timesheets") @RequirePermission("portal.client")
  list(@Req() { ctx }: R, @Query("status") status?: string) {
    const s = this.scope(ctx);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const rows = await tx.timesheet.findMany({ where: { ...statusFilter(status ?? "submitted"), mission: { companyId: s.companyId } }, orderBy: { period: "desc" }, take: 100, select: { id: true } });
      return Promise.all(rows.map(r => this.svc.view(tx, r.id)));
    });
  }

  @Post("timesheets/:id/transition") @RequirePermission("portal.client")
  transition(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parseZod(Trans, body); const s = this.scope(ctx);
    return this.prisma.forTenant(ctx.tenantId, tx => this.svc.transition(tx, ctx, id, d.event, d.rejectReason, CLIENT, s));
  }
}
