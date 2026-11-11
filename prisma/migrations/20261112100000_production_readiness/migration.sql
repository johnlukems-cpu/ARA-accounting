-- Production readiness: configurable subscriptions, platform settings, compliance review evidence, bank format library.

-- Plans: annual prices, module access, display order. No prices are seeded (owner decision).
ALTER TABLE "Plan" ADD COLUMN "priceAnnualSrd" DECIMAL(20,2),
  ADD COLUMN "priceAnnualUsd" DECIMAL(20,2),
  ADD COLUMN "modules" JSONB,
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Plan" ADD CONSTRAINT plan_prices_non_negative CHECK (
  coalesce("priceMonthlySrd", 0) >= 0 AND coalesce("priceMonthlyUsd", 0) >= 0 AND coalesce("priceAnnualSrd", 0) >= 0 AND coalesce("priceAnnualUsd", 0) >= 0);

-- Tax rule verification fields (set only together with a ComplianceReview).
ALTER TABLE "TaxRuleVersion" ADD COLUMN "verifiedBy" TEXT,
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "verificationReference" TEXT;
-- A rule can only be VERIFIED with the verifier, the date and a reference recorded.
ALTER TABLE "TaxRuleVersion" ADD CONSTRAINT tax_rule_verified_evidence CHECK (
  "legalStatus" <> 'VERIFIED' OR ("verifiedBy" IS NOT NULL AND "verifiedAt" IS NOT NULL AND "verificationReference" IS NOT NULL));

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

-- CreateEnum
CREATE TYPE "ComplianceSubject" AS ENUM ('TAX_RULE', 'BTW_CODE_TEMPLATE', 'ANNUAL_ACCOUNTS_FRAMEWORK', 'RETENTION_PERIOD', 'OTHER');
CREATE TYPE "ComplianceDecision" AS ENUM ('APPROVED', 'CHANGES_REQUIRED', 'REJECTED');
CREATE TYPE "BankFormatStatus" AS ENUM ('DRAFT', 'VALIDATED', 'RETIRED');

-- CreateTable
CREATE TABLE "ComplianceReview" (
    "id" TEXT NOT NULL,
    "subject" "ComplianceSubject" NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "decision" "ComplianceDecision" NOT NULL,
    "reviewerName" TEXT NOT NULL,
    "reviewerQualification" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "reviewedOn" DATE NOT NULL,
    "notes" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ComplianceReview_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ComplianceReview_subject_subjectKey_idx" ON "ComplianceReview"("subject", "subjectKey");
CREATE TRIGGER compliance_review_append_only BEFORE UPDATE OR DELETE ON "ComplianceReview" FOR EACH ROW EXECUTE FUNCTION append_only();

-- CreateTable
CREATE TABLE "BankFormat" (
    "id" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "formatName" TEXT NOT NULL,
    "profile" JSONB NOT NULL,
    "status" "BankFormatStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "sampleSha256" TEXT,
    "sampleSummary" JSONB,
    "validatedAt" TIMESTAMP(3),
    "validatedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BankFormat_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BankFormat_bankName_formatName_key" ON "BankFormat"("bankName", "formatName");
-- VALIDATED requires the evidence of a real sample.
ALTER TABLE "BankFormat" ADD CONSTRAINT bank_format_validated_evidence CHECK (
  "status" <> 'VALIDATED' OR ("sampleSha256" IS NOT NULL AND "sampleSummary" IS NOT NULL AND "validatedAt" IS NOT NULL AND "validatedById" IS NOT NULL));

-- Platform tables: written only by trusted platform code (owner role). Tenants may read the plans and the bank format
-- library, never platform settings or review records.
ALTER TABLE "PlatformSetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ComplianceReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BankFormat" ENABLE ROW LEVEL SECURITY;
CREATE POLICY bank_format_read ON "BankFormat" FOR SELECT TO ara_app USING (true);
GRANT SELECT ON "BankFormat" TO ara_app;
