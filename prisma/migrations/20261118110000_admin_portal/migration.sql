-- CreateEnum
CREATE TYPE "CrmStage" AS ENUM ('LEAD', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'CUSTOMER', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CrmKind" AS ENUM ('COMPANY', 'PERSON');

-- CreateEnum
CREATE TYPE "CrmActivityType" AS ENUM ('NOTE', 'CALL', 'EMAIL', 'MEETING', 'TASK', 'STAGE_CHANGE', 'QUOTATION', 'INVOICE', 'PAYMENT', 'SUBSCRIPTION', 'SUPPORT', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('SOFTWARE', 'SUBSCRIPTION', 'IMPLEMENTATION', 'ONBOARDING', 'SUPPORT', 'CONSULTANCY', 'OTHER');

-- CreateEnum
CREATE TYPE "BillingType" AS ENUM ('ONE_TIME', 'RECURRING');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "AraSubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AraPaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "AraPaymentMethod" AS ENUM ('BANK_TRANSFER', 'CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "StorageBackend" AS ENUM ('DATABASE', 'SUPABASE');

-- CreateTable
CREATE TABLE "CrmCustomer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "CrmKind" NOT NULL DEFAULT 'COMPANY',
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "stage" "CrmStage" NOT NULL DEFAULT 'LEAD',
    "category" TEXT,
    "source" TEXT,
    "kkfNumber" TEXT,
    "taxNumber" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "district" TEXT,
    "country" TEXT NOT NULL DEFAULT 'SR',
    "website" TEXT,
    "preferredCurrency" TEXT NOT NULL DEFAULT 'SRD',
    "paymentTermDays" INTEGER NOT NULL DEFAULT 14,
    "accountManagerId" TEXT,
    "partyId" TEXT,
    "linkedOrganizationId" TEXT,
    "notes" TEXT,
    "convertedAt" TIMESTAMP(3),
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmContact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jobTitle" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmActivity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "CrmActivityType" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "dueDate" DATE,
    "doneAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "description" TEXT,
    "category" "ProductCategory" NOT NULL,
    "billingType" "BillingType" NOT NULL,
    "billingInterval" "BillingInterval",
    "defaultPrice" DECIMAL(20,2),
    "currency" TEXT NOT NULL DEFAULT 'SRD',
    "taxCodeId" TEXT,
    "revenueAccountId" TEXT,
    "planId" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "customerId" TEXT NOT NULL,
    "contactId" TEXT,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "quoteDate" DATE NOT NULL,
    "validUntil" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "paymentTermDays" INTEGER NOT NULL DEFAULT 14,
    "introduction" TEXT,
    "terms" TEXT,
    "notes" TEXT,
    "netAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "grossAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "sentTo" TEXT,
    "viewedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "decisionNote" TEXT,
    "invoiceId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(20,4) NOT NULL,
    "unitPrice" DECIMAL(20,4) NOT NULL,
    "discountPct" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "taxCodeId" TEXT,
    "taxRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(20,2) NOT NULL,
    "taxAmount" DECIMAL(20,2) NOT NULL,

    CONSTRAINT "QuotationLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationRevision" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuotationRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AraSubscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "planId" TEXT,
    "linkedOrganizationId" TEXT,
    "interval" "BillingInterval" NOT NULL,
    "quantity" DECIMAL(20,4) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(20,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "AraSubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "startDate" DATE NOT NULL,
    "trialEndsAt" DATE,
    "nextBillingDate" DATE NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AraSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "details" JSONB,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionBilling" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionBilling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AraPayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT,
    "method" "AraPaymentMethod" NOT NULL,
    "reference" TEXT,
    "paymentDate" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "status" "AraPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "financialAccountId" TEXT NOT NULL,
    "exchangeRate" TEXT,
    "ledgerPaymentId" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "refundedAt" TIMESTAMP(3),
    "refundLedgerPaymentId" TEXT,
    "refundReason" TEXT,
    "evidenceDocumentId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'STAFF',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AraPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AraPaymentAllocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "applied" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AraPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT,
    "requesterOrganizationId" TEXT,
    "requesterUserId" TEXT,
    "subject" TEXT NOT NULL,
    "category" TEXT,
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "assigneeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorKind" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT,
    "entity" TEXT,
    "entityId" TEXT,
    "category" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage" "StorageBackend" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminDocumentBlob" (
    "documentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "AdminDocumentBlob_pkey" PRIMARY KEY ("documentId")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "jobTitle" TEXT,
    "department" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmCustomer_organizationId_stage_idx" ON "CrmCustomer"("organizationId", "stage");

-- CreateIndex
CREATE INDEX "CrmCustomer_linkedOrganizationId_idx" ON "CrmCustomer"("linkedOrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmCustomer_organizationId_number_key" ON "CrmCustomer"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "CrmCustomer_partyId_key" ON "CrmCustomer"("partyId");

-- CreateIndex
CREATE INDEX "CrmContact_organizationId_idx" ON "CrmContact"("organizationId");

-- CreateIndex
CREATE INDEX "CrmContact_customerId_idx" ON "CrmContact"("customerId");

-- CreateIndex
CREATE INDEX "CrmActivity_organizationId_idx" ON "CrmActivity"("organizationId");

-- CreateIndex
CREATE INDEX "CrmActivity_customerId_createdAt_idx" ON "CrmActivity"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Product_organizationId_code_key" ON "Product"("organizationId", "code");

-- CreateIndex
CREATE INDEX "Quotation_organizationId_status_idx" ON "Quotation"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Quotation_customerId_idx" ON "Quotation"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_organizationId_number_key" ON "Quotation"("organizationId", "number");

-- CreateIndex
CREATE INDEX "QuotationLine_organizationId_idx" ON "QuotationLine"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "QuotationLine_quotationId_lineNo_key" ON "QuotationLine"("quotationId", "lineNo");

-- CreateIndex
CREATE INDEX "QuotationRevision_organizationId_idx" ON "QuotationRevision"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "QuotationRevision_quotationId_revision_key" ON "QuotationRevision"("quotationId", "revision");

-- CreateIndex
CREATE INDEX "AraSubscription_organizationId_status_nextBillingDate_idx" ON "AraSubscription"("organizationId", "status", "nextBillingDate");

-- CreateIndex
CREATE UNIQUE INDEX "AraSubscription_organizationId_number_key" ON "AraSubscription"("organizationId", "number");

-- CreateIndex
CREATE INDEX "SubscriptionEvent_organizationId_idx" ON "SubscriptionEvent"("organizationId");

-- CreateIndex
CREATE INDEX "SubscriptionEvent_subscriptionId_createdAt_idx" ON "SubscriptionEvent"("subscriptionId", "createdAt");

-- CreateIndex
CREATE INDEX "SubscriptionBilling_organizationId_idx" ON "SubscriptionBilling"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionBilling_subscriptionId_periodStart_key" ON "SubscriptionBilling"("subscriptionId", "periodStart");

-- CreateIndex
CREATE INDEX "AraPayment_organizationId_status_idx" ON "AraPayment"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AraPayment_organizationId_number_key" ON "AraPayment"("organizationId", "number");

-- CreateIndex
CREATE INDEX "AraPaymentAllocation_organizationId_idx" ON "AraPaymentAllocation"("organizationId");

-- CreateIndex
CREATE INDEX "AraPaymentAllocation_paymentId_idx" ON "AraPaymentAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "SupportTicket_organizationId_status_idx" ON "SupportTicket"("organizationId", "status");

-- CreateIndex
CREATE INDEX "SupportTicket_requesterOrganizationId_idx" ON "SupportTicket"("requesterOrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_organizationId_number_key" ON "SupportTicket"("organizationId", "number");

-- CreateIndex
CREATE INDEX "SupportMessage_organizationId_idx" ON "SupportMessage"("organizationId");

-- CreateIndex
CREATE INDEX "SupportMessage_ticketId_createdAt_idx" ON "SupportMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminDocument_organizationId_idx" ON "AdminDocument"("organizationId");

-- CreateIndex
CREATE INDEX "AdminDocument_customerId_idx" ON "AdminDocument"("customerId");

-- CreateIndex
CREATE INDEX "AdminDocument_entity_entityId_idx" ON "AdminDocument"("entity", "entityId");

-- CreateIndex
CREATE INDEX "Employee_organizationId_idx" ON "Employee"("organizationId");

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CrmCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CrmCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CrmCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationRevision" ADD CONSTRAINT "QuotationRevision_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AraSubscription" ADD CONSTRAINT "AraSubscription_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CrmCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionEvent" ADD CONSTRAINT "SubscriptionEvent_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "AraSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionBilling" ADD CONSTRAINT "SubscriptionBilling_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "AraSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AraPaymentAllocation" ADD CONSTRAINT "AraPaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "AraPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───────────── Isolation: every admin-portal table is tenant data of ARA's own organisation ─────────────
SELECT ara_enable_tenant_rls('"CrmCustomer"');
SELECT ara_enable_tenant_rls('"CrmContact"');
SELECT ara_enable_tenant_rls('"CrmActivity"');
SELECT ara_enable_tenant_rls('"Product"');
SELECT ara_enable_tenant_rls('"Quotation"');
SELECT ara_enable_tenant_rls('"QuotationLine"');
SELECT ara_enable_tenant_rls('"QuotationRevision"');
SELECT ara_enable_tenant_rls('"AraSubscription"');
SELECT ara_enable_tenant_rls('"SubscriptionEvent"');
SELECT ara_enable_tenant_rls('"SubscriptionBilling"');
SELECT ara_enable_tenant_rls('"AraPayment"');
SELECT ara_enable_tenant_rls('"AraPaymentAllocation"');
SELECT ara_enable_tenant_rls('"SupportTicket"');
SELECT ara_enable_tenant_rls('"SupportMessage"');
SELECT ara_enable_tenant_rls('"AdminDocument"');
SELECT ara_enable_tenant_rls('"AdminDocumentBlob"');
SELECT ara_enable_tenant_rls('"Employee"');

-- ───────────── Evidence and history are append-only ─────────────
CREATE TRIGGER quotation_revision_append_only BEFORE UPDATE OR DELETE ON "QuotationRevision" FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER subscription_event_append_only BEFORE UPDATE OR DELETE ON "SubscriptionEvent" FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER subscription_billing_append_only BEFORE UPDATE OR DELETE ON "SubscriptionBilling" FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER support_message_append_only BEFORE UPDATE OR DELETE ON "SupportMessage" FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER admin_document_append_only BEFORE UPDATE OR DELETE ON "AdminDocument" FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER admin_document_blob_append_only BEFORE UPDATE OR DELETE ON "AdminDocumentBlob" FOR EACH ROW EXECUTE FUNCTION append_only();

-- CRM activities: only completing a task (doneAt) may change; nothing is deleted.
CREATE OR REPLACE FUNCTION crm_activity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'CRM activities cannot be deleted' USING ERRCODE = 'integrity_constraint_violation'; END IF;
  IF (to_jsonb(OLD) - 'doneAt') <> (to_jsonb(NEW) - 'doneAt') THEN
    RAISE EXCEPTION 'CRM activities are append-only (only a task can be completed)' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_activity_guard BEFORE UPDATE OR DELETE ON "CrmActivity" FOR EACH ROW EXECUTE FUNCTION crm_activity_guard();

-- Payments: a confirmed payment keeps its amount, currency, date and account; nothing is deleted once confirmed.
CREATE OR REPLACE FUNCTION ara_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'PENDING' THEN RAISE EXCEPTION 'Only pending payments can be removed' USING ERRCODE = 'integrity_constraint_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('CONFIRMED', 'REFUNDED') AND (NEW.amount <> OLD.amount OR NEW.currency <> OLD.currency OR NEW."paymentDate" <> OLD."paymentDate"
      OR NEW."financialAccountId" <> OLD."financialAccountId" OR NEW."ledgerPaymentId" IS DISTINCT FROM OLD."ledgerPaymentId") THEN
    RAISE EXCEPTION 'A confirmed payment is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status = 'REFUNDED' AND NEW.status <> 'REFUNDED' THEN RAISE EXCEPTION 'A refunded payment cannot change status' USING ERRCODE = 'integrity_constraint_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ara_payment_guard BEFORE UPDATE OR DELETE ON "AraPayment" FOR EACH ROW EXECUTE FUNCTION ara_payment_guard();
ALTER TABLE "AraPayment" ADD CONSTRAINT ara_payment_positive CHECK (amount > 0);
ALTER TABLE "AraPayment" ADD CONSTRAINT ara_payment_confirmed_evidence CHECK (status NOT IN ('CONFIRMED', 'REFUNDED') OR ("ledgerPaymentId" IS NOT NULL AND "confirmedById" IS NOT NULL AND "confirmedAt" IS NOT NULL));
ALTER TABLE "AraPaymentAllocation" ADD CONSTRAINT ara_allocation_positive CHECK (amount > 0);
ALTER TABLE "QuotationLine" ADD CONSTRAINT quotation_line_discount CHECK ("discountPct" >= 0 AND "discountPct" <= 100);
ALTER TABLE "Product" ADD CONSTRAINT product_price_non_negative CHECK ("defaultPrice" IS NULL OR "defaultPrice" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT product_interval CHECK (("billingType" = 'RECURRING') = ("billingInterval" IS NOT NULL));
ALTER TABLE "AraSubscription" ADD CONSTRAINT subscription_price_non_negative CHECK ("unitPrice" >= 0 AND quantity > 0);
