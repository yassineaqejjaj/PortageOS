export interface Transition<S extends string, C> {
  from: S; to: S; event: string;
  allowedRoles: string[];
  guard?: (ctx: C) => string | null; // retourne un motif de refus ou null
}
export interface AuditRecord { at: string; actor: string; role: string; event: string; from: string; to: string }

export class StateMachine<S extends string, C = unknown> {
  constructor(private transitions: Transition<S, C>[]) {}

  apply(state: S, event: string, actor: { id: string; role: string }, ctx: C, now = new Date().toISOString()) {
    const t = this.transitions.find(x => x.from === state && x.event === event);
    if (!t) throw new Error(`Transition interdite: ${state} --${event}-->`);
    if (!t.allowedRoles.includes(actor.role)) throw new Error(`Rôle ${actor.role} non autorisé pour ${event}`);
    const refusal = t.guard?.(ctx);
    if (refusal) throw new Error(`Précondition non remplie: ${refusal}`);
    const audit: AuditRecord = { at: now, actor: actor.id, role: actor.role, event, from: state, to: t.to };
    return { state: t.to, audit };
  }
}
