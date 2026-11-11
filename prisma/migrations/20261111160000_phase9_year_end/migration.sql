-- CreateEnum
CREATE TYPE "YearEndStatus" AS ENUM ('IN_PROGRESS', 'REVIEW', 'APPROVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChecklistStatus" AS ENUM ('OPEN', 'COMPLETED', 'NOT_APPLICABLE');

-- CreateTable
CREATE TABLE "YearEndClosing" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "administrationId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "status" "YearEndStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "submittedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "closingEntryId" TEXT,
    "openingEntryId" TEXT,
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "YearEndClosing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YearEndChecklistItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "closingId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "mandatory" BOOLEAN NOT NULL,
    "status" "ChecklistStatus" NOT NULL DEFAULT 'OPEN',
    "comment" TEXT,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "YearEndChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "YearEndClosing_fiscalYearId_key" ON "YearEndClosing"("fiscalYearId");

-- CreateIndex
CREATE INDEX "YearEndClosing_organizationId_idx" ON "YearEndClosing"("organizationId");

-- CreateIndex
CREATE INDEX "YearEndChecklistItem_organizationId_idx" ON "YearEndChecklistItem"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "YearEndChecklistItem_closingId_code_key" ON "YearEndChecklistItem"("closingId", "code");

-- AddForeignKey
ALTER TABLE "YearEndChecklistItem" ADD CONSTRAINT "YearEndChecklistItem_closingId_fkey" FOREIGN KEY ("closingId") REFERENCES "YearEndClosing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation; a closed year-end and its checklist can only change through reopening (status leaves CLOSED first).
SELECT ara_enable_tenant_rls('"YearEndClosing"');
SELECT ara_enable_tenant_rls('"YearEndChecklistItem"');
ALTER TABLE "YearEndClosing" ADD CONSTRAINT year_end_approved CHECK (status NOT IN ('APPROVED', 'CLOSED') OR ("approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL));
ALTER TABLE "YearEndClosing" ADD CONSTRAINT year_end_closed CHECK (status <> 'CLOSED' OR ("closingEntryId" IS NOT NULL AND "openingEntryId" IS NOT NULL AND "closedAt" IS NOT NULL));
CREATE OR REPLACE FUNCTION year_end_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "YearEndClosing" WHERE id = COALESCE(NEW."closingId", OLD."closingId") AND status IN ('APPROVED', 'CLOSED')) THEN
    RAISE EXCEPTION 'The checklist of an approved or closed year-end is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER year_end_item_guard BEFORE UPDATE OR DELETE ON "YearEndChecklistItem" FOR EACH ROW EXECUTE FUNCTION year_end_item_guard();
CREATE TRIGGER year_end_no_delete BEFORE DELETE ON "YearEndClosing" FOR EACH ROW EXECUTE FUNCTION append_only();
