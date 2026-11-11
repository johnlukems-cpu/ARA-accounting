-- CreateTable
CREATE TABLE "ReportRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "administrationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "entryCount" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportRun_administrationId_createdAt_idx" ON "ReportRun"("administrationId", "createdAt");

-- CreateIndex
CREATE INDEX "ReportRun_organizationId_idx" ON "ReportRun"("organizationId");

-- Tenant isolation and append-only evidence of generated reports.
SELECT ara_enable_tenant_rls('"ReportRun"');
CREATE TRIGGER report_run_append_only BEFORE UPDATE OR DELETE ON "ReportRun" FOR EACH ROW EXECUTE FUNCTION append_only();
