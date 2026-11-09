import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import Decimal from "decimal.js";
import { CsvMapping, DEFAULT_SCORING_WEIGHTS, ScoringWeights, parseCsv, percentCommission, scoreProspect, simulateOffer, suggestMapping, validateProspectRow, withinDuration } from "@portage/domain";
import { Tx } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext } from "./auth.guard";
import { ParametersService } from "./parameters.service";
import { parisToday } from "./workflow";

const D = (v: unknown) => new Decimal(String(v ?? 0));
export const MAX_CSV = 1_000_000;

@Injectable()
export class CrmService {
  constructor(private audit: AuditService, private params: ParametersService) {}

  async weights(tx: Tx): Promise<ScoringWeights> { const c = await tx.scoringConfig.findFirst(); return c ? { ...DEFAULT_SCORING_WEIGHTS, ...(c.weights as Partial<ScoringWeights>) } : DEFAULT_SCORING_WEIGHTS; }

  /** Score de chaque prospect avec le détail des points (explicable). */
  async scores(tx: Tx, prospects: { id: string; stage: string; email: string | null; phone: string | null; campaignId: string | null }[]) {
    if (!prospects.length) return new Map<string, ReturnType<typeof scoreProspect>>();
    const ids = prospects.map(p => p.id), w = await this.weights(tx), now = new Date().toISOString(), today = new Date(parisToday());
    const inter = await tx.interaction.groupBy({ by: ["prospectId"], where: { prospectId: { in: ids } }, _count: true, _max: { occurredAt: true } });
    const late = await tx.crmTask.groupBy({ by: ["prospectId"], where: { prospectId: { in: ids }, status: "open", dueDate: { lt: today } }, _count: true });
    const refs = new Set((await tx.referral.findMany({ where: { prospectId: { in: ids } }, select: { prospectId: true } })).map(r => r.prospectId));
    return new Map(prospects.map(p => { const i = inter.find(x => x.prospectId === p.id); return [p.id, scoreProspect({ stage: p.stage, hasEmail: !!p.email, hasPhone: !!p.phone, referred: refs.has(p.id), inCampaign: !!p.campaignId, interactions: i?._count ?? 0, lastInteractionAt: i?._max.occurredAt?.toISOString(), overdueTasks: late.find(x => x.prospectId === p.id)?._count ?? 0, now }, w)]; }));
  }

  /** Conversion d'un prospect : lie le parrainage à l'entité créée et comptabilise une commission forfaitaire éventuelle. */
  async onConverted(tx: Tx, ctx: RequestContext, prospectId: string, created: { consultantId?: string; companyId?: string }) {
    const r = await tx.referral.findUnique({ where: { prospectId } });
    if (!r) return;
    await tx.referral.update({ where: { id: r.id }, data: { convertedAt: new Date(), consultantId: created.consultantId ?? null, companyId: created.companyId ?? null } });
    if (r.ruleType === "fixed_per_conversion" && D(r.ruleValue).gt(0)) {
      const c = await tx.commission.create({ data: { tenantId: ctx.tenantId, referralId: r.id, sourceType: "conversion", sourceId: prospectId, amount: D(r.ruleValue).toFixed(2) } });
      await this.audit.record(tx, ctx, { action: "crm.commission_accrued", entity: "Commission", entityId: c.id, after: { type: "fixed_per_conversion", amount: c.amount.toString() } });
    }
  }

  /** Encaissement : commissions proportionnelles (quote-part HT × taux) pendant la durée convenue. Idempotent par (parrainage, paiement). */
  async accrueOnPayment(tx: Tx, ctx: RequestContext, payment: { id: string; amount: string; receivedOn: string }, invoice: { net: string; gross: string; companyId: string }, consultantId: string) {
    const refs = await tx.referral.findMany({ where: { ruleType: "percent_of_collected_net", convertedAt: { not: null }, OR: [{ consultantId }, { companyId: invoice.companyId }] } });
    for (const r of refs) {
      if (!withinDuration(r.convertedAt!.toISOString(), payment.receivedOn, r.durationMonths)) continue;
      const share = D(payment.amount).times(invoice.net).div(invoice.gross).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
      const amount = percentCommission(share, r.ruleValue.toString()); if (D(amount).isZero()) continue;
      if (await tx.commission.findUnique({ where: { referralId_sourceType_sourceId: { referralId: r.id, sourceType: "payment", sourceId: payment.id } } })) continue;
      const c = await tx.commission.create({ data: { tenantId: ctx.tenantId, referralId: r.id, sourceType: "payment", sourceId: payment.id, amount } });
      await this.audit.record(tx, ctx, { action: "crm.commission_accrued", entity: "Commission", entityId: c.id, after: { type: "percent_of_collected_net", base: share, percent: r.ruleValue.toString(), amount } });
    }
  }

