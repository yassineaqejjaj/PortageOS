import { Injectable } from "@nestjs/common";
import { LeaveSpan, consumesBalance, leaveBalance, leaveDays, LeaveType } from "@portage/domain";
import { Tx } from "./prisma.service";

export const HOLIDAY_KEY = "calendar.public_holiday";

@Injectable()
export class LeavesService {
  /** Jours fériés APPROUVÉS (paramètres datés, quatre yeux) dans [start, end]. */
  async holidays(tx: Tx, start: string, end: string): Promise<Set<string>> {
    const rows = await tx.ruleParameter.findMany({ where: { key: HOLIDAY_KEY, status: "approved", validFrom: { gte: new Date(start), lte: new Date(end) } }, select: { validFrom: true } });
    return new Set(rows.map(r => r.validFrom.toISOString().slice(0, 10)));
  }

  async compute(tx: Tx, span: LeaveSpan) {
    const hol = await this.holidays(tx, span.start, span.end);
    const days = leaveDays(span, hol);
    // « configuré » = au moins un férié approuvé sur l'année de début ; sinon le décompte est signalé non fiable.
    const y = span.start.slice(0, 4);
    const configured = (await tx.ruleParameter.count({ where: { key: HOLIDAY_KEY, status: "approved", validFrom: { gte: new Date(`${y}-01-01`), lte: new Date(`${y}-12-31`) } } })) > 0;
    return { days, configured };
  }

  async balance(tx: Tx, consultantId: string, excludeRequestId?: string) {
    const adj = await tx.leaveAdjustment.findMany({ where: { consultantId }, select: { days: true } });
    const used = await tx.leaveRequest.findMany({ where: { consultantId, type: "paid_leave", status: "approved", ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}) }, select: { days: true } });
    return leaveBalance(adj.map(a => a.days.toString()), used.map(u => u.days.toString()));
  }

  /** Couverture d'absence approuvée par date (pour contrôler les CRA). */
  async coverage(tx: Tx, consultantId: string, dates: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!dates.length) return out;
    const sorted = [...dates].sort(); const from = sorted[0]!, to = sorted[sorted.length - 1]!;
    const reqs = await tx.leaveRequest.findMany({ where: { consultantId, status: "approved", startDate: { lte: new Date(to) }, endDate: { gte: new Date(from) } } });
    for (const r of reqs) {
      const span = { start: r.startDate.toISOString().slice(0, 10), end: r.endDate.toISOString().slice(0, 10), halfStart: r.halfStart, halfEnd: r.halfEnd };
      const hol = await this.holidays(tx, span.start, span.end);
      for (const d of leaveDays(span, hol)) out.set(d.date, Math.min(1, (out.get(d.date) ?? 0) + Number(d.quantity)));
    }
    return out;
  }

  consumes(t: string) { return consumesBalance(t as LeaveType); }
}
