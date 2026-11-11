-- Phase 6: tenant isolation and integrity for budgets.
SELECT ara_enable_tenant_rls('"Budget"');
SELECT ara_enable_tenant_rls('"BudgetVersion"');
SELECT ara_enable_tenant_rls('"BudgetLine"');

ALTER TABLE "BudgetLine" ADD CONSTRAINT budget_line_period CHECK (period BETWEEN 1 AND 12);
ALTER TABLE "Budget" ADD CONSTRAINT budget_threshold CHECK ("alertThresholdPct" >= 0 AND "alertThresholdPct" <= 1000);
ALTER TABLE "BudgetVersion" ADD CONSTRAINT budget_version_approval CHECK ((status IN ('APPROVED', 'SUPERSEDED')) = ("approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL));

-- B3: approved versions are immutable; the only change allowed is APPROVED → SUPERSEDED when a newer version is approved.
CREATE OR REPLACE FUNCTION budget_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('APPROVED', 'SUPERSEDED') THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'An approved budget version cannot be deleted' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NOT (OLD.status = 'APPROVED' AND NEW.status = 'SUPERSEDED' AND NEW.version = OLD.version AND NEW.basis = OLD.basis
            AND NEW."adjustmentPct" = OLD."adjustmentPct" AND NEW."approvedById" = OLD."approvedById" AND NEW."approvedAt" = OLD."approvedAt") THEN
      RAISE EXCEPTION 'An approved budget version is immutable' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER budget_version_guard BEFORE UPDATE OR DELETE ON "BudgetVersion" FOR EACH ROW EXECUTE FUNCTION budget_version_guard();

CREATE OR REPLACE FUNCTION budget_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "BudgetVersion" WHERE id = COALESCE(NEW."versionId", OLD."versionId") AND status IN ('SUBMITTED', 'APPROVED', 'SUPERSEDED')) THEN
    RAISE EXCEPTION 'Lines of a submitted or approved budget version are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER budget_line_guard BEFORE INSERT OR UPDATE OR DELETE ON "BudgetLine" FOR EACH ROW EXECUTE FUNCTION budget_line_guard();