  // ---------- imports CSV ----------
  async previewImport(tx: Tx, ctx: RequestContext, d: { csv: string; fileName?: string; mapping?: CsvMapping; defaultKind: "consultant" | "company"; campaignId?: string }) {
    if (d.csv.length > MAX_CSV) throw new BadRequestException("Fichier trop volumineux (1 Mo maximum)");
    if (d.campaignId && !(await tx.campaign.findUnique({ where: { id: d.campaignId } }))) throw new BadRequestException("Campagne introuvable");
    let parsed; try { parsed = parseCsv(d.csv, 2000); } catch (e) { throw new BadRequestException((e as Error).message); }
    const mapping = d.mapping ?? suggestMapping(parsed.headers);
    if (!mapping.name) throw new BadRequestException("Colonne « nom » introuvable : précisez le mappage des colonnes");
    for (const h of Object.values(mapping)) if (h && !parsed.headers.includes(h)) throw new BadRequestException(`Colonne inconnue dans le mappage : ${h}`);
    const existing = new Set((await tx.prospect.findMany({ where: { archivedAt: null, email: { not: null } }, select: { email: true } })).map(p => p.email!.toLowerCase()));
    const seen = new Set<string>(); const valid: unknown[] = []; const report: { line: number; errors: string[] }[] = [];
    parsed.rows.forEach((row, i) => {
      const v = validateProspectRow(row, mapping, d.defaultKind); const line = i + 2;
      if (!v.ok) return void report.push({ line, errors: v.errors });
      const em = v.data.email;
      if (em && existing.has(em)) return void report.push({ line, errors: ["doublon : un prospect avec cet email existe déjà"] });
      if (em && seen.has(em)) return void report.push({ line, errors: ["doublon dans le fichier"] });
      if (em) seen.add(em); valid.push(v.data);
    });
    const job = await tx.importJob.create({ data: { tenantId: ctx.tenantId, kind: "prospects", fileName: d.fileName?.slice(0, 120), campaignId: d.campaignId, defaultKind: d.defaultKind, mapping: mapping as object, rowsTotal: parsed.rows.length, rowsValid: valid.length, rowsInvalid: report.length, report: report as object, validRows: valid as object, createdBy: ctx.userId } });
    await this.audit.record(tx, ctx, { action: "crm.import_previewed", entity: "ImportJob", entityId: job.id, after: { total: job.rowsTotal, valid: job.rowsValid, invalid: job.rowsInvalid } });
    return this.importView(job, true);
  }
  importView(j: { id: string; status: string; fileName: string | null; rowsTotal: number; rowsValid: number; rowsInvalid: number; report: unknown; mapping: unknown; createdAt: Date; committedAt: Date | null; rolledBackAt: Date | null; validRows?: unknown }, withRows = false) {
    return { id: j.id, status: j.status, fileName: j.fileName, rowsTotal: j.rowsTotal, rowsValid: j.rowsValid, rowsInvalid: j.rowsInvalid, errors: (j.report as unknown[]).slice(0, 200), mapping: j.mapping, createdAt: j.createdAt, committedAt: j.committedAt, rolledBackAt: j.rolledBackAt, ...(withRows ? { sample: (j.validRows as unknown[]).slice(0, 5) } : {}) };
  }
  async commitImport(tx: Tx, ctx: RequestContext, id: string) {
    const j = await tx.importJob.findUnique({ where: { id } }); if (!j) throw new NotFoundException();
    const claim = await tx.importJob.updateMany({ where: { id, status: "previewed" }, data: { status: "committed", committedAt: new Date() } });
    if (claim.count !== 1) throw new ConflictException(`Import déjà ${j.status === "committed" ? "validé" : j.status}`);
    const existing = new Set((await tx.prospect.findMany({ where: { archivedAt: null, email: { not: null } }, select: { email: true } })).map(p => p.email!.toLowerCase()));
    let created = 0, skipped = 0;
    for (const r of j.validRows as { kind: string; name: string; email?: string; phone?: string; source?: string }[]) {
      if (r.email && existing.has(r.email)) { skipped++; continue; } // doublon apparu entre l'aperçu et la validation
      await tx.prospect.create({ data: { tenantId: ctx.tenantId, kind: r.kind, name: r.name, email: r.email, phone: r.phone, source: r.source ?? "import", campaignId: j.campaignId, importJobId: j.id } });
      if (r.email) existing.add(r.email); created++;
    }
    await this.audit.record(tx, ctx, { action: "crm.import_committed", entity: "ImportJob", entityId: id, after: { created, skippedDuplicates: skipped } });
    return { id, status: "committed", created, skippedDuplicates: skipped };
  }
  /** Annulation logique : possible seulement si aucun prospect importé n'a été travaillé (étape « nouveau », sans interaction, tâche ni parrainage). */
  async rollbackImport(tx: Tx, ctx: RequestContext, id: string) {
    const j = await tx.importJob.findUnique({ where: { id } }); if (!j) throw new NotFoundException();
    if (j.status !== "committed") throw new ConflictException(`Seul un import validé peut être annulé (statut : ${j.status})`);
    const ps = await tx.prospect.findMany({ where: { importJobId: id, archivedAt: null }, select: { id: true, stage: true } });
    const ids = ps.map(p => p.id);
    const touched = ps.filter(p => p.stage !== "new").length + (await tx.interaction.count({ where: { prospectId: { in: ids } } })) + (await tx.crmTask.count({ where: { prospectId: { in: ids } } })) + (await tx.referral.count({ where: { prospectId: { in: ids } } }));
    if (touched) throw new ConflictException(`Annulation impossible : ${touched} élément(s) ont déjà été travaillés (étape, interaction, tâche ou parrainage)`);
    await tx.prospect.updateMany({ where: { importJobId: id }, data: { archivedAt: new Date() } });
    await tx.importJob.update({ where: { id }, data: { status: "rolled_back", rolledBackAt: new Date() } });
    await this.audit.record(tx, ctx, { action: "crm.import_rolled_back", entity: "ImportJob", entityId: id, after: { archived: ids.length } });
    return { id, status: "rolled_back", archived: ids.length };
  }

