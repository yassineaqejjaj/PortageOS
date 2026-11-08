-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentKey" TEXT NOT NULL,
    "playbook" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "createdBy" TEXT NOT NULL,
    "toolCallCount" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "usage" JSONB NOT NULL,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentToolCall" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentProposal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "riskAmount" DECIMAL(14,2),
    "requiredApprovals" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "AgentProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentApproval" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentConfig" (
    "tenantId" TEXT NOT NULL,
    "agentKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "maxToolCallsPerRun" INTEGER NOT NULL DEFAULT 50,
    "maxRunsPerDay" INTEGER NOT NULL DEFAULT 20,

    CONSTRAINT "AgentConfig_pkey" PRIMARY KEY ("tenantId","agentKey")
);

-- CreateIndex
CREATE INDEX "AgentRun_tenantId_startedAt_idx" ON "AgentRun"("tenantId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentToolCall_runId_idx" ON "AgentToolCall"("runId");

-- CreateIndex
CREATE INDEX "AgentProposal_tenantId_status_idx" ON "AgentProposal"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AgentApproval_proposalId_userId_key" ON "AgentApproval"("proposalId", "userId");

-- AddForeignKey
ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentProposal" ADD CONSTRAINT "AgentProposal_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApproval" ADD CONSTRAINT "AgentApproval_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "AgentProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE ON "AgentRun", "AgentProposal", "AgentConfig" TO portage_app;
GRANT SELECT, INSERT ON "AgentToolCall", "AgentApproval" TO portage_app;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['AgentRun','AgentToolCall','AgentProposal','AgentApproval','AgentConfig'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))', t || '_tenant', t);
  END LOOP;
END $$;
ALTER TABLE "AgentConfig" ADD CONSTRAINT agentconfig_budget_chk CHECK ("maxToolCallsPerRun" BETWEEN 1 AND 500 AND "maxRunsPerDay" BETWEEN 1 AND 1000);
ALTER TABLE "AgentProposal" ADD CONSTRAINT agentproposal_status_chk CHECK (status IN ('pending','approved','rejected','executed','failed'));
ALTER TABLE "AgentProposal" ADD CONSTRAINT agentproposal_approvals_chk CHECK ("requiredApprovals" BETWEEN 1 AND 3);
ALTER TABLE "AgentApproval" ADD CONSTRAINT agentapproval_decision_chk CHECK (decision IN ('approve','reject'));
CREATE TRIGGER agenttoolcall_append_only BEFORE UPDATE OR DELETE ON "AgentToolCall" FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER agentapproval_append_only BEFORE UPDATE OR DELETE ON "AgentApproval" FOR EACH ROW EXECUTE FUNCTION append_only();
-- Une proposition ne peut pas être modifiée (outil, arguments, montant) après sa création : seul son statut évolue.
CREATE OR REPLACE FUNCTION agentproposal_frozen() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'AgentProposal est append-only'; END IF;
  IF NEW.tool <> OLD.tool OR NEW.input::text <> OLD.input::text OR NEW."requiredApprovals" <> OLD."requiredApprovals" OR NEW."runId" <> OLD."runId" OR NEW."riskAmount" IS DISTINCT FROM OLD."riskAmount" THEN
    RAISE EXCEPTION 'AgentProposal: outil, arguments, montant et niveau d''approbation sont immuables'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER agentproposal_frozen BEFORE UPDATE OR DELETE ON "AgentProposal" FOR EACH ROW EXECUTE FUNCTION agentproposal_frozen();
