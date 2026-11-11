-- CreateEnum
CREATE TYPE "RateType" AS ENUM ('CBVS_BUY', 'CBVS_SELL', 'CBVS_MONTH_AVG', 'CLOSING', 'BANK', 'CAMBIO', 'MANUAL');

-- CreateEnum
CREATE TYPE "RateSource" AS ENUM ('MANUAL', 'CBVS_IMPORT');

-- CreateEnum
CREATE TYPE "RateStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RevaluationStatus" AS ENUM ('PROPOSED', 'POSTED', 'REVERSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "rateType" "RateType" NOT NULL,
    "rate" DECIMAL(20,10) NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "source" "RateSource" NOT NULL DEFAULT 'MANUAL',
    "reference" TEXT,
    "status" "RateStatus" NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrencyRevaluation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "administrationId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "revaluationDate" DATE NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'ALL',
    "status" "RevaluationStatus" NOT NULL DEFAULT 'PROPOSED',
    "rates" JSONB NOT NULL,
    "lines" JSONB NOT NULL,
    "entryId" TEXT,
    "reversalEntryId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CurrencyRevaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExchangeRate_organizationId_baseCurrency_currency_rateType__idx" ON "ExchangeRate"("organizationId", "baseCurrency", "currency", "rateType", "effectiveDate");

-- CreateIndex
CREATE INDEX "CurrencyRevaluation_organizationId_idx" ON "CurrencyRevaluation"("organizationId");

-- CreateIndex
CREATE INDEX "CurrencyRevaluation_administrationId_periodId_idx" ON "CurrencyRevaluation"("administrationId", "periodId");
