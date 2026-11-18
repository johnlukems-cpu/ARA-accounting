import { describe, expect, it } from "vitest";
import { systemDb } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { ensureBucket, supabaseGet, supabasePut, supabaseStorageConfig, StorageError } from "@/integrations/storage";
import { createCustomer, downloadAdminDocument, uploadAdminDocument } from "@/modules/admin/crm";
import { newOrganization, uid } from "./helpers";
import { staff } from "./admin-helpers";

/**
 * Against a REAL Supabase Storage API (e.g. the supabase/storage-api container, or a Supabase project's /storage/v1).
 * Runs only when SUPABASE_STORAGE_TEST_URL and SUPABASE_STORAGE_TEST_SERVICE_KEY are set; skipped otherwise.
 */
const url = process.env.SUPABASE_STORAGE_TEST_URL;
const key = process.env.SUPABASE_STORAGE_TEST_SERVICE_KEY;
const anon = process.env.SUPABASE_STORAGE_TEST_ANON_KEY;
const PDF = Buffer.from(`%PDF-1.4\n% ${uid()}\n%%EOF`);

describe.skipIf(!url || !key)("Supabase Storage (live API)", () => {
  const env = { SUPABASE_URL: "http://unused", SUPABASE_STORAGE_URL: url!, SUPABASE_SERVICE_ROLE_KEY: key!, SUPABASE_STORAGE_BUCKET: `ara-test-${uid().slice(1, 7)}` };

  it("creates a PRIVATE bucket, stores objects without overwrite, and refuses anonymous reads", async () => {
    const c = supabaseStorageConfig(env)!;
    await ensureBucket(c);
    await supabasePut(c, "org/a.pdf", PDF, "application/pdf");
    expect(Buffer.from(await supabaseGet(c, "org/a.pdf")).equals(PDF)).toBe(true);
    await expect(supabasePut(c, "org/a.pdf", Buffer.from("other"), "application/pdf")).rejects.toBeInstanceOf(StorageError); // no overwrite
    if (anon) {
      const res = await fetch(`${url}/object/${c.bucket}/org/a.pdf`, { headers: { Authorization: `Bearer ${anon}` } });
      expect(res.ok).toBe(false);
      const pub = await fetch(`${url}/object/public/${c.bucket}/org/a.pdf`);
      expect(pub.ok).toBe(false);
    }
  });

  it("admin documents use Supabase Storage when configured; metadata stays in PostgreSQL with RLS", async () => {
    const saved = { ...process.env };
    Object.assign(process.env, env);
    try {
      const ctx = await staff();
      const customer = await createCustomer(ctx, { name: `Opslag ${uid()}`, stage: "CUSTOMER" });
      const doc = await uploadAdminDocument(ctx, { category: "CONTRACT", customerId: customer.id }, { fileName: "contract.pdf", bytes: PDF });
      expect(doc.storage).toBe("SUPABASE");
      expect(await systemDb.adminDocumentBlob.count({ where: { documentId: doc.id } })).toBe(0); // bytes not in the database
      expect(Buffer.from((await downloadAdminDocument(ctx, doc.id)).bytes).equals(PDF)).toBe(true);
      const outsider = await newOrganization();
      await withTenant(outsider.access, async (tx) => expect(await tx.adminDocument.count()).toBe(0));
    } finally {
      for (const k of Object.keys(env)) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  });
});
