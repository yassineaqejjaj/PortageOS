import { Injectable } from "@nestjs/common";
import { Tx } from "./prisma.service";

/** Catalogue des types de notification (libellés affichés dans les préférences). Canal e-mail : NON connecté. */
export const NOTIFICATION_TYPES: Record<string, string> = {
  "timesheet.submitted": "CRA à valider (client)",
  "timesheet.client_approved": "CRA approuvé par le client (validation interne)",
  "timesheet.client_rejected": "CRA refusé par le client",
  "timesheet.validated": "CRA validé",
  "expense.submitted": "Note de frais à approuver",
  "expense.decided": "Décision sur ma note de frais",
  "leave.submitted": "Demande d'absence à traiter",
  "leave.decided": "Décision sur ma demande d'absence",
  "support.ticket_created": "Nouvelle demande de support",
  "support.reply": "Réponse à une demande de support",
  "crm.task_assigned": "Tâche commerciale qui m'est assignée",
};

export interface Notice { type: string; title: string; body?: string; link?: string }

@Injectable()
export class NotificationsService {
  async usersByRoles(tx: Tx, tenantId: string, roles: string[]): Promise<string[]> {
    return (await tx.membership.findMany({ where: { tenantId, roles: { hasSome: roles } }, select: { userId: true } })).map(m => m.userId);
  }
  async clientUsers(tx: Tx, tenantId: string, companyId: string): Promise<string[]> {
    return (await tx.membership.findMany({ where: { tenantId, companyId, roles: { has: "client_user" } }, select: { userId: true } })).map(m => m.userId);
  }
  async consultantUsers(tx: Tx, tenantId: string, consultantId: string): Promise<string[]> {
    return (await tx.membership.findMany({ where: { tenantId, consultantId }, select: { userId: true } })).map(m => m.userId);
  }

  /** Crée une notification par destinataire (hors acteur), en respectant les préférences (désactivation par type). */
  async notify(tx: Tx, tenantId: string, userIds: string[], n: Notice, exceptUserId?: string) {
    if (!NOTIFICATION_TYPES[n.type]) throw new Error(`Type de notification inconnu : ${n.type}`);
    const ids = [...new Set(userIds)].filter(u => u !== exceptUserId);
    if (!ids.length) return 0;
    const muted = new Set((await tx.notificationPreference.findMany({ where: { tenantId, type: n.type, enabled: false, userId: { in: ids } }, select: { userId: true } })).map(p => p.userId));
    const targets = ids.filter(u => !muted.has(u));
    if (targets.length) await tx.notification.createMany({ data: targets.map(userId => ({ tenantId, userId, type: n.type, title: n.title, body: n.body, link: n.link })) });
    return targets.length;
  }
}
