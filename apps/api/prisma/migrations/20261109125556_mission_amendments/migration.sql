-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "budgetAmount" DECIMAL(14,2);

-- CreateTable
CREATE TABLE "MissionAmendment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "effective" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MissionAmendment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MissionAmendment_tenantId_missionId_idx" ON "MissionAmendment"("tenantId", "missionId");

-- AddForeignKey
ALTER TABLE "MissionAmendment" ADD CONSTRAINT "MissionAmendment_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT ON "MissionAmendment" TO portage_app;
ALTER TABLE "MissionAmendment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "MissionAmendment_tenant" ON "MissionAmendment" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE TRIGGER missionamendment_append_only BEFORE UPDATE OR DELETE ON "MissionAmendment" FOR EACH ROW EXECUTE FUNCTION append_only();
ALTER TABLE "MissionAmendment" ADD CONSTRAINT missionamendment_kind_chk CHECK (kind IN ('rate','extend','early_end','budget') AND length(reason) >= 3);
ALTER TABLE "Mission" ADD CONSTRAINT mission_budget_chk CHECK ("budgetAmount" IS NULL OR "budgetAmount" > 0);
