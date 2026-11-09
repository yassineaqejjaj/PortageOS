-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "agreementId" TEXT,
ADD COLUMN     "agreementRateId" TEXT;

-- AlterTable
ALTER TABLE "Prospect" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "importJobId" TEXT;

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "startDate" DATE,
    "endDate" DATE,
    "budget" DECIMAL(12,2),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Interaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "prospectId" TEXT,
    "title" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "assigneeUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "doneAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referrer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "consultantId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referrer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "ruleValue" DECIMAL(12,2) NOT NULL,
    "durationMonths" INTEGER NOT NULL DEFAULT 0,
    "convertedAt" TIMESTAMP(3),
    "consultantId" TEXT,
    "companyId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commission" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'accrued',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paidReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FrameworkAgreement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "paymentTermsDays" INTEGER,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FrameworkAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FrameworkRate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "maxDailyRate" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "FrameworkRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'previewed',
    "fileName" TEXT,
    "campaignId" TEXT,
    "defaultKind" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "rowsTotal" INTEGER NOT NULL,
    "rowsValid" INTEGER NOT NULL,
    "rowsInvalid" INTEGER NOT NULL,
    "report" JSONB NOT NULL,
    "validRows" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),
    "rolledBackAt" TIMESTAMP(3),

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Simulation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "prospectId" TEXT,
    "inputs" JSONB NOT NULL,
    "results" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Simulation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoringConfig" (
    "tenantId" TEXT NOT NULL,
    "weights" JSONB NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoringConfig_pkey" PRIMARY KEY ("tenantId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_tenantId_name_key" ON "Campaign"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Interaction_prospectId_occurredAt_idx" ON "Interaction"("prospectId", "occurredAt");

-- CreateIndex
CREATE INDEX "CrmTask_tenantId_assigneeUserId_status_idx" ON "CrmTask"("tenantId", "assigneeUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Referrer_tenantId_name_key" ON "Referrer"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_prospectId_key" ON "Referral"("prospectId");

-- CreateIndex
CREATE INDEX "Commission_tenantId_status_idx" ON "Commission"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Commission_referralId_sourceType_sourceId_key" ON "Commission"("referralId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "FrameworkAgreement_tenantId_companyId_idx" ON "FrameworkAgreement"("tenantId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "FrameworkRate_agreementId_label_key" ON "FrameworkRate"("agreementId", "label");

-- CreateIndex
CREATE INDEX "ImportJob_tenantId_createdAt_idx" ON "ImportJob"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "Referrer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrameworkRate" ADD CONSTRAINT "FrameworkRate_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "FrameworkAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE ON "Campaign", "CrmTask", "Referrer", "Referral", "Commission", "FrameworkAgreement", "ImportJob", "ScoringConfig" TO portage_app;
GRANT SELECT, INSERT ON "Interaction", "FrameworkRate", "Simulation" TO portage_app;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['Campaign','Interaction','CrmTask','Referrer','Referral','Commission','FrameworkAgreement','FrameworkRate','ImportJob','Simulation','ScoringConfig'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))', t || '_tenant', t);
  END LOOP;
END $$;
ALTER TABLE "Campaign" ADD CONSTRAINT campaign_chk CHECK (status IN ('draft','active','ended') AND kind IN ('consultants','companies') AND channel IN ('email','phone','event','other') AND (budget IS NULL OR budget >= 0));
ALTER TABLE "Interaction" ADD CONSTRAINT interaction_type_chk CHECK (type IN ('call','email','meeting','note'));
ALTER TABLE "CrmTask" ADD CONSTRAINT crmtask_status_chk CHECK (status IN ('open','done','cancelled'));
ALTER TABLE "Referrer" ADD CONSTRAINT referrer_chk CHECK (kind IN ('introducer','sponsor') AND status IN ('active','suspended'));
ALTER TABLE "Referral" ADD CONSTRAINT referral_rule_chk CHECK ("ruleType" IN ('percent_of_collected_net','fixed_per_conversion') AND "ruleValue" >= 0 AND ("ruleType" <> 'percent_of_collected_net' OR "ruleValue" <= 100) AND "durationMonths" BETWEEN 0 AND 60);
ALTER TABLE "Commission" ADD CONSTRAINT commission_chk CHECK (status IN ('accrued','approved','paid','cancelled') AND amount >= 0);
ALTER TABLE "FrameworkAgreement" ADD CONSTRAINT agreement_chk CHECK ("endDate" >= "startDate" AND status IN ('draft','active','terminated'));
ALTER TABLE "FrameworkRate" ADD CONSTRAINT frameworkrate_chk CHECK ("maxDailyRate" > 0);
ALTER TABLE "ImportJob" ADD CONSTRAINT importjob_chk CHECK (status IN ('previewed','committed','cancelled','rolled_back'));
CREATE TRIGGER interaction_append_only BEFORE UPDATE OR DELETE ON "Interaction" FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER simulation_append_only BEFORE UPDATE OR DELETE ON "Simulation" FOR EACH ROW EXECUTE FUNCTION append_only();
-- La règle de commission d'un parrainage est figée : seuls les liens de conversion évoluent
CREATE OR REPLACE FUNCTION referral_rule_frozen() RETURNS trigger AS $$
BEGIN
  IF NEW."ruleType" <> OLD."ruleType" OR NEW."ruleValue" <> OLD."ruleValue" OR NEW."durationMonths" <> OLD."durationMonths" OR NEW."referrerId" <> OLD."referrerId" OR NEW."prospectId" <> OLD."prospectId" OR NEW."createdBy" <> OLD."createdBy" THEN
    RAISE EXCEPTION 'La règle de commission d''un parrainage est figée'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER referral_rule_frozen BEFORE UPDATE ON "Referral" FOR EACH ROW EXECUTE FUNCTION referral_rule_frozen();
-- Le montant d'une commission ne change jamais après création
CREATE OR REPLACE FUNCTION commission_amount_frozen() RETURNS trigger AS $$
BEGIN IF NEW.amount <> OLD.amount OR NEW."referralId" <> OLD."referralId" OR NEW."sourceId" <> OLD."sourceId" THEN RAISE EXCEPTION 'Le montant et l''origine d''une commission sont figés'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER commission_amount_frozen BEFORE UPDATE ON "Commission" FOR EACH ROW EXECUTE FUNCTION commission_amount_frozen();
