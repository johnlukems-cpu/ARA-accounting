-- Phase 3C: RLS and integrity for current accounts and fixed assets.
SELECT ara_enable_tenant_rls('"CurrentAccount"');
SELECT ara_enable_tenant_rls('"CurrentAccountConfirmation"');
SELECT ara_enable_tenant_rls('"AssetCategory"');
SELECT ara_enable_tenant_rls('"Asset"');
SELECT ara_enable_tenant_rls('"DepreciationLine"');
SELECT ara_enable_tenant_rls('"AssetTransaction"');

ALTER TABLE "Asset" ADD CONSTRAINT asset_cost_positive CHECK ("acquisitionCost" > 0);
ALTER TABLE "Asset" ADD CONSTRAINT asset_residual_bounds CHECK ("residualValue" >= 0 AND "residualValue" < "acquisitionCost");
ALTER TABLE "Asset" ADD CONSTRAINT asset_life_positive CHECK ("usefulLifeMonths" BETWEEN 1 AND 1200);
ALTER TABLE "Asset" ADD CONSTRAINT asset_start_first_of_month CHECK (extract(day from "depreciationStart") = 1);
ALTER TABLE "DepreciationLine" ADD CONSTRAINT depreciation_month CHECK (month BETWEEN 1 AND 12);
ALTER TABLE "DepreciationLine" ADD CONSTRAINT depreciation_positive CHECK (amount > 0);
CREATE TRIGGER asset_transaction_append_only BEFORE UPDATE OR DELETE ON "AssetTransaction" FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER current_account_confirmation_append_only BEFORE UPDATE OR DELETE ON "CurrentAccountConfirmation" FOR EACH ROW EXECUTE FUNCTION append_only();

-- A depreciation line whose journal entry is posted can never be removed.
CREATE OR REPLACE FUNCTION depreciation_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "JournalEntry" WHERE id = OLD."entryId" AND status = 'POSTED') THEN
    RAISE EXCEPTION 'Depreciation of a posted entry cannot be changed' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER depreciation_line_guard BEFORE UPDATE OR DELETE ON "DepreciationLine" FOR EACH ROW EXECUTE FUNCTION depreciation_line_guard();
