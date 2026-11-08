export const ROLES = ["tenant_admin","direction","commerce","operations","hr","payroll","finance","compliance","consultant","client_user","external_accountant","referrer"] as const;
export type Role = (typeof ROLES)[number];
export type Permission = "company.read" | "company.write" | "audit.read" | "member.manage" | "prospect.read" | "prospect.write";

/** RBAC de base (Lot 0). À affiner par module; ABAC (objets) viendra avec les portails. */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  tenant_admin: ["company.read","company.write","audit.read","member.manage","prospect.read","prospect.write"],
  direction: ["company.read","audit.read","prospect.read"],
  commerce: ["company.read","company.write","prospect.read","prospect.write"],
  operations: ["company.read"],
  hr: [],
  payroll: [],
  finance: ["company.read"],
  compliance: ["company.read","audit.read"],
  consultant: [],
  client_user: [],
  external_accountant: [],
  referrer: [],
};
export function can(roles: string[], p: Permission): boolean {
  return roles.some(r => (ROLE_PERMISSIONS as Record<string, Permission[]>)[r]?.includes(p));
}
