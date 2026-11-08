import Decimal from "decimal.js";
import { StateMachine } from "./state-machine.js";

export const LEAVE_TYPES = ["paid_leave", "sick", "unpaid", "other"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];
/** Seul le congé payé consomme le solde. */
export const consumesBalance = (t: LeaveType) => t === "paid_leave";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function addDay(iso: string): string { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
function isWeekday(iso: string): boolean { const w = new Date(`${iso}T00:00:00Z`).getUTCDay(); return w >= 1 && w <= 5; }

export interface LeaveSpan { start: string; end: string; halfStart?: boolean; halfEnd?: boolean }

/**
 * Jours d'absence par date : jours ouvrés (lun-ven) hors jours fériés fournis (calendrier PARAMÉTRÉ, jamais présumé).
 * Un demi-jour de début/fin ne compte que si ce jour est ouvré. Résultat : [{date, quantity}] avec quantity 0.5 ou 1.
 */
export function leaveDays(span: LeaveSpan, holidays: ReadonlySet<string> = new Set()): { date: string; quantity: string }[] {
  if (!ISO.test(span.start) || !ISO.test(span.end)) throw new Error("Dates invalides");
  if (span.end < span.start) throw new Error("La fin précède le début");
  if (span.start === span.end && span.halfStart && span.halfEnd) throw new Error("Un seul demi-jour possible sur une journée unique");
  const out: { date: string; quantity: string }[] = [];
  for (let d = span.start, n = 0; d <= span.end; d = addDay(d), n++) {
    if (n > 400) throw new Error("Période trop longue");
    if (!isWeekday(d) || holidays.has(d)) continue;
    const half = (d === span.start && span.halfStart) || (d === span.end && span.halfEnd);
    out.push({ date: d, quantity: half ? "0.5" : "1" });
  }
  return out;
}
export const totalDays = (days: { quantity: string }[]) => days.reduce((s, d) => s.plus(d.quantity), new Decimal(0));

/** Solde = ajustements (saisis et audités) − congés payés approuvés. */
export function leaveBalance(adjustments: string[], approvedPaidDays: string[]): string {
  const a = adjustments.reduce((s, x) => s.plus(x), new Decimal(0));
  const u = approvedPaidDays.reduce((s, x) => s.plus(x), new Decimal(0));
  return a.minus(u).toFixed(1);
}

export const LEAVE_STATES = ["submitted", "approved", "rejected", "cancelled"] as const;
export type LeaveState = (typeof LEAVE_STATES)[number];
export interface LeaveCtx { ownerUserId: string; actorUserId: string; rejectReason?: string; startsInFuture: boolean; balanceAfter?: string; consumes: boolean }
const DECIDERS = ["tenant_admin", "hr", "operations"];
export const leaveWorkflow = new StateMachine<LeaveState, LeaveCtx>([
  { from: "submitted", to: "approved", event: "approve", allowedRoles: DECIDERS,
    guard: c => c.ownerUserId === c.actorUserId ? "on ne peut pas approuver sa propre absence" : c.consumes && c.balanceAfter !== undefined && new Decimal(c.balanceAfter).lt(0) ? "solde de congés insuffisant" : null },
  { from: "submitted", to: "rejected", event: "reject", allowedRoles: DECIDERS, guard: c => (c.rejectReason && c.rejectReason.trim().length >= 3 ? null : "motif de refus obligatoire") },
  { from: "submitted", to: "cancelled", event: "cancel", allowedRoles: ["consultant", ...DECIDERS] },
  { from: "approved", to: "cancelled", event: "cancel", allowedRoles: ["consultant", "hr", "tenant_admin"], guard: c => (c.startsInFuture ? null : "période déjà commencée : annulation impossible") },
]);
