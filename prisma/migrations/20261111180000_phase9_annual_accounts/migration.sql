-- CreateEnum
CREATE TYPE "AnnualFramework" AS ENUM ('NV_IFRS_SME', 'NV_FULL_IFRS', 'SOLE_PROPRIETOR', 'FOUNDATION');

-- CreateEnum
CREATE TYPE "AnnualAccountStatus" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'FINAL');

-- CreateTable
CREATE TABLE "AnnualAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "administrationId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "framework" "AnnualFramework" NOT NULL,
    "status" "AnnualAccountStatus" NOT NULL DEFAULT 'DRAFT',
    "snapshot" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "entryCount" INTEGER NOT NULL,
    "submittedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "finalizedById" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnnualAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialDisclosure" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "annualAccountId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "auto" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FinancialDisclosure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnnualAccount_fiscalYearId_key" ON "AnnualAccount"("fiscalYearId");

-- CreateIndex
CREATE INDEX "AnnualAccount_organizationId_idx" ON "AnnualAccount"("organizationId");

-- CreateIndex
CREATE INDEX "FinancialDisclosure_organizationId_idx" ON "FinancialDisclosure"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialDisclosure_annualAccountId_code_key" ON "FinancialDisclosure"("annualAccountId", "code");

-- AddForeignKey
ALTER TABLE "FinancialDisclosure" ADD CONSTRAINT "FinancialDisclosure_annualAccountId_fkey" FOREIGN KEY ("annualAccountId") REFERENCES "AnnualAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

SELECT ara_enable_tenant_rls('"AnnualAccount"');
SELECT ara_enable_tenant_rls('"FinancialDisclosure"');
ALTER TABLE "AnnualAccount" ADD CONSTRAINT annual_account_approved CHECK (status IN ('DRAFT', 'REVIEW') OR ("approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL));
ALTER TABLE "AnnualAccount" ADD CONSTRAINT annual_account_final CHECK (status <> 'FINAL' OR ("finalizedById" IS NOT NULL AND "finalizedAt" IS NOT NULL));
CREATE OR REPLACE FUNCTION annual_account_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'FINAL' THEN
    RAISE EXCEPTION 'Final annual accounts are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER annual_account_guard BEFORE UPDATE OR DELETE ON "AnnualAccount" FOR EACH ROW EXECUTE FUNCTION annual_account_guard();
CREATE OR REPLACE FUNCTION disclosure_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "AnnualAccount" WHERE id = COALESCE(NEW."annualAccountId", OLD."annualAccountId") AND status IN ('APPROVED', 'FINAL')) THEN
    RAISE EXCEPTION 'Notes of approved annual accounts are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER disclosure_guard BEFORE INSERT OR UPDATE OR DELETE ON "FinancialDisclosure" FOR EACH ROW EXECUTE FUNCTION disclosure_guard();
