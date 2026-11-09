import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InvoiceState, applyPayment } from "@portage/domain";
import { Tx } from "./prisma.service";
import { AuditService } from "./audit.service";
import { RequestContext } from "./auth.guard";
import { ACCOUNTS, LedgerService } from "./ledger.service";
import { CrmService } from "./crm.service";

/** Enregistrement d'un encaissement : chemin UNIQUE (saisie manuelle et rapprochement bancaire), écriture comptable et commissions comprises. */
@Injectable()
export class PaymentsService {
  constructor(private audit: AuditService, private ledger: LedgerService, private crm: CrmService) {}
  async record(tx: Tx, ctx: RequestContext, invoiceId: string, d: { amount: string; receivedOn: string; reference?: string }, via: "manual" | "bank" = "manual") {
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new NotFoundException();
    let res; try { res = applyPayment(inv.status as InvoiceState, inv.gross.toString(), inv.paid.toString(), d.amount); } catch (e) { throw new BadRequestException((e as Error).message); }
    const p = await tx.payment.create({ data: { tenantId: ctx.tenantId, invoiceId, amount: d.amount, receivedOn: new Date(d.receivedOn), reference: d.reference } });
    const r = await tx.invoice.updateMany({ where: { id: invoiceId, paid: inv.paid, status: inv.status }, data: { paid: res.paid, status: res.state } });
    if (r.count !== 1) throw new ConflictException("Facture modifiée entre-temps (encaissement concurrent), rechargez.");
    const mission = await tx.mission.findUniqueOrThrow({ where: { id: inv.missionId } });
    await this.ledger.post(tx, { tenantId: ctx.tenantId, key: `payment:${p.id}`, label: `Encaissement ${inv.number}`, valueDate: d.receivedOn, sourceType: "payment", sourceId: p.id, consultantId: mission.consultantId,
      lines: [{ account: ACCOUNTS.banque, debit: d.amount }, { account: ACCOUNTS.clients, credit: d.amount }] });
    await this.crm.accrueOnPayment(tx, ctx, { id: p.id, amount: d.amount, receivedOn: d.receivedOn }, { net: inv.net.toString(), gross: inv.gross.toString(), companyId: inv.companyId }, mission.consultantId);
    await this.audit.record(tx, ctx, { action: "payment.record", entity: "Invoice", entityId: invoiceId, before: { paid: inv.paid.toString(), status: inv.status }, after: { paid: res.paid, status: res.state, amount: d.amount, via } });
    return { payment: p, invoiceId };
  }
}
