-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "paymentTermsDays" INTEGER;

-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "purchaseOrderId" TEXT;

-- CreateTable
CREATE TABLE "CompanyContact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "role" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanySite" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'FR',
    "archivedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanySite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyContact_tenantId_companyId_idx" ON "CompanyContact"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "CompanySite_tenantId_companyId_idx" ON "CompanySite"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_tenantId_companyId_idx" ON "PurchaseOrder"("tenantId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_tenantId_companyId_reference_key" ON "PurchaseOrder"("tenantId", "companyId", "reference");

-- Droits, RLS et contraintes (ajoutés à la main)
GRANT SELECT, INSERT, UPDATE ON "CompanyContact", "CompanySite", "PurchaseOrder" TO portage_app;
GRANT DELETE ON "CompanyContact" TO portage_app;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['CompanyContact','CompanySite','PurchaseOrder'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))', t || '_tenant', t);
  END LOOP;
END $$;
ALTER TABLE "Company" ADD CONSTRAINT company_terms_chk CHECK ("paymentTermsDays" IS NULL OR "paymentTermsDays" BETWEEN 0 AND 180);
ALTER TABLE "CompanyContact" ADD CONSTRAINT contact_role_chk CHECK (role IN ('billing','operations','signatory','other'));
CREATE UNIQUE INDEX contact_one_primary ON "CompanyContact" ("companyId", role) WHERE "isPrimary";
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT po_chk CHECK (amount > 0 AND "endDate" >= "startDate" AND status IN ('open','closed','cancelled'));
-- Le montant et la période d'un bon de commande sont figés une fois créé (seul le statut évolue).
CREATE OR REPLACE FUNCTION po_freeze() RETURNS trigger AS $$ BEGIN
  IF NEW.amount <> OLD.amount OR NEW."startDate" <> OLD."startDate" OR NEW."endDate" <> OLD."endDate" OR NEW.reference <> OLD.reference OR NEW."companyId" <> OLD."companyId" THEN RAISE EXCEPTION 'Bon de commande : référence, montant et période figés'; END IF;
  RETURN NEW; END $$ LANGUAGE plpgsql;
CREATE TRIGGER po_freeze BEFORE UPDATE ON "PurchaseOrder" FOR EACH ROW EXECUTE FUNCTION po_freeze();
