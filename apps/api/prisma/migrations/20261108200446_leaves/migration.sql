-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "consultantId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "halfStart" BOOLEAN NOT NULL DEFAULT false,
    "halfEnd" BOOLEAN NOT NULL DEFAULT false,
    "days" DECIMAL(4,1) NOT NULL,
    "holidaysConfigured" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "reason" TEXT,
    "rejectReason" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveAdjustment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "consultantId" TEXT NOT NULL,
    "days" DECIMAL(5,1) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaveRequest_tenantId_status_idx" ON "LeaveRequest"("tenantId", "status");

-- CreateIndex
CREATE INDEX "LeaveRequest_consultantId_startDate_idx" ON "LeaveRequest"("consultantId", "startDate");

-- CreateIndex
CREATE INDEX "LeaveAdjustment_consultantId_idx" ON "LeaveAdjustment"("consultantId");

GRANT SELECT, INSERT, UPDATE ON "LeaveRequest" TO portage_app;
GRANT SELECT, INSERT ON "LeaveAdjustment" TO portage_app;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['LeaveRequest','LeaveAdjustment'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))', t || '_tenant', t);
  END LOOP;
END $$;
ALTER TABLE "LeaveRequest" ADD CONSTRAINT leave_period_chk CHECK ("endDate" >= "startDate");
ALTER TABLE "LeaveRequest" ADD CONSTRAINT leave_days_chk CHECK (days > 0);
ALTER TABLE "LeaveRequest" ADD CONSTRAINT leave_type_chk CHECK (type IN ('paid_leave','sick','unpaid','other'));
ALTER TABLE "LeaveRequest" ADD CONSTRAINT leave_status_chk CHECK (status IN ('submitted','approved','rejected','cancelled'));
ALTER TABLE "LeaveAdjustment" ADD CONSTRAINT leaveadj_nonzero_chk CHECK (days <> 0);
CREATE TRIGGER leaveadjustment_append_only BEFORE UPDATE OR DELETE ON "LeaveAdjustment" FOR EACH ROW EXECUTE FUNCTION append_only();
