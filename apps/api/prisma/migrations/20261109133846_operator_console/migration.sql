-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "isPlatform" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxMembers" INTEGER,
ADD COLUMN     "plan" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedReason" TEXT;

-- Console opérateur : au plus un tenant plateforme, statut contrôlé, aucune écriture applicative de isPlatform.
CREATE UNIQUE INDEX "Tenant_one_platform" ON "Tenant" ("isPlatform") WHERE "isPlatform";
ALTER TABLE "Tenant" ADD CONSTRAINT tenant_status_chk CHECK (status IN ('active','suspended') AND ("maxMembers" IS NULL OR "maxMembers" >= 1) AND NOT ("isPlatform" AND status <> 'active'));
CREATE OR REPLACE FUNCTION tenant_platform_flag_immutable() RETURNS trigger AS $$ BEGIN
  IF NEW."isPlatform" IS DISTINCT FROM OLD."isPlatform" THEN RAISE EXCEPTION 'isPlatform est immuable'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER tenant_platform_flag_immutable BEFORE UPDATE ON "Tenant" FOR EACH ROW EXECUTE FUNCTION tenant_platform_flag_immutable();
-- Droits au niveau colonne : le rôle applicatif ne peut ni créer ni modifier isPlatform.
REVOKE UPDATE ON "Tenant" FROM portage_app;
GRANT UPDATE (name, "mfaRequired", status, "suspendedAt", "suspendedReason", plan, "maxMembers") ON "Tenant" TO portage_app;
GRANT INSERT (id, slug, name, "createdAt", "mfaRequired", status, plan, "maxMembers") ON "Tenant" TO portage_app;
