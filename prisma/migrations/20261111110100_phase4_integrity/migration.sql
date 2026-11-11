-- Phase 4: tenant rules and immutability for industry templates.

-- Platform templates (ownerOrganizationId IS NULL) have one row per code.
CREATE UNIQUE INDEX industry_template_platform_code ON "IndustryTemplate" (code) WHERE "ownerOrganizationId" IS NULL;

-- Platform templates are readable by every tenant and never writable by tenants; custom templates belong to one organisation.
ALTER TABLE "IndustryTemplate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY template_read ON "IndustryTemplate" FOR SELECT TO ara_app USING ("ownerOrganizationId" IS NULL OR "ownerOrganizationId" = app_org());
CREATE POLICY template_write ON "IndustryTemplate" FOR ALL TO ara_app USING ("ownerOrganizationId" = app_org()) WITH CHECK ("ownerOrganizationId" = app_org());
GRANT SELECT, INSERT, UPDATE, DELETE ON "IndustryTemplate" TO ara_app;

ALTER TABLE "IndustryTemplateVersion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY template_version_read ON "IndustryTemplateVersion" FOR SELECT TO ara_app USING ("ownerOrganizationId" IS NULL OR "ownerOrganizationId" = app_org());
CREATE POLICY template_version_write ON "IndustryTemplateVersion" FOR ALL TO ara_app USING ("ownerOrganizationId" = app_org()) WITH CHECK ("ownerOrganizationId" = app_org());
GRANT SELECT, INSERT, UPDATE, DELETE ON "IndustryTemplateVersion" TO ara_app;

-- A version's owner must match its template's owner.
CREATE OR REPLACE FUNCTION template_version_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."ownerOrganizationId" IS DISTINCT FROM (SELECT "ownerOrganizationId" FROM "IndustryTemplate" WHERE id = NEW."templateId") THEN
    RAISE EXCEPTION 'Template version owner mismatch' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER template_version_owner BEFORE INSERT OR UPDATE ON "IndustryTemplateVersion" FOR EACH ROW EXECUTE FUNCTION template_version_owner();

-- Published versions are immutable (content, number, status) and cannot be deleted.
CREATE OR REPLACE FUNCTION template_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'PUBLISHED' THEN
    RAISE EXCEPTION 'A published template version is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER template_version_immutable BEFORE UPDATE OR DELETE ON "IndustryTemplateVersion" FOR EACH ROW EXECUTE FUNCTION template_version_immutable();
