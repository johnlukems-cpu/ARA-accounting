-- CreateEnum
CREATE TYPE "TaxDirection" AS ENUM ('SALES', 'PURCHASE', 'BOTH');

-- CreateEnum
CREATE TYPE "TaxKind" AS ENUM ('STANDARD', 'LUXURY', 'ZERO', 'EXEMPT', 'IMPORT', 'NONE');

-- CreateEnum
CREATE TYPE "LegalStatus" AS ENUM ('VERIFIED', 'SOURCE_FOUND', 'PENDING_VERIFICATION');

-- CreateEnum
CREATE TYPE "FinancialAccountKind" AS ENUM ('BANK', 'CASH');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('SALES', 'PURCHASE');

-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('INVOICE', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'POSTED', 'PARTIALLY_PAID', 'PAID');

-- CreateEnum
CREATE TYPE "OpenItemSide" AS ENUM ('RECEIVABLE', 'PAYABLE');

-- CreateEnum
CREATE TYPE "OpenItemStatus" AS ENUM ('OPEN', 'SETTLED');

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('IN', 'OUT');

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "administrationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isCustomer" BOOLEAN NOT NULL DEFAULT false,
    "isSupplier" BOOLEAN NOT NULL DEFAULT false,
    "kkfNumber" TEXT,
    "taxNumber" TEXT,
    "btwNumber" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "district" "District",
    "currency" TEXT NOT NULL DEFAULT 'SRD',
    "paymentTermDays" INTEGER NOT NULL DEFAULT 30,
    "defaultRevenueAccountId" TEXT,
    "defaultExpenseAccountId" TEXT,
    "defaultTaxCodeId" TEXT,
    "bankName" TEXT,
    "bankAccountNumber" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxCode" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "administrationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "kind" "TaxKind" NOT NULL,
    "direction" "TaxDirection" NOT NULL DEFAULT 'BOTH',
    "rate" DECIMAL(9,4) NOT NULL,
    "deductiblePct" DECIMAL(9,4) NOT NULL DEFAULT 100,
    "outputAccountId" TEXT,
    "inputAccountId" TEXT,
    "legalStatus" "LegalStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "legalSource" TEXT,
    "reportBox" TEXT,
    "validFrom" DATE,
    "validTo" DATE,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "administrationId" TEXT NOT NULL,
    "kind" "FinancialAccountKind" NOT NULL,
    "name" TEXT NOT NULL,
    "bankCode" TEXT,
    "accountNumber" TEXT,
    "currency" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "importProfile" JSONB,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "administrationId" TEXT NOT NULL,
    "type" "InvoiceType" NOT NULL,
    "kind" "InvoiceKind" NOT NULL DEFAULT 'INVOICE',
    "partyId" TEXT NOT NULL,
    "number" TEXT,
    "externalNumber" TEXT,
    "invoiceDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "exchangeRate" DECIMAL(24,10) NOT NULL DEFAULT 1,
    "rateSource" TEXT,
    "description" TEXT,
    "notes" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "netAmount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "grossAmount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "grossBase" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "creditsInvoiceId" TEXT,
    "entryId" TEXT,
    "documentId" TEXT,
    "sentAt" TIMESTAMP(3),
    "sentTo" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(20,4) NOT NULL,
    "discountPct" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(20,4) NOT NULL,
    "taxCodeId" TEXT,
    "taxRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "accountId" TEXT NOT NULL,
    "costCenterId" TEXT,
    "projectId" TEXT,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "administrationId" TEXT NOT NULL,
    "partyId" TEXT,
    "currentAccountId" TEXT,
    "side" "OpenItemSide" NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "description" TEXT,
    "date" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "originalAmount" DECIMAL(20,4) NOT NULL,
    "remainingAmount" DECIMAL(20,4) NOT NULL,
    "originalRate" DECIMAL(24,10) NOT NULL DEFAULT 1,
    "ledgerAccountId" TEXT NOT NULL,
    "status" "OpenItemStatus" NOT NULL DEFAULT 'OPEN',
    "lastReminderAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpenItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "administrationId" TEXT NOT NULL,
    "direction" "PaymentDirection" NOT NULL,
    "partyId" TEXT,
    "financialAccountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "exchangeRate" DECIMAL(24,10) NOT NULL DEFAULT 1,
    "reference" TEXT,
    "description" TEXT,
    "bankTransactionId" TEXT,
    "entryId" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Allocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "openItemId" TEXT NOT NULL,
    "paymentId" TEXT,
    "counterOpenItemId" TEXT,
    "amount" DECIMAL(20,4) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Allocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Party_organizationId_idx" ON "Party"("organizationId");

-- CreateIndex
CREATE INDEX "Party_administrationId_name_idx" ON "Party"("administrationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Party_administrationId_code_key" ON "Party"("administrationId", "code");

-- CreateIndex
CREATE INDEX "TaxCode_organizationId_idx" ON "TaxCode"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxCode_administrationId_code_key" ON "TaxCode"("administrationId", "code");

-- CreateIndex
CREATE INDEX "FinancialAccount_organizationId_idx" ON "FinancialAccount"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialAccount_administrationId_kind_bankCode_accountNumb_key" ON "FinancialAccount"("administrationId", "kind", "bankCode", "accountNumber", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_entryId_key" ON "Invoice"("entryId");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_idx" ON "Invoice"("organizationId");

-- CreateIndex
CREATE INDEX "Invoice_administrationId_type_status_idx" ON "Invoice"("administrationId", "type", "status");

-- CreateIndex
CREATE INDEX "Invoice_partyId_idx" ON "Invoice"("partyId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_administrationId_type_number_key" ON "Invoice"("administrationId", "type", "number");

-- CreateIndex
CREATE INDEX "InvoiceLine_organizationId_idx" ON "InvoiceLine"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceLine_invoiceId_lineNo_key" ON "InvoiceLine"("invoiceId", "lineNo");

-- CreateIndex
CREATE INDEX "OpenItem_organizationId_idx" ON "OpenItem"("organizationId");

-- CreateIndex
CREATE INDEX "OpenItem_administrationId_side_status_idx" ON "OpenItem"("administrationId", "side", "status");

-- CreateIndex
CREATE INDEX "OpenItem_partyId_status_idx" ON "OpenItem"("partyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OpenItem_sourceType_sourceId_key" ON "OpenItem"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_entryId_key" ON "Payment"("entryId");

-- CreateIndex
CREATE INDEX "Payment_organizationId_idx" ON "Payment"("organizationId");

-- CreateIndex
CREATE INDEX "Payment_administrationId_date_idx" ON "Payment"("administrationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_administrationId_idempotencyKey_key" ON "Payment"("administrationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Allocation_organizationId_idx" ON "Allocation"("organizationId");

-- CreateIndex
CREATE INDEX "Allocation_openItemId_idx" ON "Allocation"("openItemId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenItem" ADD CONSTRAINT "OpenItem_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_openItemId_fkey" FOREIGN KEY ("openItemId") REFERENCES "OpenItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
