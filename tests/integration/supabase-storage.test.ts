import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { systemDb } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { ensureBucket, supabaseGet, supabasePut, supabaseStorageConfig, StorageError } from "@/integrations/storage";
import { createCustomer, downloadAdminDocument, uploadAdminDocument } from "@/modules/admin/crm";
import { readDocumentFile } from "@/integrations/storage";
import { moveFilesToSupabase } from "@/integrations/storage/move";
import { uploadDocument } from "@/modules/scan/service";
import { createAdministration, createCompany } from "@/modules/organization/service";
import { companyInput, refresh } from "./helpers";
import { PDFDocument } from "pdf-lib";
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

  it("ARA Scan documents go to Supabase Storage; database files are moved with hash verification; evidence stays immutable", async () => {
    const o = await newOrganization();
    const company = await createCompany(o.access, companyInput());
    const { administration } = await createAdministration(await refresh(o.access), { companyId: company.id, code: "S", name: "S", baseCurrency: "SRD", startYear: 2026, startMonth: 1 });
    const pdf = async (t: string) => PDFDocument.create().then(async (d) => { d.setTitle(t); d.addPage(); return d.save(); });
    // 1. Without Supabase configured: stored in the database.
    const before = await uploadDocument(await refresh(o.access), { administrationId: administration.id, fileName: "oud.pdf", bytes: await pdf(`oud ${uid()}`) }, []);
    const oldDoc = await systemDb.document.findUniqueOrThrow({ where: { id: before.document.id } });
    expect(oldDoc.storage).toBe("DATABASE");
    // Evidence is protected: the bytes cannot be deleted while the document is not in Supabase; fields cannot change.
    await expect(systemDb.documentFile.delete({ where: { documentId: oldDoc.id } })).rejects.toThrow(/moved to Supabase/);
    await expect(systemDb.document.update({ where: { id: oldDoc.id }, data: { sha256: "0".repeat(64) } })).rejects.toThrow(/immutable/);
    const saved = { ...process.env };
    Object.assign(process.env, env);
    try {
      // 2. With Supabase: new uploads go to the bucket, no bytes in the database.
      const after = await uploadDocument(await refresh(o.access), { administrationId: administration.id, fileName: "nieuw.pdf", bytes: await pdf(`nieuw ${uid()}`) }, []);
      const newDoc = await systemDb.document.findUniqueOrThrow({ where: { id: after.document.id } });
      expect(newDoc).toMatchObject({ storage: "SUPABASE" });
      expect(await systemDb.documentFile.count({ where: { documentId: newDoc.id } })).toBe(0);
      const back = await withTenant(o.access, (tx) => readDocumentFile(tx, newDoc));
      expect(createHash("sha256").update(back!).digest("hex")).toBe(newDoc.sha256);
      // 3. Move everything still in the database; verified by hash; one-way.
      const dry = await moveFilesToSupabase({ apply: false });
      expect(dry.documents).toBeGreaterThan(0);
      const r = await moveFilesToSupabase({ apply: true });
      expect(r.failed).toBe(0);
      const moved = await systemDb.document.findUniqueOrThrow({ where: { id: oldDoc.id } });
      expect(moved.storage).toBe("SUPABASE");
      expect(await systemDb.documentFile.count({ where: { documentId: oldDoc.id } })).toBe(0);
      expect(createHash("sha256").update((await withTenant(o.access, (tx) => readDocumentFile(tx, moved)))!).digest("hex")).toBe(oldDoc.sha256);
      expect(await systemDb.document.count({ where: { storage: "DATABASE" } })).toBe(0);
      expect(await systemDb.adminDocument.count({ where: { storage: "DATABASE" } })).toBe(0);
      await expect(systemDb.document.update({ where: { id: moved.id }, data: { storage: "DATABASE", storageKey: null } })).rejects.toThrow(/only move once/);
    } finally {
      for (const k of Object.keys(env)) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  });
});
