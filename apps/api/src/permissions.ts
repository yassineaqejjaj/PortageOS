export const ROLES = ["tenant_admin","direction","commerce","operations","hr","payroll","finance","compliance","consultant","client_user","external_accountant","referrer"] as const;
export type Role = (typeof ROLES)[number];
export type Permission =
  | "company.read" | "company.write" | "audit.read" | "member.manage" | "prospect.read" | "prospect.write"
  | "consultant.read" | "consultant.write" | "mission.read" | "mission.write" | "timesheet.read" | "timesheet.write"
  | "invoice.read" | "invoice.write" | "invoice.issue" | "payment.write" | "ledger.read" | "portal.client" | "portal.self";

const ALL: Permission[] = ["company.read","company.write","audit.read","member.manage","prospect.read","prospect.write","consultant.read","consultant.write","mission.read","mission.write","timesheet.read","timesheet.write","invoice.read","invoice.write","invoice.issue","payment.write","ledger.read"];

/** RBAC de base. Les portails (client_user, consultant) ajoutent un contrôle d'objet (entreprise / dossier) dans les contrôleurs. */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  tenant_admin: ALL,
  direction: ["company.read","audit.read","prospect.read","consultant.read","mission.read","timesheet.read","invoice.read","ledger.read"],
  commerce: ["company.read","company.write","prospect.read","prospect.write"],
  operations: ["company.read","consultant.read","consultant.write","mission.read","mission.write","timesheet.read","timesheet.write","invoice.read"],
  hr: ["consultant.read","consultant.write"],
  payroll: [],
  finance: ["company.read","consultant.read","mission.read","timesheet.read","invoice.read","invoice.write","invoice.issue","payment.write","ledger.read"],
  compliance: ["company.read","audit.read","consultant.read"],
  consultant: ["portal.self"],
  client_user: ["portal.client"],
  external_accountant: [],
  referrer: [],
};
export function can(roles: string[], p: Permission): boolean {
  return roles.some(r => (ROLE_PERMISSIONS as Record<string, Permission[]>)[r]?.includes(p));
}
