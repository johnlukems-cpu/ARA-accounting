-- CreateEnum
CREATE TYPE "AccountCategory" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COST_OF_SALES', 'OPERATING_EXPENSE', 'FINANCIAL_INCOME', 'FINANCIAL_EXPENSE', 'TAX', 'SUSPENSE');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('HEADER', 'DETAIL');

-- CreateEnum
CREATE TYPE "BalanceSide" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "ControlType" AS ENUM ('NONE', 'RECEIVABLE', 'PAYABLE', 'BANK', 'CASH', 'CURRENT_ACCOUNT', 'FIXED_ASSET', 'TAX', 'ROUNDING', 'FX_RESULT', 'RETAINED_EARNINGS', 'RESULT_CURRENT_YEAR', 'SUSPENSE');

-- CreateEnum
CREATE TYPE "JournalType" AS ENUM ('PURCHASE', 'SALES', 'BANK', 'CASH', 'GENERAL', 'OPENING', 'FIXED_ASSET', 'DEPRECIATION', 'TAX', 'FX_ADJUSTMENT', 'CLOSING');

-- CreateEnum
CREATE TYPE "EntryStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED');

-- CreateEnum
CREATE TYPE "EntryKind" AS ENUM ('NORMAL', 'OPENING', 'REVERSAL', 'CORRECTION', 'ADJUSTMENT', 'CLOSING');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('MANUAL', 'SALES_INVOICE', 'PURCHASE_INVOICE', 'PAYMENT', 'BANK', 'CURRENT_ACCOUNT', 'ASSET', 'DEPRECIATION', 'FX_REVALUATION', 'YEAR_END', 'OPENING', 'TAX', 'IMPORT', 'SCAN');

-- CreateEnum
CREATE TYPE "DimensionType" AS ENUM ('COST_CENTER', 'PROJECT', 'DEPARTMENT');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "administrationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "description" TEXT,
    "category" "AccountCategory" NOT NULL,
    "type" "AccountType" NOT NULL DEFAULT 'DETAIL',
    "parentId" TEXT,
    "normalBalance" "BalanceSide" NOT NULL,
    "controlType" "ControlType" NOT NULL DEFAULT 'NONE',
    "currency" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "templateAccountRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Journal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "administrationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "JournalType" NOT NULL,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Journal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "administrationId" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "entryNumber" INTEGER,
    "entryDate" DATE NOT NULL,
    "documentDate" DATE,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "currency" TEXT NOT NULL,
    "status" "EntryStatus" NOT NULL DEFAULT 'DRAFT',
    "kind" "EntryKind" NOT NULL DEFAULT 'NORMAL',
    "sourceType" "SourceType" NOT NULL DEFAULT 'MANUAL',
    "sourceId" TEXT,
    "reversesEntryId" TEXT,
    "reversedByEntryId" TEXT,
    "reason" TEXT,
    "idempotencyKey" TEXT,
    "totalDebitBase" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "totalCreditBase" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "administrationId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "description" TEXT,
    "debitBase" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "creditBase" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "txCurrency" TEXT NOT NULL,
    "txAmount" DECIMAL(20,4) NOT NULL,
    "exchangeRate" DECIMAL(24,10) NOT NULL DEFAULT 1,
    "rateDate" DATE,
    "rateSource" TEXT,
    "costCenterId" TEXT,
    "projectId" TEXT,
    "departmentId" TEXT,
    "partyId" TEXT,
    "taxCodeId" TEXT,
    "isRounding" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DimensionValue" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "administrationId" TEXT NOT NULL,
    "type" "DimensionType" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DimensionValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberSequence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "NumberSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Account_organizationId_idx" ON "Account"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_administrationId_number_key" ON "Account"("administrationId", "number");

-- CreateIndex
CREATE INDEX "Journal_organizationId_idx" ON "Journal"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Journal_administrationId_code_key" ON "Journal"("administrationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_reversesEntryId_key" ON "JournalEntry"("reversesEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_reversedByEntryId_key" ON "JournalEntry"("reversedByEntryId");

-- CreateIndex
CREATE INDEX "JournalEntry_organizationId_idx" ON "JournalEntry"("organizationId");

-- CreateIndex
CREATE INDEX "JournalEntry_administrationId_periodId_status_idx" ON "JournalEntry"("administrationId", "periodId", "status");

-- CreateIndex
CREATE INDEX "JournalEntry_administrationId_status_entryDate_idx" ON "JournalEntry"("administrationId", "status", "entryDate");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_administrationId_idempotencyKey_key" ON "JournalEntry"("administrationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_journalId_fiscalYearId_entryNumber_key" ON "JournalEntry"("journalId", "fiscalYearId", "entryNumber");

-- CreateIndex
CREATE INDEX "JournalLine_organizationId_idx" ON "JournalLine"("organizationId");

-- CreateIndex
CREATE INDEX "JournalLine_administrationId_accountId_idx" ON "JournalLine"("administrationId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalLine_entryId_lineNo_key" ON "JournalLine"("entryId", "lineNo");

-- CreateIndex
CREATE INDEX "DimensionValue_organizationId_idx" ON "DimensionValue"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "DimensionValue_administrationId_type_code_key" ON "DimensionValue"("administrationId", "type", "code");

-- CreateIndex
CREATE INDEX "NumberSequence_organizationId_idx" ON "NumberSequence"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "NumberSequence_scope_scopeId_fiscalYearId_key" ON "NumberSequence"("scope", "scopeId", "fiscalYearId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
