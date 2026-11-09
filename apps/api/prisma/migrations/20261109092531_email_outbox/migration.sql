-- CreateTable
CREATE TABLE "EmailOutbox" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "toHash" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailOutbox_tenantId_createdAt_idx" ON "EmailOutbox"("tenantId", "createdAt");

GRANT SELECT, INSERT ON "EmailOutbox" TO portage_app;
ALTER TABLE "EmailOutbox" ADD CONSTRAINT emailoutbox_chk CHECK (status IN ('sent','failed','not_connected'));
CREATE TRIGGER emailoutbox_append_only BEFORE UPDATE OR DELETE ON "EmailOutbox" FOR EACH ROW EXECUTE FUNCTION append_only();
