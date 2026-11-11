-- CreateEnum
CREATE TYPE "BudgetScenario" AS ENUM ('BASE', 'BEST', 'WORST');

-- CreateEnum
CREATE TYPE "BudgetVersionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "BudgetBasis" AS ENUM ('MANUAL', 'IMPORT', 'PRIOR_ACTUALS', 'PRIOR_BUDGET');

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "administrationId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scenario" "BudgetScenario" NOT NULL DEFAULT 'BASE',
    "alertThresholdPct" DECIMAL(9,2) NOT NULL DEFAULT 10,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "BudgetVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "basis" "BudgetBasis" NOT NULL DEFAULT 'MANUAL',
    "adjustmentPct" DECIMAL(9,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "dimensionId" TEXT NOT NULL DEFAULT '',
    "period" INTEGER NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,

    CONSTRAINT "BudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Budget_organizationId_idx" ON "Budget"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_administrationId_fiscalYearId_name_scenario_key" ON "Budget"("administrationId", "fiscalYearId", "name", "scenario");

-- CreateIndex
CREATE INDEX "BudgetVersion_organizationId_idx" ON "BudgetVersion"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetVersion_budgetId_version_key" ON "BudgetVersion"("budgetId", "version");

-- CreateIndex
CREATE INDEX "BudgetLine_organizationId_idx" ON "BudgetLine"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetLine_versionId_accountId_dimensionId_period_key" ON "BudgetLine"("versionId", "accountId", "dimensionId", "period");

-- AddForeignKey
ALTER TABLE "BudgetVersion" ADD CONSTRAINT "BudgetVersion_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "BudgetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
