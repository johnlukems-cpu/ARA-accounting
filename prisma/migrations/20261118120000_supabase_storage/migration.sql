-- AlterTable: where a document's file lives (Supabase Storage or the database). Guards: next migration.
ALTER TABLE "Document" ADD COLUMN "storage" "StorageBackend" NOT NULL DEFAULT 'DATABASE',
ADD COLUMN "storageKey" TEXT;