  // ---------- simulation ----------
  async simulate(tx: Tx, ctx: RequestContext, d: { prospectId?: string; feeRatePercent?: string; scenarios: { label: string; dailyRate: string; daysPerMonth: string; vatRate: string; monthlyExpenses?: string }[] }) {
    if (d.prospectId && !(await tx.prospect.findUnique({ where: { id: d.prospectId } }))) throw new NotFoundException();
    let fee = d.feeRatePercent, feeSource: object = { type: "hypothesis", note: "Taux saisi par l'utilisateur : hypothèse, non issue des paramètres approuvés" };
    if (!fee) { const p = await this.params.at(tx, "management_fee_rate_percent", parisToday()); if (!p) throw new UnprocessableEntityException("Aucun taux de frais de gestion approuvé : saisissez un taux (hypothèse) ou faites approuver le paramètre « management_fee_rate_percent »"); fee = p.value; feeSource = { type: "parameter", key: p.key, value: p.value, source: p.source, validFrom: p.validFrom }; }
    let results; try { results = d.scenarios.map(s => ({ label: s.label, inputs: { ...s, feeRatePercent: fee }, ...simulateOffer({ ...s, feeRatePercent: fee! }) })); } catch (e) { throw new BadRequestException((e as Error).message); }
    const out = { feeRatePercent: fee, feeSource, results, disclaimer: "Simulation commerciale indicative. Ce n'est ni un calcul de rémunération, ni un bulletin de paie, ni un engagement." };
    const row = await tx.simulation.create({ data: { tenantId: ctx.tenantId, prospectId: d.prospectId, inputs: { scenarios: d.scenarios, feeRatePercent: fee } as object, results: out as unknown as object, createdBy: ctx.userId } });
    await this.audit.record(tx, ctx, { action: "crm.simulation", entity: "Simulation", entityId: row.id, after: { prospectId: d.prospectId, scenarios: d.scenarios.length, feeSource } });
    return { id: row.id, createdAt: row.createdAt, ...out };
  }
}
