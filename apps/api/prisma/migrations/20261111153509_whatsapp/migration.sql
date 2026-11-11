-- CreateTable
CREATE TABLE "WhatsappChannel" (
    "tenantId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "wabaId" TEXT,
    "displayPhone" TEXT,
    "accessTokenSealed" TEXT,
    "status" TEXT NOT NULL DEFAULT 'configured',
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappChannel_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "WhatsappRoute" (
    "phoneNumberId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "WhatsappRoute_pkey" PRIMARY KEY ("phoneNumberId")
);

-- CreateTable
CREATE TABLE "WhatsappTemplate" (
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "metaName" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'fr',
    "enabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "WhatsappTemplate_pkey" PRIMARY KEY ("tenantId","key")
);

-- CreateTable
CREATE TABLE "WhatsappConsent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "evidence" TEXT,
    "recordedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsappConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappConversation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "displayName" TEXT,
    "lastInboundAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsappConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "templateKey" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "error" TEXT,
    "sentBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsappMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappRoute_tenantId_key" ON "WhatsappRoute"("tenantId");

-- CreateIndex
CREATE INDEX "WhatsappConsent_tenantId_phone_idx" ON "WhatsappConsent"("tenantId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappConsent_tenantId_subjectType_subjectId_key" ON "WhatsappConsent"("tenantId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "WhatsappConversation_tenantId_lastMessageAt_idx" ON "WhatsappConversation"("tenantId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappConversation_tenantId_phone_key" ON "WhatsappConversation"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "WhatsappMessage_conversationId_createdAt_idx" ON "WhatsappMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsappMessage_tenantId_status_idx" ON "WhatsappMessage"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappMessage_tenantId_providerMessageId_key" ON "WhatsappMessage"("tenantId", "providerMessageId");

-- AddForeignKey
ALTER TABLE "WhatsappMessage" ADD CONSTRAINT "WhatsappMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsappConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Droits et RLS : tout est isolé par tenant sauf WhatsappRoute (routage des webhooks avant résolution du tenant ; aucun secret).
GRANT SELECT, INSERT, UPDATE ON "WhatsappChannel", "WhatsappTemplate", "WhatsappConsent", "WhatsappConversation" TO portage_app;
GRANT SELECT, INSERT, UPDATE ON "WhatsappMessage" TO portage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "WhatsappRoute" TO portage_app;
GRANT DELETE ON "WhatsappChannel" TO portage_app;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['WhatsappChannel','WhatsappTemplate','WhatsappConsent','WhatsappConversation','WhatsappMessage'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))', t || '_tenant', t);
  END LOOP;
END $$;

-- Valeurs contrôlées en base (défense en profondeur).
ALTER TABLE "WhatsappChannel" ADD CONSTRAINT wa_channel_status_chk CHECK (status IN ('configured','verified','error','disabled'));
ALTER TABLE "WhatsappConsent" ADD CONSTRAINT wa_consent_chk CHECK ("subjectType" IN ('consultant','contact') AND status IN ('opted_in','opted_out') AND phone ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE "WhatsappConversation" ADD CONSTRAINT wa_conv_phone_chk CHECK (phone ~ '^\+[1-9][0-9]{7,14}$' AND "unreadCount" >= 0);
ALTER TABLE "WhatsappMessage" ADD CONSTRAINT wa_msg_chk CHECK (direction IN ('in','out') AND kind IN ('text','template') AND status IN ('queued','sending','sent','delivered','read','failed','received','not_connected','simulated'));
