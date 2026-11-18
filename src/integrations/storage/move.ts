import { createHash } from "node:crypto";
import { systemDb } from "@/core/db/client";
import { StorageError, documentKey, ensureBucket, supabaseGet, supabasePut, supabaseStorageConfig } from "./index";

/**
 * Moves files still stored in PostgreSQL (DocumentFile, AdminDocumentBlob) to Supabase Storage (see
 * scripts/move-files-to-supabase.ts). Per file: upload (never overwriting) → download → compare with the recorded SHA-256
 * → switch the record and delete the database bytes in one transaction. Idempotent.
 */
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

async function putVerified(c: NonNullable<ReturnType<typeof supabaseStorageConfig>>, key: string, bytes: Uint8Array, contentType: string, expected: string) {
  try {
    await supabasePut(c, key, bytes, contentType);
  } catch (e) {
    // An earlier interrupted run may have uploaded it already: accept only if the stored object is identical.
    if (!(e instanceof StorageError)) throw e;
  }
  const back = await supabaseGet(c, key);
  if (sha(back) !== expected) throw new Error(`hash mismatch for ${key}`);
}

export async function moveFilesToSupabase(opts: { apply: boolean; log?: (m: string) => void }) {
  const log = opts.log ?? (() => undefined);
  const c = supabaseStorageConfig();
  if (!c) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.");
  const docs = await systemDb.document.findMany({ where: { storage: "DATABASE" }, select: { id: true, organizationId: true, fileName: true, mimeType: true, sha256: true } });
  const admin = await systemDb.adminDocument.findMany({ where: { storage: "DATABASE" }, select: { id: true, storageKey: true, mimeType: true, sha256: true } });
  const result = { documents: docs.length, adminDocuments: admin.length, moved: 0, failed: 0 };
  if (!opts.apply) return result;
  await ensureBucket(c);
  for (const d of docs) {
    try {
      const file = await systemDb.documentFile.findUnique({ where: { documentId: d.id } });
      if (!file) throw new Error("no bytes");
      const bytes = new Uint8Array(file.data);
      if (sha(bytes) !== d.sha256) throw new Error("stored bytes do not match the recorded SHA-256");
      const key = documentKey(d.organizationId, d.fileName);
      await putVerified(c, key, bytes, d.mimeType, d.sha256);
      await systemDb.$transaction([
        systemDb.document.update({ where: { id: d.id }, data: { storage: "SUPABASE", storageKey: key } }),
        systemDb.documentFile.delete({ where: { documentId: d.id } }),
      ]);
      result.moved++;
    } catch (e) {
      result.failed++;
      log(`✗ document ${d.id}: ${(e as Error).message}`);
    }
  }
  for (const d of admin) {
    try {
      const blob = await systemDb.adminDocumentBlob.findUnique({ where: { documentId: d.id } });
      if (!blob) throw new Error("no bytes");
      const bytes = new Uint8Array(blob.data);
      if (sha(bytes) !== d.sha256) throw new Error("stored bytes do not match the recorded SHA-256");
      await putVerified(c, d.storageKey, bytes, d.mimeType, d.sha256);
      await systemDb.$transaction([
        systemDb.adminDocument.update({ where: { id: d.id }, data: { storage: "SUPABASE" } }),
        systemDb.adminDocumentBlob.delete({ where: { documentId: d.id } }),
      ]);
      result.moved++;
    } catch (e) {
      result.failed++;
      log(`✗ admin document ${d.id}: ${(e as Error).message}`);
    }
  }
  return result;
}
