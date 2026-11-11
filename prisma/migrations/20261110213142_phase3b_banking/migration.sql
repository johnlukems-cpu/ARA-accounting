-- CreateEnum
CREATE TYPE "BankTransactionStatus" AS ENUM ('UNMATCHED', 'PARTIAL', 'MATCHED', 'IGNORED');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('DRAFT', 'APPROVED');

-- CreateTable
CREATE TABLE "BankStatement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "administrationId" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "closingBalance" DECIMAL(20,4),
    "lineCount" INTEGER NOT NULL,
    "duplicateLines" INTEGER NOT NULL DEFAULT 0,
    "importedById" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "administrationId" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "bookingDate" DATE NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "counterpartyName" TEXT,
    "counterpartyAccount" TEXT,
    "bankReference" TEXT,
    "lineHash" TEXT NOT NULL,
    "status" "BankTransactionStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matchedAmount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "ignoreReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankMatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bankTransactionId" TEXT NOT NULL,
    "paymentId" TEXT,
    "entryId" TEXT,
    "amount" DECIMAL(20,4) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankReconciliation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "administrationId" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "periodEnd" DATE NOT NULL,
    "statementBalance" DECIMAL(20,4) NOT NULL,
    "ledgerBalance" DECIMAL(20,4) NOT NULL,
    "difference" DECIMAL(20,4) NOT NULL,
    "unmatchedCount" INTEGER NOT NULL,
    "notes" TEXT,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankStatement_organizationId_idx" ON "BankStatement"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatement_financialAccountId_fileHash_key" ON "BankStatement"("financialAccountId", "fileHash");

-- CreateIndex
CREATE INDEX "BankTransaction_organizationId_idx" ON "BankTransaction"("organizationId");

-- CreateIndex
CREATE INDEX "BankTransaction_financialAccountId_status_bookingDate_idx" ON "BankTransaction"("financialAccountId", "status", "bookingDate");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_financialAccountId_lineHash_key" ON "BankTransaction"("financialAccountId", "lineHash");

-- CreateIndex
CREATE INDEX "BankMatch_organizationId_idx" ON "BankMatch"("organizationId");

-- CreateIndex
CREATE INDEX "BankMatch_bankTransactionId_idx" ON "BankMatch"("bankTransactionId");

-- CreateIndex
CREATE INDEX "BankReconciliation_organizationId_idx" ON "BankReconciliation"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "BankReconciliation_financialAccountId_periodEnd_key" ON "BankReconciliation"("financialAccountId", "periodEnd");

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BankStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankMatch" ADD CONSTRAINT "BankMatch_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
