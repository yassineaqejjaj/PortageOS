-- CreateTable
CREATE TABLE "BankImport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fileName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'previewed',
    "rowsTotal" INTEGER NOT NULL,
    "rowsValid" INTEGER NOT NULL,
    "rowsInvalid" INTEGER NOT NULL,
    "report" JSONB NOT NULL,
    "rows" JSONB NOT NULL,
    "mapping" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "BankImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "label" TEXT NOT NULL,
    "reference" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unmatched',
    "paymentId" TEXT,
    "note" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankTransaction_tenantId_status_idx" ON "BankTransaction"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_tenantId_fingerprint_key" ON "BankTransaction"("tenantId", "fingerprint");

GRANT SELECT, INSERT, UPDATE ON "BankImport", "BankTransaction" TO portage_app;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['BankImport','BankTransaction'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))', t || '_tenant', t);
  END LOOP;
END $$;
ALTER TABLE "BankImport" ADD CONSTRAINT bankimport_chk CHECK (status IN ('previewed','committed','cancelled'));
ALTER TABLE "BankTransaction" ADD CONSTRAINT banktx_chk CHECK (status IN ('unmatched','matched','ignored') AND amount <> 0 AND (status <> 'matched' OR "paymentId" IS NOT NULL));
-- Le mouvement bancaire est figé : seules la décision (statut, paiement, note) peut évoluer, une seule fois.
CREATE OR REPLACE FUNCTION banktx_freeze() RETURNS trigger AS $$ BEGIN
  IF NEW.date <> OLD.date OR NEW.label <> OLD.label OR NEW.amount <> OLD.amount OR NEW.fingerprint <> OLD.fingerprint OR NEW."importId" <> OLD."importId" THEN RAISE EXCEPTION 'Mouvement bancaire figé'; END IF;
  IF OLD.status <> 'unmatched' AND NEW.status <> OLD.status THEN RAISE EXCEPTION 'Mouvement bancaire déjà décidé'; END IF;
  RETURN NEW; END $$ LANGUAGE plpgsql;
CREATE TRIGGER banktx_freeze BEFORE UPDATE ON "BankTransaction" FOR EACH ROW EXECUTE FUNCTION banktx_freeze();
