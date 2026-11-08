-- CreateTable
CREATE TABLE "RuleParameter" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "source" TEXT NOT NULL,
    "justification" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleParameter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseClaim" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "consultantId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "rejectReason" TEXT,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "reimbursedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "km" DECIMAL(8,1),
    "receiptRef" TEXT,
    "rebillable" BOOLEAN NOT NULL DEFAULT false,
    "policyFlag" TEXT,
    "fingerprint" TEXT NOT NULL,

    CONSTRAINT "ExpenseLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "issueDate" DATE NOT NULL,
    "net" DECIMAL(14,2) NOT NULL,
    "vat" DECIMAL(14,2) NOT NULL,
    "gross" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "variables" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "consultantId" TEXT,
    "companyId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "renderedBody" TEXT NOT NULL,
    "variableValues" JSONB NOT NULL,
    "sentAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "signatureProvider" TEXT NOT NULL DEFAULT 'none',
    "signatureEvidence" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RuleParameter_tenantId_key_status_idx" ON "RuleParameter"("tenantId", "key", "status");

-- CreateIndex
CREATE INDEX "ExpenseClaim_tenantId_status_idx" ON "ExpenseClaim"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ExpenseLine_tenantId_fingerprint_idx" ON "ExpenseLine"("tenantId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_invoiceId_key" ON "CreditNote"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_tenantId_number_key" ON "CreditNote"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ContractTemplate_tenantId_name_version_key" ON "ContractTemplate"("tenantId", "name", "version");

-- CreateIndex
CREATE INDEX "Contract_tenantId_status_idx" ON "Contract"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "ExpenseLine" ADD CONSTRAINT "ExpenseLine_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ExpenseClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ContractTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== Droits, RLS, contraintes, immutabilité =====
GRANT SELECT, INSERT, UPDATE ON "RuleParameter", "ExpenseClaim", "ContractTemplate", "Contract" TO portage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "ExpenseLine" TO portage_app;
GRANT SELECT, INSERT ON "CreditNote" TO portage_app;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['RuleParameter','ExpenseClaim','ExpenseLine','CreditNote','ContractTemplate','Contract'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))', t || '_tenant', t);
  END LOOP;
END $$;

ALTER TABLE "ExpenseLine" ADD CONSTRAINT expenseline_amount_chk CHECK (amount > 0);
ALTER TABLE "ExpenseLine" ADD CONSTRAINT expenseline_category_chk CHECK (category IN ('meal','transport','hotel','mileage','other'));
ALTER TABLE "RuleParameter" ADD CONSTRAINT ruleparameter_period_chk CHECK ("validTo" IS NULL OR "validTo" >= "validFrom");
ALTER TABLE "RuleParameter" ADD CONSTRAINT ruleparameter_status_chk CHECK (status IN ('draft','approved'));
ALTER TABLE "RuleParameter" ADD CONSTRAINT ruleparameter_four_eyes_chk CHECK (status = 'draft' OR ("approvedBy" IS NOT NULL AND "approvedBy" <> "createdBy"));
ALTER TABLE "CreditNote" ADD CONSTRAINT creditnote_amounts_chk CHECK (gross = net + vat AND net >= 0);

-- Une version approuvée est immuable (ni modification ni suppression)
CREATE OR REPLACE FUNCTION approved_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status IN ('approved','published','signed') THEN RAISE EXCEPTION '% % est immuable', TG_TABLE_NAME, OLD.status; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('approved','published','signed') AND TG_TABLE_NAME <> 'Contract' THEN RAISE EXCEPTION '% % est immuable', TG_TABLE_NAME, OLD.status; END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'Contract' AND OLD.status = 'signed' THEN RAISE EXCEPTION 'Contract signé est immuable'; END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER ruleparameter_immutable BEFORE UPDATE OR DELETE ON "RuleParameter" FOR EACH ROW EXECUTE FUNCTION approved_immutable();
CREATE TRIGGER contracttemplate_immutable BEFORE UPDATE OR DELETE ON "ContractTemplate" FOR EACH ROW EXECUTE FUNCTION approved_immutable();
CREATE TRIGGER contract_immutable BEFORE UPDATE OR DELETE ON "Contract" FOR EACH ROW EXECUTE FUNCTION approved_immutable();
CREATE TRIGGER creditnote_append_only BEFORE UPDATE OR DELETE ON "CreditNote" FOR EACH ROW EXECUTE FUNCTION append_only();
