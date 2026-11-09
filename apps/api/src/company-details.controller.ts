import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Req } from "@nestjs/common";
import { z } from "zod";
import Decimal from "decimal.js";
import { PrismaService, Tx } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext, RequirePermission } from "./auth.guard";
import { parseZod } from "./workflow";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date AAAA-MM-JJ");
const money = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, "Montant invalide");
const Contact = z.object({ name: z.string().min(2).max(120), email: z.string().email().max(254).optional(), phone: z.string().min(5).max(30).optional(), role: z.enum(["billing", "operations", "signatory", "other"]), isPrimary: z.boolean().default(false) })
  .refine(v => v.email || v.phone, "Un email ou un téléphone est requis");
const Site = z.object({ label: z.string().min(2).max(120), address: z.string().min(3).max(200), postalCode: z.string().regex(/^\d{5}$/, "Code postal à 5 chiffres"), city: z.string().min(1).max(100), country: z.string().length(2).default("FR") });
const Terms = z.object({ paymentTermsDays: z.number().int().min(0).max(180).nullable() });
const PO = z.object({ reference: z.string().min(2).max(60), amount: money.refine(v => Number(v) > 0, "Montant > 0"), startDate: date, endDate: date }).refine(v => v.endDate >= v.startDate, "La fin précède le début");
const BILLED = ["issued", "partially_paid", "paid"];
type R = { ctx: RequestContext };
const luhn = (s: string) => { let t = 0; for (let i = 0; i < s.length; i++) { let d = Number(s[s.length - 1 - i]); if (i % 2) { d *= 2; if (d > 9) d -= 9; } t += d; } return t % 10 === 0; };

