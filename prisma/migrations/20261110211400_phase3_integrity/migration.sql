-- ARA Accounting — Phase 3 integrity: RLS, duplicate guards, open-item consistency.

SELECT ara_enable_tenant_rls('"Party"');
SELECT ara_enable_tenant_rls('"TaxCode"');
SELECT ara_enable_tenant_rls('"FinancialAccount"');
SELECT ara_enable_tenant_rls('"Invoice"');
SELECT ara_enable_tenant_rls('"InvoiceLine"');
SELECT ara_enable_tenant_rls('"OpenItem"');
SELECT ara_enable_tenant_rls('"Payment"');
SELECT ara_enable_tenant_rls('"Allocation"');

-- A supplier invoice number can be registered only once per supplier and kind (AI3 / duplicate invoices).
CREATE UNIQUE INDEX invoice_purchase_external_unique
  ON "Invoice" ("administrationId", "partyId", lower("externalNumber"), kind)
  WHERE type = 'PURCHASE' AND "externalNumber" IS NOT NULL;

ALTER TABLE "Invoice" ADD CONSTRAINT invoice_rate_positive CHECK ("exchangeRate" > 0);
ALTER TABLE "Invoice" ADD CONSTRAINT invoice_currency_iso CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE "Invoice" ADD CONSTRAINT invoice_due_after_date CHECK ("dueDate" >= "invoiceDate");
ALTER TABLE "Invoice" ADD CONSTRAINT invoice_posted_has_entry CHECK (status IN ('DRAFT', 'REVIEW', 'APPROVED') OR "entryId" IS NOT NULL);
ALTER TABLE "InvoiceLine" ADD CONSTRAINT invoice_line_quantity CHECK (quantity <> 0);
ALTER TABLE "Payment" ADD CONSTRAINT payment_amount_positive CHECK (amount > 0);
ALTER TABLE "Allocation" ADD CONSTRAINT allocation_amount_positive CHECK (amount > 0);
ALTER TABLE "Allocation" ADD CONSTRAINT allocation_has_counterpart CHECK (("paymentId" IS NOT NULL) <> ("counterOpenItemId" IS NOT NULL));

-- Remaining amount never exceeds the original and never changes sign (no over-allocation).
ALTER TABLE "OpenItem" ADD CONSTRAINT open_item_remaining_bounds CHECK (
  ("originalAmount" >= 0 AND "remainingAmount" >= 0 AND "remainingAmount" <= "originalAmount") OR
  ("originalAmount" <  0 AND "remainingAmount" <= 0 AND "remainingAmount" >= "originalAmount")
);
ALTER TABLE "OpenItem" ADD CONSTRAINT open_item_status_consistent CHECK ((status = 'SETTLED') = ("remainingAmount" = 0));

-- Posted invoices are immutable apart from payment status, delivery data and their entry link.
CREATE OR REPLACE FUNCTION invoice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status NOT IN ('DRAFT', 'REVIEW', 'APPROVED') THEN
      RAISE EXCEPTION 'Posted invoice % cannot be deleted; issue a credit note', OLD.id USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status NOT IN ('DRAFT', 'REVIEW', 'APPROVED')
     AND (to_jsonb(OLD) - 'status' - 'sentAt' - 'sentTo' - 'updatedAt' - 'documentId')
      <> (to_jsonb(NEW) - 'status' - 'sentAt' - 'sentTo' - 'updatedAt' - 'documentId') THEN
    RAISE EXCEPTION 'Posted invoice % is immutable; issue a credit note', OLD.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoice_guard BEFORE UPDATE OR DELETE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION invoice_guard();

CREATE OR REPLACE FUNCTION invoice_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st "InvoiceStatus";
BEGIN
  SELECT status INTO st FROM "Invoice" WHERE id = COALESCE(NEW."invoiceId", OLD."invoiceId");
  IF st NOT IN ('DRAFT', 'REVIEW', 'APPROVED') THEN
    RAISE EXCEPTION 'Lines of a posted invoice are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER invoice_line_guard BEFORE INSERT OR UPDATE OR DELETE ON "InvoiceLine" FOR EACH ROW EXECUTE FUNCTION invoice_line_guard();

-- Allocations and payments are history: never updated or deleted (corrections are reversing entries).
CREATE OR REPLACE FUNCTION append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END $$;
CREATE TRIGGER allocation_append_only BEFORE UPDATE OR DELETE ON "Allocation" FOR EACH ROW EXECUTE FUNCTION append_only();
