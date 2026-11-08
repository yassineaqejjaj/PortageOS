import { Controller, Get, Header, Query, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { toCsv } from "@portage/domain";
import { PrismaService } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext, RequirePermission } from "./auth.guard";
import { PilotageService } from "./pilotage.service";
import { parisToday } from "./workflow";

type R = { ctx: RequestContext };
const monthNow = () => parisToday().slice(0, 7);
const monthsAgo = (n: number) => { const [y, m] = monthNow().split("-").map(Number) as [number, number]; const t = y * 12 + (m - 1) - n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };

@Controller("pilotage")
export class PilotageController {
  constructor(private prisma: PrismaService, private svc: PilotageService, private audit: AuditService) {}

  @Get("overview") @RequirePermission("pilotage.read")
  overview(@Req() { ctx }: R, @Query("from") from?: string, @Query("to") to?: string, @Query("asOf") asOf?: string) {
    return this.prisma.forTenant(ctx.tenantId, tx => this.svc.overview(tx, ctx.tenantId, from ?? monthsAgo(5), to ?? monthNow(), asOf));
  }

  /** Export contrôlé (permission dédiée, audité) : série mensuelle ; séparateur « ; », UTF-8, injection de formules neutralisée. */
  @Get("export.csv") @RequirePermission("pilotage.read")
  async exportCsv(@Req() { ctx }: R, @Res({ passthrough: true }) res: Response, @Query("from") from?: string, @Query("to") to?: string, @Query("asOf") asOf?: string) {
    const f = from ?? monthsAgo(5), t = to ?? monthNow();
    const o = await this.prisma.forTenant(ctx.tenantId, async tx => {
      const ov = await this.svc.overview(tx, ctx.tenantId, f, t, asOf);
      await this.audit.record(tx, ctx, { action: "pilotage.export", entity: "Report", after: { from: f, to: t, rows: ov.series.length } });
      return ov;
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="pilotage-${f}-${t}.csv"`);
    return toCsv([["mois", "ca_ht_eur", "ca_ttc_eur", "encaisse_ht_eur", "frais_gestion_eur"], ...o.series.map(s => [s.month, s.invoicedNet, s.invoicedGross, s.collectedNet, s.managementFee])]);
  }
}