@Controller("companies")
export class CompanyDetailsController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private async company(tx: Tx, id: string) { const c = await tx.company.findUnique({ where: { id } }); if (!c) throw new NotFoundException(); return c; }

  /** Consommation d'un bon de commande : HT des factures émises des missions rattachées (brouillons, annulées et créditées exclues). */
  private async consumption(tx: Tx, poIds: string[]) {
    const out = new Map<string, Decimal>(poIds.map(i => [i, new Decimal(0)]));
    if (!poIds.length) return out;
    const ms = await tx.mission.findMany({ where: { purchaseOrderId: { in: poIds } }, select: { id: true, purchaseOrderId: true } });
    const inv = await tx.invoice.findMany({ where: { missionId: { in: ms.map(m => m.id) }, status: { in: BILLED } }, select: { missionId: true, net: true } });
    for (const i of inv) { const po = ms.find(m => m.id === i.missionId)!.purchaseOrderId!; out.set(po, out.get(po)!.plus(i.net.toString())); }
    return out;
  }
  private poView(p: { id: string; reference: string; amount: unknown; startDate: Date; endDate: Date; status: string; companyId: string }, used: Decimal) {
    const amount = new Decimal(String(p.amount)); const remaining = amount.minus(used);
    return { id: p.id, companyId: p.companyId, reference: p.reference, amount: amount.toFixed(2), startDate: p.startDate.toISOString().slice(0, 10), endDate: p.endDate.toISOString().slice(0, 10), status: p.status, consumed: used.toFixed(2), remaining: remaining.toFixed(2), overConsumed: remaining.isNegative() };
  }

  @Get(":id/overview") @RequirePermission("company.read")
  overview(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string) {
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const c = await this.company(tx, id);
      const [contacts, sites, pos, agreements, missions] = await Promise.all([
        tx.companyContact.findMany({ where: { companyId: id }, orderBy: [{ role: "asc" }, { name: "asc" }] }), tx.companySite.findMany({ where: { companyId: id, archivedAt: null }, orderBy: { label: "asc" } }),
        tx.purchaseOrder.findMany({ where: { companyId: id }, orderBy: { createdAt: "desc" } }), tx.frameworkAgreement.count({ where: { companyId: id, status: "active" } }), tx.mission.count({ where: { companyId: id, status: "active" } })]);
      const used = await this.consumption(tx, pos.map(p => p.id));
      return { company: { id: c.id, name: c.name, siren: c.siren, paymentTermsDays: c.paymentTermsDays, sirenChecksumValid: c.siren ? luhn(c.siren) : null }, contacts, sites,
        purchaseOrders: pos.map(p => this.poView(p, used.get(p.id)!)), activeAgreements: agreements, activeMissions: missions };
    });
  }

  @Patch(":id/terms") @RequirePermission("company.write")
  terms(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parseZod(Terms, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const before = await this.company(tx, id); await tx.company.update({ where: { id }, data: { paymentTermsDays: d.paymentTermsDays } });
      await this.audit.record(tx, ctx, { action: "company.terms_updated", entity: "Company", entityId: id, before: { paymentTermsDays: before.paymentTermsDays }, after: d });
      return { id, paymentTermsDays: d.paymentTermsDays };
    });
  }

  @Post(":id/contacts") @RequirePermission("company.write")
  addContact(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parseZod(Contact, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      await this.company(tx, id);
      if (d.isPrimary) await tx.companyContact.updateMany({ where: { companyId: id, role: d.role, isPrimary: true }, data: { isPrimary: false } });
      const c = await tx.companyContact.create({ data: { tenantId: ctx.tenantId, companyId: id, name: d.name, email: d.email, phone: d.phone, role: d.role, isPrimary: d.isPrimary, createdBy: ctx.userId } });
      await this.audit.record(tx, ctx, { action: "company.contact_added", entity: "CompanyContact", entityId: c.id, after: { companyId: id, role: d.role, isPrimary: d.isPrimary } });
      return c;
    });
  }
  @Delete(":id/contacts/:contactId") @RequirePermission("company.write")
  removeContact(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Param("contactId", ParseUUIDPipe) contactId: string) {
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const c = await tx.companyContact.findFirst({ where: { id: contactId, companyId: id } }); if (!c) throw new NotFoundException();
      await tx.companyContact.delete({ where: { id: contactId } });
      await this.audit.record(tx, ctx, { action: "company.contact_removed", entity: "CompanyContact", entityId: contactId, before: { companyId: id, role: c.role } });
      return { id: contactId, removed: true };
    });
  }

  @Post(":id/sites") @RequirePermission("company.write")
  addSite(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parseZod(Site, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      await this.company(tx, id);
      if (await tx.companySite.findFirst({ where: { companyId: id, archivedAt: null, label: { equals: d.label, mode: "insensitive" } } })) throw new ConflictException("Un site porte déjà ce libellé");
      const s = await tx.companySite.create({ data: { tenantId: ctx.tenantId, companyId: id, ...d, createdBy: ctx.userId } });
      await this.audit.record(tx, ctx, { action: "company.site_added", entity: "CompanySite", entityId: s.id, after: { companyId: id, label: d.label } });
      return s;
    });
  }
  @Delete(":id/sites/:siteId") @RequirePermission("company.write")
  archiveSite(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Param("siteId", ParseUUIDPipe) siteId: string) {
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const r = await tx.companySite.updateMany({ where: { id: siteId, companyId: id, archivedAt: null }, data: { archivedAt: new Date() } }); if (r.count !== 1) throw new NotFoundException();
      await this.audit.record(tx, ctx, { action: "company.site_archived", entity: "CompanySite", entityId: siteId, before: { companyId: id } });
      return { id: siteId, archived: true };
    });
  }

  @Post(":id/purchase-orders") @RequirePermission("company.write")
  addPo(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = parseZod(PO, body);
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      await this.company(tx, id);
      if (await tx.purchaseOrder.findFirst({ where: { companyId: id, reference: d.reference } })) throw new ConflictException("Cette référence de bon de commande existe déjà pour ce client");
      const p = await tx.purchaseOrder.create({ data: { tenantId: ctx.tenantId, companyId: id, reference: d.reference, amount: d.amount, startDate: new Date(d.startDate), endDate: new Date(d.endDate), createdBy: ctx.userId } });
      await this.audit.record(tx, ctx, { action: "company.po_created", entity: "PurchaseOrder", entityId: p.id, after: { companyId: id, reference: d.reference, amount: d.amount } });
      return this.poView(p, new Decimal(0));
    });
  }
  @Post(":id/purchase-orders/:poId/:event") @RequirePermission("company.write")
  poTransition(@Req() { ctx }: R, @Param("id", ParseUUIDPipe) id: string, @Param("poId", ParseUUIDPipe) poId: string, @Param("event") event: string) {
    if (!["close", "cancel"].includes(event)) throw new BadRequestException("Événement inconnu");
    return this.prisma.forTenant(ctx.tenantId, async tx => {
      const p = await tx.purchaseOrder.findFirst({ where: { id: poId, companyId: id } }); if (!p) throw new NotFoundException();
      if (p.status !== "open") throw new BadRequestException(`Bon de commande déjà ${p.status === "closed" ? "clos" : "annulé"}`);
      const used = (await this.consumption(tx, [poId])).get(poId)!;
      if (event === "cancel" && used.gt(0)) throw new BadRequestException("Annulation impossible : des factures émises sont rattachées (clôturez-le)");
      const r = await tx.purchaseOrder.updateMany({ where: { id: poId, status: "open" }, data: { status: event === "close" ? "closed" : "cancelled" } }); if (r.count !== 1) throw new ConflictException("Statut modifié entre-temps");
      await this.audit.record(tx, ctx, { action: `company.po_${event === "close" ? "closed" : "cancelled"}`, entity: "PurchaseOrder", entityId: poId, before: { status: "open" } });
      return this.poView({ ...p, status: event === "close" ? "closed" : "cancelled" }, used);
    });
  }
}
