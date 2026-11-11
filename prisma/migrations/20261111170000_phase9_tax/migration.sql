-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('PURCHASE', 'EVIDENCE');

-- CreateEnum
CREATE TYPE "TaxType" AS ENUM ('BTW', 'IB_RECHTSPERSONEN', 'DIVIDENDBELASTING');

-- CreateEnum
CREATE TYPE "RuleLegalStatus" AS ENUM ('VERIFIED', 'SOURCE_FOUND', 'PENDING_VERIFICATION');

-- CreateEnum
CREATE TYPE "TaxReturnStatus" AS ENUM ('DRAFT', 'APPROVED', 'FILED');

-- CreateEnum
CREATE TYPE "TaxAdjustmentKind" AS ENUM ('NON_DEDUCTIBLE', 'EXEMPT_INCOME', 'DEPRECIATION_DIFFERENCE', 'LOSS_OFFSET', 'OTHER');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "kind" "DocumentKind" NOT NULL DEFAULT 'PURCHASE';

-- CreateTable
CREATE TABLE "TaxRuleVersion" (
    "id" TEXT NOT NULL,
    "taxType" "TaxType" NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "parameters" JSONB NOT NULL,
    "legalStatus" "RuleLegalStatus" NOT NULL,
    "legalSource" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxRuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxReturn" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "administrationId" TEXT NOT NULL,
    "taxType" "TaxType" NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "fiscalYearId" TEXT,
    "ruleVersionId" TEXT NOT NULL,
    "status" "TaxReturnStatus" NOT NULL DEFAULT 'DRAFT',
    "calculation" JSONB NOT NULL,
    "acknowledgedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "explanation" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "entryId" TEXT,
    "evidenceDocumentId" TEXT,
    "filingReference" TEXT,
    "filedById" TEXT,
    "filedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxAdjustment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "kind" "TaxAdjustmentKind" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaxRuleVersion_taxType_effectiveFrom_key" ON "TaxRuleVersion"("taxType", "effectiveFrom");

-- CreateIndex
CREATE INDEX "TaxReturn_organizationId_idx" ON "TaxReturn"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxReturn_administrationId_taxType_periodFrom_periodTo_key" ON "TaxReturn"("administrationId", "taxType", "periodFrom", "periodTo");

-- CreateIndex
CREATE INDEX "TaxAdjustment_organizationId_idx" ON "TaxAdjustment"("organizationId");

-- AddForeignKey
ALTER TABLE "TaxAdjustment" ADD CONSTRAINT "TaxAdjustment_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "TaxReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tax rules: platform data, readable by tenants, never writable by them.
ALTER TABLE "TaxRuleVersion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tax_rule_read ON "TaxRuleVersion" FOR SELECT TO ara_app USING (true);
GRANT SELECT ON "TaxRuleVersion" TO ara_app;

SELECT ara_enable_tenant_rls('"TaxReturn"');
SELECT ara_enable_tenant_rls('"TaxAdjustment"');
ALTER TABLE "TaxReturn" ADD CONSTRAINT tax_return_approved CHECK (status = 'DRAFT' OR ("approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL));
-- T4: FILED only with filing evidence and the person who confirmed it.
ALTER TABLE "TaxReturn" ADD CONSTRAINT tax_return_filed CHECK (status <> 'FILED' OR ("evidenceDocumentId" IS NOT NULL AND "filedById" IS NOT NULL AND "filedAt" IS NOT NULL));

-- A filed return is final; an approved one may only move to FILED.
CREATE OR REPLACE FUNCTION tax_return_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'An approved or filed tax return cannot be deleted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'FILED' THEN
    RAISE EXCEPTION 'A filed tax return is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'APPROVED' AND (NEW.status <> 'FILED' OR NEW.calculation <> OLD.calculation) THEN
    RAISE EXCEPTION 'An approved tax return can only be filed' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER tax_return_guard BEFORE UPDATE OR DELETE ON "TaxReturn" FOR EACH ROW EXECUTE FUNCTION tax_return_guard();
CREATE OR REPLACE FUNCTION tax_adjustment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "TaxReturn" WHERE id = COALESCE(NEW."returnId", OLD."returnId") AND status <> 'DRAFT') THEN
    RAISE EXCEPTION 'Adjustments of an approved tax return are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER tax_adjustment_guard BEFORE INSERT OR UPDATE OR DELETE ON "TaxAdjustment" FOR EACH ROW EXECUTE FUNCTION tax_adjustment_guard();
ALTER TABLE "Document" DROP CONSTRAINT IF EXISTS document_mime;
ALTER TABLE "Document" ADD CONSTRAINT document_mime CHECK ("mimeType" IN ('application/pdf', 'image/jpeg', 'image/png'));
