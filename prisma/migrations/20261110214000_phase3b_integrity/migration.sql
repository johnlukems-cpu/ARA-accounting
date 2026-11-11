-- Phase 3B: RLS and integrity for bank statements and reconciliation.
SELECT ara_enable_tenant_rls('"BankStatement"');
SELECT ara_enable_tenant_rls('"BankTransaction"');
SELECT ara_enable_tenant_rls('"BankMatch"');
SELECT ara_enable_tenant_rls('"BankReconciliation"');

ALTER TABLE "BankTransaction" ADD CONSTRAINT bank_tx_nonzero CHECK (amount <> 0);
ALTER TABLE "BankTransaction" ADD CONSTRAINT bank_tx_matched_bounds CHECK ("matchedAmount" >= 0 AND "matchedAmount" <= abs(amount));
ALTER TABLE "BankMatch" ADD CONSTRAINT bank_match_target CHECK (("paymentId" IS NOT NULL) <> ("entryId" IS NOT NULL));
ALTER TABLE "BankMatch" ADD CONSTRAINT bank_match_positive CHECK (amount > 0);
CREATE TRIGGER bank_match_append_only BEFORE UPDATE OR DELETE ON "BankMatch" FOR EACH ROW EXECUTE FUNCTION append_only();

-- Imported statement lines are evidence: their content never changes (only status/matching fields do).
CREATE OR REPLACE FUNCTION bank_transaction_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Imported bank transactions cannot be deleted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (to_jsonb(OLD) - 'status' - 'matchedAmount' - 'ignoreReason') <> (to_jsonb(NEW) - 'status' - 'matchedAmount' - 'ignoreReason') THEN
    RAISE EXCEPTION 'Imported bank transaction content is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bank_transaction_guard BEFORE UPDATE OR DELETE ON "BankTransaction" FOR EACH ROW EXECUTE FUNCTION bank_transaction_guard();
