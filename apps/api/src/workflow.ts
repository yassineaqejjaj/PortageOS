import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { StateMachine } from "@portage/domain";

/**
 * Applique un événement avec le premier rôle de l'utilisateur que la machine d'état autorise.
 * Les refus de précondition ou de transition remontent en 400, l'absence de rôle autorisé en 403.
 */
export function applyAsAnyRole<S extends string, C>(m: StateMachine<S, C>, state: S, event: string, userId: string, roles: string[], ctx: C): S {
  let lastDenied = false;
  for (const role of roles) {
    try { return m.apply(state, event, { id: userId, role }, ctx).state; }
    catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("non autorisé")) { lastDenied = true; continue; }
      throw new BadRequestException(msg);
    }
  }
  if (lastDenied || roles.length === 0) throw new ForbiddenException("Rôle non autorisé pour cette action");
  throw new BadRequestException("Action impossible");
}

export function parseZod<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } }, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestException(r.error.issues.map(i => i.message).join("; "));
  return r.data;
}

export const parisToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
