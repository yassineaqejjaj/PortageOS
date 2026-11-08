import { BadRequestException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Query, Req } from "@nestjs/common";
import Decimal from "decimal.js";
import { activityStatement, isValidPeriod } from "@portage/domain";
import { PrismaService, Tx } from "./prisma.service";
import { RequestContext, RequirePermission } from "./auth.guard";
import { ParametersService } from "./parameters.service";

const FEE_KEY = "management_fee_rate_percent";
const DISCLAIMER = "Estimation indicative fondée sur les mouvements enregistrés et les paramètres cités. Ce n'est ni un bulletin de paie ni un calcul de rémunération : charges sociales, impositions, indemnités et salaire sont calculés par le prestataire de paie (non connecté).";

@Controller()
export class AccountsController {
  constructor(private prisma: PrismaService, private params: ParametersService) {}

  private async compute(tx: Tx, consultantId: string, period: string) {
    if (!isValidPeriod(period)) throw new BadRequestException("Période invalide (AAAA-MM)");
    const c = await tx.consultant.findUnique({ where: { id: consultantId } });
    if (!c) throw new NotFoundException();
    const from = new Date(`${period}-01`), to = new Date(from); to.setUTCMonth(to.getUTCMonth() + 1);
    const missions = await tx.mission.findMany({ where: { consultantId }, select: { id: true } });
    const missionIds = missions.map(m => m.id);
    const invoiced = await tx.invoice.findMany({ where: { missionId: { in: missionIds }, status: { in: ["issued", "partially_paid", "paid"] }, issueDate: { gte: from, lt: to } } });
    const pays = await tx.payment.findMany({ where: { invoice: { missionId: { in: missionIds }, status: { notIn: ["credited", "cancelled"] } }, receivedOn: { gte: from, lt: to } }, include: { invoice: true }, orderBy: { receivedOn: "asc" } });
    const used = new Map<string, { key: string; value: string; unit: string; source: string; validFrom: string }>();
    const paymentsIn = [];
    for (const p of pays) {
      const rate = await this.params.at(tx, FEE_KEY, p.receivedOn.toISOString().slice(0, 10));
      if (rate) used.set(rate.id, rate);
      paymentsIn.push({ amount: p.amount.toString(), invoiceNet: p.invoice.net.toString(), invoiceGross: p.invoice.gross.toString(), feeRatePercent: rate?.value ?? null });
    }
    const claims = await tx.expenseClaim.findMany({ where: { consultantId, status: "reimbursed", reimbursedAt: { gte: from, lt: to } } });
    const expenses = claims.reduce((s, x) => s.plus(x.total.toString()), new Decimal(0));
    const st = activityStatement({ payments: paymentsIn, invoicedNet: invoiced.reduce((s, i) => s.plus(i.net.toString()), new Decimal(0)).toString(), expensesReimbursed: expenses.toString() });
    return {
      consultant: `${c.firstName} ${c.lastName}`, period, estimate: true, disclaimer: DISCLAIMER, ...st,
      feeStatus: pays.length === 0 ? "no_collection" : st.managementFee === null ? "parameter_missing" : "computed",
      movements: {
        invoices: invoiced.map(i => ({ number: i.number, issueDate: i.issueDate!.toISOString().slice(0, 10), net: i.net.toString() })),
        payments: pays.map(p => ({ invoice: p.invoice.number, receivedOn: p.receivedOn.toISOString().slice(0, 10), amount: p.amount.toString() })),
        expenses: claims.map(x => ({ title: x.title, reimbursedAt: x.reimbursedAt!.toISOString().slice(0, 10), total: x.total.toString() })),
      },
      parametersUsed: [...used.values()],
    };
  }

  @Get("me/account") @RequirePermission("portal.self")
  mine(@Req() { ctx }: { ctx: RequestContext }, @Query("period") period: string) {
    if (!ctx.consultantId) throw new ForbiddenException("Compte non rattaché à un dossier consultant");
    return this.prisma.forTenant(ctx.tenantId, tx => this.compute(tx, ctx.consultantId!, period));
  }

  @Get("accounts/:consultantId") @RequirePermission("account.read")
  one(@Req() { ctx }: { ctx: RequestContext }, @Param("consultantId", ParseUUIDPipe) id: string, @Query("period") period: string) {
    return this.prisma.forTenant(ctx.tenantId, tx => this.compute(tx, id, period));
  }
}
