import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { ACCOUNT_TYPES, isValidPeriod, toCsv } from "@portage/domain";
import { PrismaService } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext, RequirePermission } from "./auth.guard";
import { AccountingService } from "./accounting.service";
import { parisToday, parseZod } from "./workflow";

const money = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, "Montant invalide (2 décimales max)");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date AAAA-MM-JJ");
const Account = z.object({ code: z.string().max(8), label: z.string().min(2).max(120), type: z.enum(ACCOUNT_TYPES) });
const AccountPatch = z.object({ label: z.string().min(2).max(120).optional(), active: z.boolean().optional() }).refine(v => Object.keys(v).length > 0, "Aucun champ");
const Entry = z.object({ valueDate: date, label: z.string().min(3).max(200), reason: z.string().min(5, "Motif obligatoire (5 caractères min.)").max(500), lines: z.array(z.object({ account: z.string().max(8), debit: money.optional(), credit: money.optional() })).min(2).max(50) });
const Reverse = z.object({ reason: z.string().min(5, "Motif obligatoire (5 caractères min.)").max(500), valueDate: date.optional() });
const Close = z.object({ acknowledgeWarnings: z.boolean().optional(), comment: z.string().max(500).optional() });
const Reopen = z.object({ reason: z.string().min(5, "Motif obligatoire (5 caractères min.)").max(500) });
type R = { ctx: RequestContext };
const month = () => parisToday().slice(0, 7);
const monthsAgo = (n: number) => { const [y, m] = month().split("-").map(Number) as [number, number]; const t = y * 12 + (m - 1) - n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
function range(from?: string, to?: string, back = 11) { const f = from ?? monthsAgo(back), t = to ?? month(); if (!isValidPeriod(f) || !isValidPeriod(t)) throw new BadRequestException("Période invalide (AAAA-MM)"); return { f, t }; }
function period(p: string) { if (!isValidPeriod(p)) throw new BadRequestException("Période invalide (AAAA-MM)"); return p; }

@Controller("accounting")
export class AccountingController {
  constructor(private prisma: PrismaService, private svc: AccountingService, private audit: AuditService) {}

  @Get("accounts") @RequirePermission("accounting.read")
  accounts(@Req() { ctx }: R) { return this.prisma.forTenant(ctx.tenantId, tx => this.svc.accounts(tx, ctx.tenantId)); }

  @Post("accounts") @RequirePermission("accounting.write")
  createAccount(@Req() { ctx }: R, @Body() body: unknown) { const d = parseZod(Account, body); return this.prisma.forTenant(ctx.tenantId, tx => this.svc.createAccount(tx, ctx, d)); }

  @Patch("accounts/:code") @RequirePermission("accounting.write")
  patchAccount(@Req() { ctx }: R, @Param("code") code: string, @Body() body: unknown) { const d = parseZod(AccountPatch, body); return this.prisma.forTenant(ctx.tenantId, tx => this.svc.patchAccount(tx, ctx, code, d)); }

  @Get("periods") @RequirePermission("accounting.read")
  periods(@Req() { ctx }: R) { return this.prisma.forTenant(ctx.tenantId, tx => this.svc.periods(tx, ctx.tenantId)); }

  @Get("periods/:period/checks") @RequirePermission("accounting.read")
  checks(@Req() { ctx }: R, @Param("period") p: string) { return this.prisma.forTenant(ctx.tenantId, tx => this.svc.checks(tx, ctx.tenantId, period(p))); }

  @Post("periods/:period/close") @RequirePermission("accounting.close")
  close(@Req() { ctx }: R, @Param("period") p: string, @Body() body: unknown) { const d = parseZod(Close, body ?? {}); return this.prisma.forTenant(ctx.tenantId, tx => this.svc.close(tx, ctx, period(p), !!d.acknowledgeWarnings, d.comment)); }

  @Post("periods/:period/reopen") @RequirePermission("accounting.reopen")
  reopen(@Req() { ctx }: R, @Param("period") p: string, @Body() body: unknown) { const d = parseZod(Reopen, body); return this.prisma.forTenant(ctx.tenantId, tx => this.svc.reopen(tx, ctx, period(p), d.reason)); }

  @Get("balance") @RequirePermission("accounting.read")
  balance(@Req() { ctx }: R, @Query("from") from?: string, @Query("to") to?: string) { const { f, t } = range(from, to, 0); return this.prisma.forTenant(ctx.tenantId, tx => this.svc.balance(tx, ctx.tenantId, f, t)); }

  @Get("vat") @RequirePermission("accounting.read")
  vat(@Req() { ctx }: R, @Query("from") from?: string, @Query("to") to?: string) { const { f, t } = range(from, to, 5); return this.prisma.forTenant(ctx.tenantId, tx => this.svc.vat(tx, ctx.tenantId, f, t)); }

  @Get("third-parties") @RequirePermission("accounting.read")
  thirdParties(@Req() { ctx }: R) { return this.prisma.forTenant(ctx.tenantId, tx => this.svc.thirdParties(tx)); }

  @Get("entries") @RequirePermission("accounting.read")
  entries(@Req() { ctx }: R, @Query("from") from?: string, @Query("to") to?: string, @Query("account") account?: string) { const { f, t } = range(from, to, 2); return this.prisma.forTenant(ctx.tenantId, tx => this.svc.entries(tx, f, t, account)); }

  @Post("entries") @RequirePermission("accounting.write")
  manual(@Req() { ctx }: R, @Body() body: unknown) { const d = parseZod(Entry, body); return this.prisma.forTenant(ctx.tenantId, tx => this.svc.manualEntry(tx, ctx, d)); }

  @Post("entries/:id/reverse") @RequirePermission("accounting.write")
  reverse(@Req() { ctx }: R, @Param("id") id: string, @Body() body: unknown) { const d = parseZod(Reverse, body); return this.prisma.forTenant(ctx.tenantId, tx => this.svc.reverse(tx, ctx, id, d.reason, d.valueDate)); }

  /** Dossier de l'expert-comptable pour une période : statut, contrôles, balance, TVA, tiers. */
  @Get("dossier") @RequirePermission("accounting.read")
  dossier(@Req() { ctx }: R, @Query("period") p?: string) {
    const per = period(p ?? month());
    return this.prisma.forTenant(ctx.tenantId, async tx => ({ period: per, checks: await this.svc.checks(tx, ctx.tenantId, per), balance: await this.svc.balance(tx, ctx.tenantId, per, per), vat: await this.svc.vat(tx, ctx.tenantId, per, per), thirdParties: await this.svc.thirdParties(tx) }));
  }

  /** Export au format des colonnes du FEC (séparateur tabulation). Non validé par l'outil officiel de contrôle : à faire valider par l'expert-comptable. */
  @Get("export/fec") @RequirePermission("accounting.export")
  async fec(@Req() { ctx }: R, @Res({ passthrough: true }) res: Response, @Query("from") from?: string, @Query("to") to?: string) {
    const { f, t } = range(from, to, 11);
    const r = await this.prisma.forTenant(ctx.tenantId, async tx => { const slug = (await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } })).slug; return { ...(await this.svc.fec(tx, ctx, f, t)), slug }; });
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="FEC-${r.slug}-${f}_${t}${r.provisional ? "-provisoire" : ""}.txt"`);
    res.setHeader("X-Export-Provisional", String(r.provisional));
    return r.text;
  }

  @Get("export/balance.csv") @RequirePermission("accounting.export")
  async balanceCsv(@Req() { ctx }: R, @Res({ passthrough: true }) res: Response, @Query("from") from?: string, @Query("to") to?: string) {
    const { f, t } = range(from, to, 0);
    const b = await this.prisma.forTenant(ctx.tenantId, async tx => { const r = await this.svc.balance(tx, ctx.tenantId, f, t); await this.audit.record(tx, ctx, { action: "accounting.export_balance", entity: "Report", after: { from: f, to: t } }); return r; });
    res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", `attachment; filename="balance-${f}-${t}.csv"`);
    return toCsv([["compte", "libelle", "mouvement_debit", "mouvement_credit", "solde_debit", "solde_credit"], ...b.rows.map(r => [r.account, r.label, r.movementDebit, r.movementCredit, r.endDebit, r.endCredit])]);
  }
}
