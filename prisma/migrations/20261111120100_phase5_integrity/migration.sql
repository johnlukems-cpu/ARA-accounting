-- Phase 5: tenant isolation and integrity for exchange rates and revaluations.
SELECT ara_enable_tenant_rls('"ExchangeRate"');
SELECT ara_enable_tenant_rls('"CurrencyRevaluation"');

ALTER TABLE "ExchangeRate" ADD CONSTRAINT rate_positive CHECK (rate > 0);
ALTER TABLE "ExchangeRate" ADD CONSTRAINT rate_currencies CHECK (currency ~ '^[A-Z]{3}$' AND "baseCurrency" ~ '^[A-Z]{3}$' AND currency <> "baseCurrency");
ALTER TABLE "ExchangeRate" ADD CONSTRAINT rate_approval CHECK ((status = 'APPROVED') = ("approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL) OR status = 'REJECTED');

-- One pending or approved rate per organisation, pair, type and date (rejected rates may be re-entered).
CREATE UNIQUE INDEX exchange_rate_active ON "ExchangeRate" ("organizationId", "baseCurrency", currency, "rateType", "effectiveDate") WHERE status <> 'REJECTED';

-- Decided rates never change and are never deleted: they are evidence for the postings that used them.
CREATE OR REPLACE FUNCTION exchange_rate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'An approved or rejected exchange rate is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.rate <> OLD.rate OR NEW.currency <> OLD.currency OR NEW."baseCurrency" <> OLD."baseCurrency" OR NEW."rateType" <> OLD."rateType" OR NEW."effectiveDate" <> OLD."effectiveDate") THEN
    RAISE EXCEPTION 'Only the status of a pending exchange rate can change' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER exchange_rate_guard BEFORE UPDATE OR DELETE ON "ExchangeRate" FOR EACH ROW EXECUTE FUNCTION exchange_rate_guard();

-- C6: at most one proposed or posted revaluation per administration, period and scope.
CREATE UNIQUE INDEX currency_revaluation_one_active ON "CurrencyRevaluation" ("administrationId", "periodId", scope) WHERE status IN ('PROPOSED', 'POSTED');
CREATE TRIGGER currency_revaluation_no_delete BEFORE DELETE ON "CurrencyRevaluation" FOR EACH ROW EXECUTE FUNCTION append_only();
