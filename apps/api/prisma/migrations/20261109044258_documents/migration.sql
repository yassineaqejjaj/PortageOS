-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "scanStatus" TEXT NOT NULL,
    "scanEngine" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "deleteReason" TEXT,
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentBlob" (
    "documentId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "DocumentBlob_pkey" PRIMARY KEY ("documentId")
);

-- CreateIndex
CREATE INDEX "Document_tenantId_ownerType_ownerId_idx" ON "Document"("tenantId", "ownerType", "ownerId");

-- AddForeignKey
ALTER TABLE "DocumentBlob" ADD CONSTRAINT "DocumentBlob_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE ON "Document" TO portage_app;
GRANT SELECT, INSERT, DELETE ON "DocumentBlob" TO portage_app;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['Document','DocumentBlob'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))', t || '_tenant', t);
  END LOOP;
END $$;
ALTER TABLE "Document" ADD CONSTRAINT document_size_chk CHECK (size > 0 AND size <= 10485760);
ALTER TABLE "Document" ADD CONSTRAINT document_scan_chk CHECK ("scanStatus" IN ('clean','not_scanned'));
ALTER TABLE "Document" ADD CONSTRAINT document_owner_chk CHECK ("ownerType" IN ('consultant','expense_claim','contract','general'));
ALTER TABLE "Document" ADD CONSTRAINT document_mime_chk CHECK (mime IN ('application/pdf','image/png','image/jpeg','image/webp'));
ALTER TABLE "Document" ADD CONSTRAINT document_sha_chk CHECK (sha256 ~ '^[0-9a-f]{64}$');

-- Métadonnées figées : seules la suppression logique et la purge peuvent changer
CREATE OR REPLACE FUNCTION document_frozen() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Document est append-only'; END IF;
  IF NEW."tenantId" <> OLD."tenantId" OR NEW."ownerType" <> OLD."ownerType" OR NEW."ownerId" <> OLD."ownerId" OR NEW.category <> OLD.category OR NEW.name <> OLD.name
     OR NEW.mime <> OLD.mime OR NEW.size <> OLD.size OR NEW.sha256 <> OLD.sha256 OR NEW."scanStatus" <> OLD."scanStatus" OR NEW."uploadedBy" <> OLD."uploadedBy" THEN
    RAISE EXCEPTION 'Document : métadonnées immuables (seules la suppression logique et la purge sont possibles)'; END IF;
  IF OLD."deletedAt" IS NOT NULL AND (NEW."deletedAt" IS DISTINCT FROM OLD."deletedAt" OR NEW."deleteReason" IS DISTINCT FROM OLD."deleteReason") THEN RAISE EXCEPTION 'Document déjà supprimé'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER document_frozen BEFORE UPDATE OR DELETE ON "Document" FOR EACH ROW EXECUTE FUNCTION document_frozen();
-- Le contenu ne se modifie jamais (il se supprime par purge)
CREATE OR REPLACE FUNCTION documentblob_immutable() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Le contenu d''un document est immuable'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER documentblob_immutable BEFORE UPDATE ON "DocumentBlob" FOR EACH ROW EXECUTE FUNCTION documentblob_immutable();
