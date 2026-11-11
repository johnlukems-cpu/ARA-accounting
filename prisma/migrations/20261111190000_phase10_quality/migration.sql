-- CreateEnum
CREATE TYPE "IssueSeverity" AS ENUM ('ERROR', 'WARNING', 'INFO');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'ACCEPTED', 'FALSE_POSITIVE');

-- CreateTable
CREATE TABLE "QualityIssue" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "administrationId" TEXT NOT NULL,
    "checkCode" TEXT NOT NULL,
    "severity" "IssueSeverity" NOT NULL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "params" JSONB NOT NULL DEFAULT '{}',
    "fingerprint" TEXT NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
    "assigneeId" TEXT,
    "resolutionNote" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timesSeen" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "QualityIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityScan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "administrationId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER NOT NULL,
    "findings" INTEGER NOT NULL,
    "newIssues" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "results" JSONB NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "QualityScan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QualityIssue_administrationId_status_idx" ON "QualityIssue"("administrationId", "status");

-- CreateIndex
CREATE INDEX "QualityIssue_organizationId_idx" ON "QualityIssue"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "QualityIssue_administrationId_fingerprint_key" ON "QualityIssue"("administrationId", "fingerprint");

-- CreateIndex
CREATE INDEX "QualityScan_administrationId_startedAt_idx" ON "QualityScan"("administrationId", "startedAt");

-- CreateIndex
CREATE INDEX "QualityScan_organizationId_idx" ON "QualityScan"("organizationId");

SELECT ara_enable_tenant_rls('"QualityIssue"');
SELECT ara_enable_tenant_rls('"QualityScan"');
ALTER TABLE "QualityIssue" ADD CONSTRAINT quality_issue_closed CHECK (status IN ('OPEN', 'IN_PROGRESS') OR ("resolvedById" IS NOT NULL AND "resolvedAt" IS NOT NULL AND length(coalesce("resolutionNote", '')) >= 3));
CREATE TRIGGER quality_issue_no_delete BEFORE DELETE ON "QualityIssue" FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER quality_scan_append_only BEFORE UPDATE OR DELETE ON "QualityScan" FOR EACH ROW EXECUTE FUNCTION append_only();
