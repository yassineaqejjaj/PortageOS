/** Miroir d'affichage de apps/api/src/permissions.ts (à générer depuis @portage/contracts ultérieurement). */
export type Permission = "company.read" | "company.write" | "audit.read" | "member.manage" | "prospect.read" | "prospect.write";
const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  tenant_admin: ["company.read", "company.write", "audit.read", "member.manage", "prospect.read", "prospect.write"],
  direction: ["company.read", "audit.read", "prospect.read"],
  commerce: ["company.read", "company.write", "prospect.read", "prospect.write"],
  operations: ["company.read"],
  finance: ["company.read"],
  compliance: ["company.read", "audit.read"],
};
export const can = (roles: string[], p: Permission) => roles.some(r => ROLE_PERMISSIONS[r]?.includes(p));
