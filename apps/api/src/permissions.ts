export const ROLES = ["tenant_admin","direction","commerce","operations","hr","payroll","finance","compliance","consultant","client_user","external_accountant","referrer"] as const;
export type Role = (typeof ROLES)[number];
export type Permission =
  | "company.read" | "company.write" | "audit.read" | "member.manage" | "prospect.read" | "prospect.write"
  | "consultant.read" | "consultant.write" | "mission.read" | "mission.write" | "timesheet.read" | "timesheet.write"
  | "invoice.read" | "invoice.write" | "invoice.issue" | "payment.write" | "ledger.read" | "portal.client" | "portal.self"
  | "rules.read" | "rules.write" | "rules.approve" | "expense.read" | "expense.write" | "expense.reimburse" | "contract.read" | "contract.write" | "contract.sign" | "account.read" | "leave.read" | "leave.write" | "leave.adjust" | "agent.read" | "agent.run" | "agent.approve" | "agent.admin" | "support.manage";

const ALL: Permission[] = ["company.read","company.write","audit.read","member.manage","prospect.read","prospect.write","consultant.read","consultant.write","mission.read","mission.write","timesheet.read","timesheet.write","invoice.read","invoice.write","invoice.issue","payment.write","ledger.read","rules.read","rules.write","rules.approve","expense.read","expense.write","expense.reimburse","contract.read","contract.write","contract.sign","account.read","leave.read","leave.write","leave.adjust","agent.read","agent.run","agent.approve","agent.admin","support.manage"];

/** RBAC de base. Les portails (client_user, consultant) ajoutent un contrôle d'objet (entreprise / dossier) dans les contrôleurs. */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  tenant_admin: ALL,
  direction: ["company.read","audit.read","prospect.read","consultant.read","mission.read","timesheet.read","invoice.read","ledger.read","rules.read","expense.read","contract.read","account.read","leave.read","agent.read"],
  commerce: ["company.read","company.write","prospect.read","prospect.write"],
  operations: ["company.read","consultant.read","consultant.write","mission.read","mission.write","timesheet.read","timesheet.write","invoice.read","expense.read","expense.write","leave.read","leave.write","agent.read","agent.run","agent.approve","support.manage"],
  hr: ["consultant.read","consultant.write","contract.read","contract.write","contract.sign","leave.read","leave.write","leave.adjust","agent.read","agent.run","support.manage"],
  payroll: ["rules.read"],
  finance: ["company.read","consultant.read","mission.read","timesheet.read","invoice.read","invoice.write","invoice.issue","payment.write","ledger.read","rules.read","expense.read","expense.reimburse","account.read","agent.read","agent.run","agent.approve","support.manage"],
  compliance: ["company.read","audit.read","consultant.read","rules.read","rules.write","rules.approve","contract.read"],
  consultant: ["portal.self"],
  client_user: ["portal.client"],
  external_accountant: [],
  referrer: [],
};
export function can(roles: string[], p: Permission): boolean {
  return roles.some(r => (ROLE_PERMISSIONS as Record<string, Permission[]>)[r]?.includes(p));
}

/** Rôles qui possèdent une permission (pour router les notifications). */
export function rolesWith(p: Permission): Role[] { return (Object.keys(ROLE_PERMISSIONS) as Role[]).filter(r => ROLE_PERMISSIONS[r].includes(p)); }
