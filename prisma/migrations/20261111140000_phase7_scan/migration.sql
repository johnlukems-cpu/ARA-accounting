-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'REVIEW_REQUIRED', 'PROCESSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocumentSource" AS ENUM ('WEB', 'MOBILE');

-- CreateEnum
CREATE TYPE "AutomationMode" AS ENUM ('SUGGEST', 'DRAFT', 'AUTO_POST');

-- CreateEnum
CREATE TYPE "AutomationOutcome" AS ENUM ('SUGGESTED', 'DRAFTED', 'POSTED', 'REVIEW', 'FAILED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "settings" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "administrationId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "pageCount" INTEGER,
    "source" "DocumentSource" NOT NULL DEFAULT 'WEB',
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "textContent" TEXT,
    "confirmed" JSONB,
    "invoiceId" TEXT,
    "duplicateOfId" TEXT,
    "duplicateReason" TEXT,
    "rejectReason" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentFile" (
    "documentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "DocumentFile_pkey" PRIMARY KEY ("documentId")
);

-- CreateTable
CREATE TABLE "DocumentExtraction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "fields" JSONB NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "administrationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "descriptionContains" TEXT,
    "accountId" TEXT NOT NULL,
    "taxCodeId" TEXT,
    "mode" "AutomationMode" NOT NULL DEFAULT 'SUGGEST',
    "minConfidence" DECIMAL(4,3) NOT NULL DEFAULT 0.9,
    "maxAmount" DECIMAL(20,2),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationExecution" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "administrationId" TEXT NOT NULL,
    "ruleId" TEXT,
    "documentId" TEXT,
    "outcome" "AutomationOutcome" NOT NULL,
    "reasons" JSONB NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Document_administrationId_sha256_idx" ON "Document"("administrationId", "sha256");

-- CreateIndex
CREATE INDEX "Document_organizationId_idx" ON "Document"("organizationId");

-- CreateIndex
CREATE INDEX "DocumentExtraction_documentId_idx" ON "DocumentExtraction"("documentId");

-- CreateIndex
CREATE INDEX "DocumentExtraction_organizationId_idx" ON "DocumentExtraction"("organizationId");

-- CreateIndex
CREATE INDEX "AutomationRule_administrationId_partyId_idx" ON "AutomationRule"("administrationId", "partyId");

-- CreateIndex
CREATE INDEX "AutomationRule_organizationId_idx" ON "AutomationRule"("organizationId");

-- CreateIndex
CREATE INDEX "AutomationExecution_administrationId_createdAt_idx" ON "AutomationExecution"("administrationId", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationExecution_organizationId_idx" ON "AutomationExecution"("organizationId");
