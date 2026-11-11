-- Phase 7: tenant isolation and integrity for documents and automation.
SELECT ara_enable_tenant_rls('"Document"');
SELECT ara_enable_tenant_rls('"DocumentFile"');
SELECT ara_enable_tenant_rls('"DocumentExtraction"');
SELECT ara_enable_tenant_rls('"AutomationRule"');
SELECT ara_enable_tenant_rls('"AutomationExecution"');

ALTER TABLE "Document" ADD CONSTRAINT document_size CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 20971520);
ALTER TABLE "Document" ADD CONSTRAINT document_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE "Document" ADD CONSTRAINT document_mime CHECK ("mimeType" IN ('application/pdf', 'image/jpeg', 'image/png'));
ALTER TABLE "AutomationRule" ADD CONSTRAINT automation_confidence CHECK ("minConfidence" > 0 AND "minConfidence" <= 1);
ALTER TABLE "AutomationRule" ADD CONSTRAINT automation_auto_post_limit CHECK (mode <> 'AUTO_POST' OR "maxAmount" IS NOT NULL);

-- Evidence: the stored file never changes; extractions and the automation log are append-only.
CREATE TRIGGER document_file_append_only BEFORE UPDATE OR DELETE ON "DocumentFile" FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER document_extraction_append_only BEFORE UPDATE OR DELETE ON "DocumentExtraction" FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER automation_execution_append_only BEFORE UPDATE OR DELETE ON "AutomationExecution" FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER document_no_delete BEFORE DELETE ON "Document" FOR EACH ROW EXECUTE FUNCTION append_only();
