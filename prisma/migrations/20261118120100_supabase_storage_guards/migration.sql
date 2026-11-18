-- All files to Supabase Storage. A document's file may move exactly once, DATABASE → SUPABASE; everything that
-- identifies the evidence (name, type, size, SHA-256, owner) stays immutable. Database bytes may be removed only after
-- the move (the move script first verifies the stored object against the SHA-256).
ALTER TABLE "Document" ADD CONSTRAINT document_storage_key CHECK (storage <> 'SUPABASE' OR "storageKey" IS NOT NULL);

CREATE OR REPLACE FUNCTION document_storage_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."fileName" <> OLD."fileName" OR NEW."mimeType" <> OLD."mimeType" OR NEW."sizeBytes" <> OLD."sizeBytes" OR NEW.sha256 <> OLD.sha256
     OR NEW."organizationId" <> OLD."organizationId" OR NEW."administrationId" <> OLD."administrationId" THEN
    RAISE EXCEPTION 'Document evidence fields are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.storage IS DISTINCT FROM OLD.storage OR NEW."storageKey" IS DISTINCT FROM OLD."storageKey" THEN
    IF NOT (OLD.storage = 'DATABASE' AND NEW.storage = 'SUPABASE' AND OLD."storageKey" IS NULL AND NEW."storageKey" IS NOT NULL) THEN
      RAISE EXCEPTION 'A document file can only move once, from the database to Supabase Storage' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_storage_guard BEFORE UPDATE ON "Document" FOR EACH ROW EXECUTE FUNCTION document_storage_guard();

-- DocumentFile: never updated; deleted only once its document lives in Supabase Storage.
DROP TRIGGER document_file_append_only ON "DocumentFile";
CREATE OR REPLACE FUNCTION document_file_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Stored files are immutable' USING ERRCODE = 'integrity_constraint_violation'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "Document" d WHERE d.id = OLD."documentId" AND d.storage = 'SUPABASE') THEN
    RAISE EXCEPTION 'A stored file can only be removed after it moved to Supabase Storage' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER document_file_guard BEFORE UPDATE OR DELETE ON "DocumentFile" FOR EACH ROW EXECUTE FUNCTION document_file_guard();

-- AdminDocument: append-only except the one-way move of its file to Supabase Storage (same key).
DROP TRIGGER admin_document_append_only ON "AdminDocument";
CREATE OR REPLACE FUNCTION admin_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Admin documents cannot be deleted' USING ERRCODE = 'integrity_constraint_violation'; END IF;
  IF (to_jsonb(OLD) - 'storage') <> (to_jsonb(NEW) - 'storage') OR NOT (OLD.storage = 'DATABASE' AND NEW.storage = 'SUPABASE') THEN
    RAISE EXCEPTION 'Admin documents are append-only (only the move to Supabase Storage is allowed)' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER admin_document_guard BEFORE UPDATE OR DELETE ON "AdminDocument" FOR EACH ROW EXECUTE FUNCTION admin_document_guard();

DROP TRIGGER admin_document_blob_append_only ON "AdminDocumentBlob";
CREATE OR REPLACE FUNCTION admin_document_blob_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Stored files are immutable' USING ERRCODE = 'integrity_constraint_violation'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "AdminDocument" d WHERE d.id = OLD."documentId" AND d.storage = 'SUPABASE') THEN
    RAISE EXCEPTION 'A stored file can only be removed after it moved to Supabase Storage' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER admin_document_blob_guard BEFORE UPDATE OR DELETE ON "AdminDocumentBlob" FOR EACH ROW EXECUTE FUNCTION admin_document_blob_guard();
