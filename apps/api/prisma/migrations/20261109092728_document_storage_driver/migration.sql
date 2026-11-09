-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "storageDriver" TEXT NOT NULL DEFAULT 'db',
ADD COLUMN     "storageKey" TEXT;

ALTER TABLE "Document" ADD CONSTRAINT document_storage_chk CHECK ("storageDriver" IN ('db','s3') AND ("storageDriver" = 'db' OR "storageKey" IS NOT NULL));
