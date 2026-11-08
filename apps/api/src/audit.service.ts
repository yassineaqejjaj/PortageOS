import { Injectable } from "@nestjs/common";
import { Tx } from "./prisma.service";
import { RequestContext } from "./auth.guard";

@Injectable()
export class AuditService {
  record(tx: Tx, ctx: Pick<RequestContext, "tenantId" | "userId">, e: { action: string; entity: string; entityId?: string; before?: unknown; after?: unknown }) {
    return tx.auditEvent.create({ data: {
      tenantId: ctx.tenantId, actorId: ctx.userId, action: e.action, entity: e.entity, entityId: e.entityId,
      before: (e.before ?? undefined) as never, after: (e.after ?? undefined) as never } });
  }
}
