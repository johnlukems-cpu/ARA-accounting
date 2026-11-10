-- ARA Accounting — Phase 1 security: tenant role, row-level security, append-only hash-chained audit log,
-- fiscal-year overlap prevention. See docs/SECURITY.md §3 and docs/DATABASE_SCHEMA.md §5.

-- 1. Application role. The app connects as the database owner and switches to ara_app with
--    SET LOCAL ROLE inside every tenant transaction, so row-level security always applies there.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ara_app') THEN
    CREATE ROLE ara_app NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT ara_app TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO ara_app;

-- 2. Session variables set by the tenant client per transaction.
CREATE OR REPLACE FUNCTION app_org() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.org_id', true), '') $$;
CREATE OR REPLACE FUNCTION app_user() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.user_id', true), '') $$;
GRANT EXECUTE ON FUNCTION app_org(), app_user() TO ara_app;

-- 3. Helper used by this and later migrations: standard tenant policy on "organizationId".
CREATE OR REPLACE FUNCTION ara_enable_tenant_rls(tbl regclass) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', tbl);
  EXECUTE format('CREATE POLICY tenant_isolation ON %s TO ara_app USING ("organizationId" = app_org()) WITH CHECK ("organizationId" = app_org())', tbl);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO ara_app', tbl);
END $$;

SELECT ara_enable_tenant_rls('"Company"');
SELECT ara_enable_tenant_rls('"CompanyAssignment"');
SELECT ara_enable_tenant_rls('"Branch"');
SELECT ara_enable_tenant_rls('"Administration"');
SELECT ara_enable_tenant_rls('"FiscalYear"');
SELECT ara_enable_tenant_rls('"AccountingPeriod"');
SELECT ara_enable_tenant_rls('"Notification"');

-- Organization: visible when it is the active organisation or the user is a member; writable only when active.
ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_read ON "Organization" FOR SELECT TO ara_app USING (
  id = app_org() OR id IN (SELECT "organizationId" FROM "OrganizationMembership" WHERE "userId" = app_user())
);
CREATE POLICY org_write ON "Organization" FOR UPDATE TO ara_app USING (id = app_org()) WITH CHECK (id = app_org());
GRANT SELECT, UPDATE ON "Organization" TO ara_app;

-- Memberships: own memberships (organisation switcher) or those of the active organisation.
ALTER TABLE "OrganizationMembership" ENABLE ROW LEVEL SECURITY;
CREATE POLICY membership_read ON "OrganizationMembership" FOR SELECT TO ara_app
  USING ("organizationId" = app_org() OR "userId" = app_user());
CREATE POLICY membership_write ON "OrganizationMembership" FOR ALL TO ara_app
  USING ("organizationId" = app_org()) WITH CHECK ("organizationId" = app_org());
GRANT SELECT, INSERT, UPDATE, DELETE ON "OrganizationMembership" TO ara_app;

-- Roles: system roles (organizationId null) are readable by all and never writable by tenants.
ALTER TABLE "Role" ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_read ON "Role" FOR SELECT TO ara_app USING ("organizationId" IS NULL OR "organizationId" = app_org());
CREATE POLICY role_write ON "Role" FOR ALL TO ara_app USING ("organizationId" = app_org()) WITH CHECK ("organizationId" = app_org());
GRANT SELECT, INSERT, UPDATE, DELETE ON "Role" TO ara_app;

ALTER TABLE "RolePermission" ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_permission_read ON "RolePermission" FOR SELECT TO ara_app USING ("roleId" IN (SELECT id FROM "Role"));
CREATE POLICY role_permission_write ON "RolePermission" FOR ALL TO ara_app
  USING ("roleId" IN (SELECT id FROM "Role" WHERE "organizationId" = app_org()))
  WITH CHECK ("roleId" IN (SELECT id FROM "Role" WHERE "organizationId" = app_org()));
GRANT SELECT, INSERT, UPDATE, DELETE ON "RolePermission" TO ara_app;

-- Users: yourself and members of the active organisation. Tenants may only change name and locale.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_read ON "User" FOR SELECT TO ara_app USING (
  id = app_user() OR id IN (SELECT "userId" FROM "OrganizationMembership" WHERE "organizationId" = app_org())
);
CREATE POLICY user_update_self ON "User" FOR UPDATE TO ara_app USING (id = app_user()) WITH CHECK (id = app_user());
GRANT SELECT ON "User" TO ara_app;
GRANT UPDATE (name, locale) ON "User" TO ara_app;
-- Session, UserToken and LoginAttempt are deliberately not granted to ara_app.

-- 4. Audit log: append-only, hash chain per organisation computed by the database.
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON "AuditLog" FOR SELECT TO ara_app USING ("organizationId" = app_org());
CREATE POLICY audit_insert ON "AuditLog" FOR INSERT TO ara_app WITH CHECK ("organizationId" = app_org());
GRANT SELECT, INSERT ON "AuditLog" TO ara_app;
GRANT USAGE, SELECT ON SEQUENCE "AuditLog_seq_seq" TO ara_app;

CREATE OR REPLACE FUNCTION audit_log_hash(prev text, seq bigint, org text, usr text, action text, entity text,
                                          entity_id text, details jsonb, created timestamp) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(concat_ws('|', prev, seq::text, COALESCE(org, ''), COALESCE(usr, ''), action,
    entity, COALESCE(entity_id, ''), COALESCE(details::text, ''), to_char(created, 'YYYY-MM-DD"T"HH24:MI:SS.US')), 'UTF8')), 'hex')
$$;
GRANT EXECUTE ON FUNCTION audit_log_hash(text, bigint, text, text, text, text, text, jsonb, timestamp) TO ara_app;

CREATE OR REPLACE FUNCTION audit_log_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit:' || COALESCE(NEW."organizationId", 'platform')));
  SELECT hash INTO previous FROM "AuditLog"
   WHERE "organizationId" IS NOT DISTINCT FROM NEW."organizationId"
   ORDER BY seq DESC LIMIT 1;
  NEW."prevHash" := COALESCE(previous, '');
  NEW."createdAt" := COALESCE(NEW."createdAt", now());
  NEW.hash := audit_log_hash(NEW."prevHash", NEW.seq, NEW."organizationId", NEW."userId", NEW.action,
                             NEW.entity, NEW."entityId", NEW.details, NEW."createdAt");
  RETURN NEW;
END $$;
CREATE TRIGGER audit_log_chain BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION audit_log_chain();

CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only (% blocked)', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "AuditLog" FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();

-- 5. Fiscal years and periods.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "FiscalYear" ADD CONSTRAINT fiscal_year_dates CHECK ("endDate" >= "startDate");
ALTER TABLE "FiscalYear" ADD CONSTRAINT fiscal_year_no_overlap
  EXCLUDE USING gist ("administrationId" WITH =, daterange("startDate", "endDate", '[]') WITH &&);
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT period_number_range CHECK (number BETWEEN 0 AND 13);
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT period_dates CHECK ("endDate" >= "startDate");

-- 6. Currency codes are ISO 4217 (three capital letters).
ALTER TABLE "Administration" ADD CONSTRAINT administration_currency_iso CHECK ("baseCurrency" ~ '^[A-Z]{3}$');
