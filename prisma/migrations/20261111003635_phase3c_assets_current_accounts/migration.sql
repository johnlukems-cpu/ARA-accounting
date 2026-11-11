-- CreateEnum
CREATE TYPE "CurrentAccountKind" AS ENUM ('DIRECTOR', 'SHAREHOLDER', 'RELATED_PARTY', 'INTERCOMPANY');

-- CreateEnum
CREATE TYPE "DepreciationMethod" AS ENUM ('STRAIGHT_LINE', 'DECLINING_BALANCE');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('ACTIVE', 'FULLY_DEPRECIATED', 'DISPOSED');

-- CreateEnum
CREATE TYPE "AssetTransactionType" AS ENUM ('ACQUISITION', 'DEPRECIATION', 'TRANSFER', 'DISPOSAL');

-- CreateTable
CREATE TABLE "CurrentAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "administrationId" TEXT NOT NULL,
    "kind" "CurrentAccountKind" NOT NULL,
    "counterpartyName" TEXT NOT NULL,
    "counterpartyCompanyId" TEXT,
    "ledgerAccountId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "interestRatePct" DECIMAL(9,4),
    "agreement" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CurrentAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrentAccountConfirmation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "currentAccountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "confirmedBalance" DECIMAL(20,4) NOT NULL,
    "ledgerBalance" DECIMAL(20,4) NOT NULL,
    "difference" DECIMAL(20,4) NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CurrentAccountConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "administrationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetAccountId" TEXT NOT NULL,
    "accumulatedAccountId" TEXT NOT NULL,
    "expenseAccountId" TEXT NOT NULL,
    "gainAccountId" TEXT NOT NULL,
    "lossAccountId" TEXT NOT NULL,
    "defaultMethod" "DepreciationMethod" NOT NULL DEFAULT 'STRAIGHT_LINE',
    "defaultUsefulLifeMonths" INTEGER NOT NULL DEFAULT 60,
    "defaultResidualPct" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "AssetCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "administrationId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "acquisitionDate" DATE NOT NULL,
    "acquisitionCost" DECIMAL(20,4) NOT NULL,
    "residualValue" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "usefulLifeMonths" INTEGER NOT NULL,
    "method" "DepreciationMethod" NOT NULL DEFAULT 'STRAIGHT_LINE',
    "decliningRatePct" DECIMAL(9,4),
    "depreciationStart" DATE NOT NULL,
    "location" TEXT,
    "costCenterId" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "disposedAt" DATE,
    "disposalProceeds" DECIMAL(20,4),
    "acquisitionEntryId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepreciationLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "entryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepreciationLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetTransaction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "type" "AssetTransactionType" NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(20,4),
    "entryId" TEXT,
    "details" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CurrentAccount_organizationId_idx" ON "CurrentAccount"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CurrentAccount_administrationId_ledgerAccountId_key" ON "CurrentAccount"("administrationId", "ledgerAccountId");

-- CreateIndex
CREATE INDEX "CurrentAccountConfirmation_organizationId_idx" ON "CurrentAccountConfirmation"("organizationId");

-- CreateIndex
CREATE INDEX "AssetCategory_organizationId_idx" ON "AssetCategory"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetCategory_administrationId_code_key" ON "AssetCategory"("administrationId", "code");

-- CreateIndex
CREATE INDEX "Asset_organizationId_idx" ON "Asset"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_administrationId_number_key" ON "Asset"("administrationId", "number");

-- CreateIndex
CREATE INDEX "DepreciationLine_organizationId_idx" ON "DepreciationLine"("organizationId");

-- CreateIndex
CREATE INDEX "DepreciationLine_entryId_idx" ON "DepreciationLine"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "DepreciationLine_assetId_year_month_key" ON "DepreciationLine"("assetId", "year", "month");

-- CreateIndex
CREATE INDEX "AssetTransaction_organizationId_idx" ON "AssetTransaction"("organizationId");

-- CreateIndex
CREATE INDEX "AssetTransaction_assetId_idx" ON "AssetTransaction"("assetId");

-- AddForeignKey
ALTER TABLE "CurrentAccountConfirmation" ADD CONSTRAINT "CurrentAccountConfirmation_currentAccountId_fkey" FOREIGN KEY ("currentAccountId") REFERENCES "CurrentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AssetCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepreciationLine" ADD CONSTRAINT "DepreciationLine_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetTransaction" ADD CONSTRAINT "AssetTransaction_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
