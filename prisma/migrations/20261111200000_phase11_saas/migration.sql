-- CreateEnum
CREATE TYPE "SubscriptionInvoiceStatus" AS ENUM ('OPEN', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'DONE');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "planId" TEXT,
ADD COLUMN     "statusReason" TEXT,
ADD COLUMN     "trialEndsAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "limits" JSONB NOT NULL DEFAULT '{}',
    "priceMonthlySrd" DECIMAL(20,2),
    "priceMonthlyUsd" DECIMAL(20,2),
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionInvoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT,
    "number" TEXT NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "status" "SubscriptionInvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "paidAt" TIMESTAMP(3),
    "paymentReference" TEXT,
    "confirmedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeTask" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" DATE,
    "assigneeId" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionInvoice_number_key" ON "SubscriptionInvoice"("number");

-- CreateIndex
CREATE INDEX "SubscriptionInvoice_organizationId_idx" ON "SubscriptionInvoice"("organizationId");

-- CreateIndex
CREATE INDEX "PracticeTask_organizationId_status_idx" ON "PracticeTask"("organizationId", "status");

-- Plans: platform data, readable by tenants, written only by trusted platform code.
ALTER TABLE "Plan" ENABLE ROW LEVEL SECURITY;
CREATE POLICY plan_read ON "Plan" FOR SELECT TO ara_app USING (true);
GRANT SELECT ON "Plan" TO ara_app;
-- Subscription invoices: an organisation reads its own; only the platform (system code) writes them.
ALTER TABLE "SubscriptionInvoice" ENABLE ROW LEVEL SECURITY;
CREATE POLICY subscription_invoice_read ON "SubscriptionInvoice" FOR SELECT TO ara_app USING ("organizationId" = app_org());
GRANT SELECT ON "SubscriptionInvoice" TO ara_app;
ALTER TABLE "SubscriptionInvoice" ADD CONSTRAINT subscription_invoice_paid CHECK (status <> 'PAID' OR ("paidAt" IS NOT NULL AND "confirmedById" IS NOT NULL));
ALTER TABLE "SubscriptionInvoice" ADD CONSTRAINT subscription_invoice_amount CHECK (amount > 0);
CREATE TRIGGER subscription_invoice_no_delete BEFORE DELETE ON "SubscriptionInvoice" FOR EACH ROW EXECUTE FUNCTION append_only();
SELECT ara_enable_tenant_rls('"PracticeTask"');
