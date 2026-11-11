-- Subscription fields are set by the platform only: the tenant role (ara_app) may not change them.
CREATE OR REPLACE FUNCTION organization_subscription_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'ara_app' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW."planId" IS DISTINCT FROM OLD."planId"
      OR NEW."trialEndsAt" IS DISTINCT FROM OLD."trialEndsAt" OR NEW."statusReason" IS DISTINCT FROM OLD."statusReason") THEN
    RAISE EXCEPTION 'Subscription fields can only be changed by the platform' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER organization_subscription_guard BEFORE UPDATE ON "Organization" FOR EACH ROW EXECUTE FUNCTION organization_subscription_guard();
