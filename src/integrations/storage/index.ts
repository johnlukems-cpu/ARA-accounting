import type { Tx } from "@/core/db/client";

/**
 * File storage for admin-portal documents. Two backends behind one interface:
 *  - SUPABASE: Supabase Storage, one PRIVATE bucket, accessed only from the server with the service-role key
 *    (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY; never sent to the browser). Objects are never overwritten (x-upsert false).
 *  - DATABASE: bytes in AdminDocumentBlob (RLS, append-only) — used when Supabase Storage is not configured.
 * Authorisation is always enforced by the caller before put/get; the storage key is never exposed as a public URL.
 */
export type Backend = "DATABASE" | "SUPABASE";

export interface SupabaseStorageConfig {
  baseUrl: string; // e.g. https://<ref>.supabase.co/storage/v1
  serviceKey: string;
  bucket: string;
}

export function supabaseStorageConfig(env: Record<string, string | undefined> = process.env): SupabaseStorageConfig | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const baseUrl = (env.SUPABASE_STORAGE_URL || `${env.SUPABASE_URL.replace(/\/$/, "")}/storage/v1`).replace(/\/$/, "");
  return { baseUrl, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY, bucket: env.SUPABASE_STORAGE_BUCKET || "ara-private" };
}

export const activeBackend = (env: Record<string, string | undefined> = process.env): Backend => (supabaseStorageConfig(env) ? "SUPABASE" : "DATABASE");

const headers = (c: SupabaseStorageConfig, extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${c.serviceKey}`, apikey: c.serviceKey, ...extra });
const objectUrl = (c: SupabaseStorageConfig, key: string) => `${c.baseUrl}/object/${encodeURIComponent(c.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;

export class StorageError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

/** Creates the bucket as PRIVATE if it does not exist, and refuses to use a bucket that is public. */
export async function ensureBucket(c: SupabaseStorageConfig) {
  const res = await fetch(`${c.baseUrl}/bucket/${encodeURIComponent(c.bucket)}`, { headers: headers(c) });
  if (res.ok) {
    const b = (await res.json()) as { public?: boolean };
    if (b.public) throw new StorageError(500, "storage bucket is public");
    return;
  }
  const created = await fetch(`${c.baseUrl}/bucket`, { method: "POST", headers: headers(c, { "Content-Type": "application/json" }), body: JSON.stringify({ id: c.bucket, name: c.bucket, public: false }) });
  if (!created.ok && created.status !== 409) throw new StorageError(created.status, "bucket creation failed");
}

export async function supabasePut(c: SupabaseStorageConfig, key: string, bytes: Uint8Array, contentType: string) {
  await ensureBucket(c);
  const res = await fetch(objectUrl(c, key), { method: "POST", headers: headers(c, { "Content-Type": contentType, "x-upsert": "false" }), body: Buffer.from(bytes) });
  if (!res.ok) throw new StorageError(res.status, "upload failed");
}

export async function supabaseGet(c: SupabaseStorageConfig, key: string): Promise<Uint8Array> {
  const res = await fetch(objectUrl(c, key), { headers: headers(c) });
  if (!res.ok) throw new StorageError(res.status, "download failed");
  return new Uint8Array(await res.arrayBuffer());
}

/** Stores the file and returns the backend and key to record in AdminDocument. */
export async function putFile(tx: Tx | null, args: { documentId: string; organizationId: string; key: string; bytes: Uint8Array; contentType: string }): Promise<Backend> {
  const c = supabaseStorageConfig();
  if (c) {
    await supabasePut(c, args.key, args.bytes, args.contentType);
    return "SUPABASE";
  }
  if (!tx) throw new StorageError(500, "database storage needs a transaction");
  await tx.adminDocumentBlob.create({ data: { documentId: args.documentId, organizationId: args.organizationId, data: Buffer.from(args.bytes) } });
  return "DATABASE";
}

export async function getFile(tx: Tx, doc: { id: string; storage: Backend; storageKey: string }): Promise<Uint8Array> {
  if (doc.storage === "SUPABASE") {
    const c = supabaseStorageConfig();
    if (!c) throw new StorageError(503, "Supabase Storage is not configured");
    return supabaseGet(c, doc.storageKey);
  }
  const blob = await tx.adminDocumentBlob.findUnique({ where: { documentId: doc.id } });
  if (!blob) throw new StorageError(404, "file not found");
  return new Uint8Array(blob.data);
}

// ───────────── Accounting documents (ARA Scan purchase documents, tax filing evidence) ─────────────

export function documentKey(organizationId: string, fileName: string) {
  const id = crypto.randomUUID();
  return `${organizationId}/documents/${new Date().getUTCFullYear()}/${id}-${fileName.replace(/[^\w.-]+/g, "_").slice(-120)}`;
}

/**
 * Uploads a document file to Supabase Storage BEFORE the database transaction (when configured) and returns the
 * fields for the Document row; without Supabase it returns null and the caller stores the bytes in DocumentFile.
 * If the transaction then fails, an unreferenced object remains in the private bucket and is never served.
 */
export async function uploadDocumentObject(organizationId: string, fileName: string, bytes: Uint8Array, contentType: string): Promise<{ storage: "SUPABASE"; storageKey: string } | null> {
  const c = supabaseStorageConfig();
  if (!c) return null;
  const storageKey = documentKey(organizationId, fileName);
  await supabasePut(c, storageKey, bytes, contentType);
  return { storage: "SUPABASE", storageKey };
}

export async function readDocumentFile(tx: Tx, doc: { id: string; storage: Backend; storageKey: string | null }): Promise<Uint8Array | null> {
  if (doc.storage === "SUPABASE") {
    const c = supabaseStorageConfig();
    if (!c || !doc.storageKey) throw new StorageError(503, "Supabase Storage is not configured");
    return supabaseGet(c, doc.storageKey);
  }
  const file = await tx.documentFile.findUnique({ where: { documentId: doc.id } });
  return file ? new Uint8Array(file.data) : null;
}
