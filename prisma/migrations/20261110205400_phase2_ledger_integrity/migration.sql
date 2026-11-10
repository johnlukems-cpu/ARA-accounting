-- ARA Accounting — Phase 2 ledger integrity (docs/ACCOUNTING_RULES.md L1–L3, P2, P5, F2).
-- These rules hold even if application code is bypassed.

SELECT ara_enable_tenant_rls('"Account"');
SELECT ara_enable_tenant_rls('"Journal"');
SELECT ara_enable_tenant_rls('"JournalEntry"');
SELECT ara_enable_tenant_rls('"JournalLine"');
SELECT ara_enable_tenant_rls('"DimensionValue"');
SELECT ara_enable_tenant_rls('"NumberSequence"');

-- L2: a line is either a debit or a credit, strictly positive, never both.
ALTER TABLE "JournalLine" ADD CONSTRAINT line_one_side CHECK (
  "debitBase" >= 0 AND "creditBase" >= 0 AND (("debitBase" > 0) <> ("creditBase" > 0))
);
ALTER TABLE "JournalLine" ADD CONSTRAINT line_rate_positive CHECK ("exchangeRate" > 0);
ALTER TABLE "JournalLine" ADD CONSTRAINT line_currency_iso CHECK ("txCurrency" ~ '^[A-Z]{3}$');
ALTER TABLE "JournalEntry" ADD CONSTRAINT entry_number_when_posted CHECK (("status" = 'POSTED') = ("entryNumber" IS NOT NULL));
ALTER TABLE "JournalEntry" ADD CONSTRAINT entry_not_self_reversing CHECK ("reversesEntryId" IS DISTINCT FROM id);

-- P2: posted entries and their lines are immutable. The only permitted change is linking the
-- reversing entry once (reversedByEntryId NULL → value).
CREATE OR REPLACE FUNCTION journal_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'POSTED' THEN
      RAISE EXCEPTION 'Posted journal entry % cannot be deleted', OLD.id USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'POSTED' THEN
    IF OLD."reversedByEntryId" IS NULL AND NEW."reversedByEntryId" IS NOT NULL
       AND (to_jsonb(OLD) - 'reversedByEntryId' - 'updatedAt') = (to_jsonb(NEW) - 'reversedByEntryId' - 'updatedAt') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Posted journal entry % is immutable; use a reversal or correction entry', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_entry_guard BEFORE UPDATE OR DELETE ON "JournalEntry"
  FOR EACH ROW EXECUTE FUNCTION journal_entry_guard();

CREATE OR REPLACE FUNCTION journal_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  entry_status "EntryStatus";
  entry_admin text;
  acc RECORD;
BEGIN
  SELECT status, "administrationId" INTO entry_status, entry_admin
    FROM "JournalEntry" WHERE id = COALESCE(NEW."entryId", OLD."entryId");
  IF entry_status = 'POSTED' THEN
    RAISE EXCEPTION 'Lines of a posted journal entry are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  -- L3: only active detail accounts of the same administration.
  SELECT "administrationId", type, status INTO acc FROM "Account" WHERE id = NEW."accountId";
  IF acc."administrationId" IS DISTINCT FROM entry_admin OR NEW."administrationId" IS DISTINCT FROM entry_admin THEN
    RAISE EXCEPTION 'Journal line account belongs to another administration' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF acc.type <> 'DETAIL' OR acc.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Postings are only allowed on active detail accounts' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_line_guard BEFORE INSERT OR UPDATE OR DELETE ON "JournalLine"
  FOR EACH ROW EXECUTE FUNCTION journal_line_guard();

-- F2: an entry can only become POSTED in a period that is not CLOSED, of a fiscal year that is not CLOSED,
-- and its date must fall inside that period.
CREATE OR REPLACE FUNCTION journal_entry_period_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p RECORD;
BEGIN
  IF NEW.status = 'POSTED' AND (TG_OP = 'INSERT' OR OLD.status <> 'POSTED') THEN
    SELECT ap.status, ap."startDate", ap."endDate", ap."fiscalYearId", fy.status AS fy_status, fy."administrationId"
      INTO p
      FROM "AccountingPeriod" ap JOIN "FiscalYear" fy ON fy.id = ap."fiscalYearId"
     WHERE ap.id = NEW."periodId";
    IF p IS NULL OR p."fiscalYearId" <> NEW."fiscalYearId" OR p."administrationId" <> NEW."administrationId" THEN
      RAISE EXCEPTION 'Journal entry period does not belong to its fiscal year/administration' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF p.status = 'CLOSED' OR p.fy_status = 'CLOSED' THEN
      RAISE EXCEPTION 'Cannot post into a closed period' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW."entryDate" < p."startDate" OR NEW."entryDate" > p."endDate" THEN
      RAISE EXCEPTION 'Entry date % is outside its period', NEW."entryDate" USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_entry_period_check BEFORE INSERT OR UPDATE ON "JournalEntry"
  FOR EACH ROW EXECUTE FUNCTION journal_entry_period_check();

-- L1: at commit, every posted entry has ≥ 2 lines and Σ debit = Σ credit (base currency), equal to its header totals.
CREATE OR REPLACE FUNCTION journal_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  d numeric;
  c numeric;
  n int;
  st "EntryStatus";
  hd numeric;
  hc numeric;
BEGIN
  SELECT status, "totalDebitBase", "totalCreditBase" INTO st, hd, hc FROM "JournalEntry" WHERE id = NEW.id;
  IF st IS DISTINCT FROM 'POSTED' THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(SUM("debitBase"), 0), COALESCE(SUM("creditBase"), 0), COUNT(*) INTO d, c, n
    FROM "JournalLine" WHERE "entryId" = NEW.id;
  IF n < 2 OR d <> c OR d = 0 OR d <> hd OR c <> hc THEN
    RAISE EXCEPTION 'Journal entry % is not balanced (debit %, credit %, lines %)', NEW.id, d, c, n
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_entry_balanced AFTER INSERT OR UPDATE ON "JournalEntry"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_entry_balanced();

-- Accounts that carry postings cannot be deleted (archive instead) — enforced by the FK from JournalLine.
-- Fiscal years / periods referenced by entries must not disappear.
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AccountingPeriod"(id) ON DELETE RESTRICT;
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"(id) ON DELETE RESTRICT;
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_reversesEntryId_fkey" FOREIGN KEY ("reversesEntryId") REFERENCES "JournalEntry"(id) ON DELETE RESTRICT;
