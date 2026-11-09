-- AlterTable
ALTER TABLE "Invoice" ALTER COLUMN "days" SET DATA TYPE DECIMAL(8,2);

-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "annualDaysCap" INTEGER,
ADD COLUMN     "timeUnit" TEXT NOT NULL DEFAULT 'day';

-- AlterTable
ALTER TABLE "TimesheetLine" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(5,2);

-- CreateTable
CREATE TABLE "TimesheetReminder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimesheetReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimesheetReminder_tenantId_period_idx" ON "TimesheetReminder"("tenantId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "TimesheetReminder_missionId_period_day_key" ON "TimesheetReminder"("missionId", "period", "day");

-- Droits, RLS, contraintes
GRANT SELECT, INSERT ON "TimesheetReminder" TO portage_app;
ALTER TABLE "TimesheetReminder" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "TimesheetReminder_tenant" ON "TimesheetReminder" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "Mission" ADD CONSTRAINT mission_timeunit_chk CHECK ("timeUnit" IN ('day','hour','forfait_jours') AND ("annualDaysCap" IS NULL OR ("timeUnit" = 'forfait_jours' AND "annualDaysCap" BETWEEN 1 AND 366)));
-- Quantité : jour/forfait = 0,5 ou 1 ; heures = multiples de 0,25 jusqu'à 24 h (borne physique, pas une règle légale). Le détail par unité est vérifié par l'API.
ALTER TABLE "TimesheetLine" DROP CONSTRAINT timesheetline_quantity_chk;
ALTER TABLE "TimesheetLine" ADD CONSTRAINT timesheetline_quantity_chk CHECK (quantity > 0 AND quantity <= 24 AND quantity * 4 = trunc(quantity * 4));
