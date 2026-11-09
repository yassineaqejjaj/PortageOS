-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "reason" TEXT;

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClosingPeriod" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'closed',
    "closedBy" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reopenedBy" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenReason" TEXT,

    CONSTRAINT "ClosingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_tenantId_code_key" ON "Account"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ClosingPeriod_tenantId_period_key" ON "ClosingPeriod"("tenantId", "period");

GRANT SELECT, INSERT, UPDATE ON "Account", "ClosingPeriod" TO portage_app;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['Account','ClosingPeriod'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))', t || '_tenant', t);
  END LOOP;
END $$;
ALTER TABLE "Account" ADD CONSTRAINT account_code_chk CHECK (code ~ '^[1-9][0-9]{2,7}$');
ALTER TABLE "Account" ADD CONSTRAINT account_type_chk CHECK (type IN ('asset','liability','equity','revenue','expense'));
ALTER TABLE "ClosingPeriod" ADD CONSTRAINT closing_period_chk CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND status IN ('closed','open'));

-- Aucune écriture dans une période close, même en insertion directe
CREATE OR REPLACE FUNCTION journal_period_open() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ClosingPeriod" c WHERE c."tenantId" = NEW."tenantId" AND c.period = to_char(NEW."valueDate", 'YYYY-MM') AND c.status = 'closed') THEN
    RAISE EXCEPTION 'Période % close : aucune écriture possible', to_char(NEW."valueDate", 'YYYY-MM');
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER journalentry_period_open BEFORE INSERT ON "JournalEntry" FOR EACH ROW EXECUTE FUNCTION journal_period_open();
