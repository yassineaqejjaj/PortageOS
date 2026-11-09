-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'extra',
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'jour',
    "quantity" DECIMAL(10,2) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "vatRate" DECIMAL(5,2) NOT NULL,
    "net" DECIMAL(14,2) NOT NULL,
    "vat" DECIMAL(14,2) NOT NULL,
    "gross" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantProfile" (
    "tenantId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "legalForm" TEXT,
    "siren" TEXT,
    "vatNumber" TEXT,
    "address" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "iban" TEXT,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantProfile_pkey" PRIMARY KEY ("tenantId")
);

-- CreateIndex
CREATE INDEX "InvoiceLine_tenantId_invoiceId_idx" ON "InvoiceLine"("tenantId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceLine_invoiceId_position_key" ON "InvoiceLine"("invoiceId", "position");

-- Reprise des factures existantes : une ligne « activité » reconstituée depuis les champs historiques (montants inchangés).
INSERT INTO "InvoiceLine" ("id","tenantId","invoiceId","position","kind","description","unit","quantity","unitPrice","vatRate","net","vat","gross")
SELECT gen_random_uuid()::text, i."tenantId", i."id", 1, 'activity', COALESCE((SELECT m."title" FROM "Mission" m WHERE m."id" = i."missionId"), 'Prestation'), 'jour', i."days", i."unitPrice", i."vatRate", i."net", i."vat", i."gross" FROM "Invoice" i;

GRANT SELECT, INSERT, UPDATE, DELETE ON "InvoiceLine" TO portage_app;
GRANT SELECT, INSERT, UPDATE ON "TenantProfile" TO portage_app;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['InvoiceLine','TenantProfile'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))', t || '_tenant', t);
  END LOOP;
END $$;
ALTER TABLE "InvoiceLine" ADD CONSTRAINT invoiceline_chk CHECK (kind IN ('activity','extra') AND quantity <> 0 AND "unitPrice" >= 0 AND "vatRate" BETWEEN 0 AND 100 AND position >= 1);
-- Les lignes ne changent plus dès que la facture n'est plus un brouillon (immuabilité des pièces émises).
CREATE OR REPLACE FUNCTION invoiceline_draft_only() RETURNS trigger AS $$
DECLARE st text; inv text;
BEGIN
  inv := COALESCE(NEW."invoiceId", OLD."invoiceId");
  SELECT status INTO st FROM "Invoice" WHERE id = inv;
  IF st IS NOT NULL AND st <> 'draft' THEN RAISE EXCEPTION 'Lignes figées : la facture n''est plus un brouillon'; END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
CREATE TRIGGER invoiceline_draft_only BEFORE INSERT OR UPDATE OR DELETE ON "InvoiceLine" FOR EACH ROW EXECUTE FUNCTION invoiceline_draft_only();
ALTER TABLE "TenantProfile" ADD CONSTRAINT tenantprofile_chk CHECK ((siren IS NULL OR siren ~ '^[0-9]{9}$') AND ("postalCode" IS NULL OR "postalCode" ~ '^[0-9]{5}$'));
