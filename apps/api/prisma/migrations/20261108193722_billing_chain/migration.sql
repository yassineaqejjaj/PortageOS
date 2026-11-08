-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "consultantId" TEXT;

-- CreateTable
CREATE TABLE "Consultant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'onboarding',
    "sourceProspectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Consultant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "consultantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "doneAt" TIMESTAMP(3),
    "doneBy" TEXT,

    CONSTRAINT "OnboardingTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mission" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "consultantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dailyRate" DECIMAL(12,2) NOT NULL,
    "vatRate" DECIMAL(5,2) NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Timesheet" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "rejectReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Timesheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimesheetLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "quantity" DECIMAL(3,1) NOT NULL,

    CONSTRAINT "TimesheetLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceSequence" (
    "tenantId" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceSequence_pkey" PRIMARY KEY ("tenantId","series","year")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT,
    "series" TEXT NOT NULL DEFAULT 'FA',
    "companyId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "issueDate" DATE,
    "days" DECIMAL(6,1) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "vatRate" DECIMAL(5,2) NOT NULL,
    "net" DECIMAL(14,2) NOT NULL,
    "vat" DECIMAL(14,2) NOT NULL,
    "gross" DECIMAL(14,2) NOT NULL,
    "paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "einvoiceStatus" TEXT NOT NULL DEFAULT 'not_connected',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "receivedOn" DATE NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "consultantId" TEXT,
    "valueDate" DATE NOT NULL,
    "label" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "reversalOf" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Consultant_sourceProspectId_key" ON "Consultant"("sourceProspectId");

-- CreateIndex
CREATE INDEX "Consultant_tenantId_status_idx" ON "Consultant"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingTask_consultantId_key_key" ON "OnboardingTask"("consultantId", "key");

-- CreateIndex
CREATE INDEX "Mission_tenantId_status_idx" ON "Mission"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Timesheet_tenantId_status_idx" ON "Timesheet"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Timesheet_missionId_period_key" ON "Timesheet"("missionId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "TimesheetLine_timesheetId_date_key" ON "TimesheetLine"("timesheetId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_timesheetId_key" ON "Invoice"("timesheetId");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_status_idx" ON "Invoice"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantId_number_key" ON "Invoice"("tenantId", "number");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_reversalOf_key" ON "JournalEntry"("reversalOf");

-- CreateIndex
CREATE INDEX "JournalEntry_tenantId_sourceType_sourceId_idx" ON "JournalEntry"("tenantId", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_tenantId_key_key" ON "JournalEntry"("tenantId", "key");

-- CreateIndex
CREATE INDEX "JournalLine_entryId_idx" ON "JournalLine"("entryId");

-- AddForeignKey
ALTER TABLE "Consultant" ADD CONSTRAINT "Consultant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingTask" ADD CONSTRAINT "OnboardingTask_consultantId_fkey" FOREIGN KEY ("consultantId") REFERENCES "Consultant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_consultantId_fkey" FOREIGN KEY ("consultantId") REFERENCES "Consultant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetLine" ADD CONSTRAINT "TimesheetLine_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "Timesheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "Timesheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== Sécurité : droits, RLS, contraintes, append-only =====
GRANT SELECT, INSERT, UPDATE ON "Consultant", "Mission", "Timesheet", "Invoice", "InvoiceSequence" TO portage_app;
GRANT SELECT, INSERT, UPDATE ON "OnboardingTask" TO portage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "TimesheetLine" TO portage_app;
GRANT SELECT, INSERT ON "Payment", "JournalEntry", "JournalLine" TO portage_app;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['Consultant','OnboardingTask','Mission','Timesheet','TimesheetLine','InvoiceSequence','Invoice','Payment','JournalEntry','JournalLine'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))', t || '_tenant', t);
  END LOOP;
END $$;

ALTER TABLE "TimesheetLine" ADD CONSTRAINT timesheetline_quantity_chk CHECK (quantity IN (0.5, 1.0));
ALTER TABLE "Mission" ADD CONSTRAINT mission_amounts_chk CHECK ("dailyRate" > 0 AND "vatRate" >= 0 AND "vatRate" <= 100);
ALTER TABLE "Invoice" ADD CONSTRAINT invoice_amounts_chk CHECK (net >= 0 AND vat >= 0 AND gross = net + vat AND paid >= 0 AND paid <= gross);
ALTER TABLE "Payment" ADD CONSTRAINT payment_amount_chk CHECK (amount > 0);
ALTER TABLE "JournalLine" ADD CONSTRAINT journalline_amounts_chk CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0));
ALTER TABLE "Timesheet" ADD CONSTRAINT timesheet_period_chk CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

-- Journal et paiements append-only
CREATE OR REPLACE FUNCTION append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION '% est append-only', TG_TABLE_NAME; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER journalentry_append_only BEFORE UPDATE OR DELETE ON "JournalEntry" FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER journalline_append_only BEFORE UPDATE OR DELETE ON "JournalLine" FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER payment_append_only BEFORE UPDATE OR DELETE ON "Payment" FOR EACH ROW EXECUTE FUNCTION append_only();

-- Équilibre débit = crédit, vérifié en fin de transaction pour chaque écriture
CREATE OR REPLACE FUNCTION journal_balanced() RETURNS trigger AS $$
DECLARE d numeric; c numeric;
BEGIN
  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) INTO d, c FROM "JournalLine" WHERE "entryId" = NEW."entryId";
  IF d <> c THEN RAISE EXCEPTION 'Écriture % déséquilibrée: débit % <> crédit %', NEW."entryId", d, c; END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER journalline_balanced AFTER INSERT ON "JournalLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_balanced();
