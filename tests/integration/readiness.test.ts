import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { systemDb } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { resolveAccess, can } from "@/core/auth/access";
import { hit, THROTTLES } from "@/core/ops/throttle";
import { effectiveTrialDays, savePlan, setSubscription, setTrialDays, usage } from "@/modules/saas/service";
import { complianceRegister, recordReview } from "@/modules/compliance/service";
import { applyFormat, saveFormat, validateFormat } from "@/modules/banking/formats";
import { evaluate, recordEvidence, setPaymentInstructions, paymentInstructions } from "@/modules/readiness/service";
import { uploadDocument } from "@/modules/scan/service";
import { createAdministration, createCompany, registerOrganization } from "@/modules/organization/service";
import { companyInput, newOrganization, refresh, uid } from "./helpers";

async function platformAdmin() {
  const o = await newOrganization();
  await systemDb.user.update({ where: { id: o.userId }, data: { isPlatformAdmin: true } });
  return o.userId;
}
const code = () => `T${uid().slice(1, 7).toUpperCase()}`;

describe("Production readiness: tenant isolation coverage", () => {
  it("every table with an organizationId column has RLS with a policy, or is not accessible to the app role at all", async () => {
    const rows = await systemDb.$queryRaw<{ table: string; rls: boolean; policies: bigint; granted: boolean }[]>`
      SELECT c.relname AS table, c.relrowsecurity AS rls, (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) AS policies,
             has_table_privilege('ara_app', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS granted
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND EXISTS (SELECT 1 FROM information_schema.columns col WHERE col.table_name = c.relname AND col.column_name = 'organizationId')`;
    expect(rows.length).toBeGreaterThan(40);
    // Session, UserToken: no privileges for ara_app (auth tables are only used by trusted system code).
    expect(rows.filter((r) => r.granted && (!r.rls || Number(r.policies) === 0)).map((r) => r.table)).toEqual([]);
  });
  it("platform tables are closed to tenants except the read-only plan and bank-format libraries", async () => {
    const o = await newOrganization();
    await expect(withTenant(o.access, (tx) => tx.platformSetting.findMany())).rejects.toThrow(/permission denied/);
    await expect(withTenant(o.access, (tx) => tx.complianceReview.findMany())).rejects.toThrow(/permission denied/);
    await expect(withTenant(o.access, (tx) => tx.bankFormat.create({ data: { bankName: "x", formatName: "y", profile: {}, createdById: o.userId } }))).rejects.toThrow(/permission denied/);
    expect(Array.isArray(await withTenant(o.access, (tx) => tx.plan.findMany()))).toBe(true);
    expect(Array.isArray(await withTenant(o.access, (tx) => tx.bankFormat.findMany()))).toBe(true);
  });
});

describe("Production readiness: configurable subscriptions", () => {
  it("annual prices, storage limit and module access; core modules always stay; prices are optional", async () => {
    const admin = await platformAdmin();
    const plan = await savePlan(admin, { code: code(), name: "Basis", priceMonthlySrd: "", priceAnnualUsd: "480", storageMb: "1", modules: ["budgets"] });
    expect(plan.priceMonthlySrd).toBeNull();
    expect(plan.priceAnnualUsd?.toString()).toBe("480");
    expect(plan.modules).toEqual(["budgets"]);
    const o = await newOrganization();
    await setSubscription(admin, { organizationId: o.organizationId, planId: plan.id, status: "ACTIVE" });
    const company = await createCompany(o.access, companyInput());
    const access = (await resolveAccess(o.userId, o.organizationId))!;
    expect(can(access, "ledger.post", company.id)).toBe(true);
    expect(can(access, "budgets.edit", company.id)).toBe(true);
    expect(can(access, "tax.approve", company.id)).toBe(false);
    expect(can(access, "scan.create", company.id)).toBe(false);
    // "all" restores every module.
    await savePlan(admin, { id: plan.id, code: plan.code, name: "Basis", modules: "all", storageMb: "1" });
    expect(can((await resolveAccess(o.userId, o.organizationId))!, "scan.create", company.id)).toBe(true);
    // Storage limit (1 MB) blocks a larger upload.
    const { administration } = await createAdministration(await refresh(o.access), { companyId: company.id, code: "A", name: "A", baseCurrency: "SRD", startYear: 2026, startMonth: 1 });
    const big = await PDFDocument.create().then(async (d) => { d.addPage(); await d.attach(randomBytes(1_200_000), "data.bin", { mimeType: "application/octet-stream" }); return d.save(); });
    expect(big.length).toBeGreaterThan(1_048_576);
    await expect(uploadDocument(await refresh(o.access), { administrationId: administration.id, fileName: "big.pdf", bytes: big }, [])).rejects.toMatchObject({ key: "saas.limitReached", values: { what: "storageMb" } });
    expect((await usage(systemDb, o.organizationId)).storageMb).toBe(0);
  });
  it("the trial length is a platform setting used for new registrations; only platform admins change it", async () => {
    const admin = await platformAdmin();
    const o = await newOrganization();
    await expect(setTrialDays(o.userId, 14)).rejects.toMatchObject({ key: "errors.forbidden" });
    await expect(setTrialDays(admin, 0)).rejects.toMatchObject({ key: "validation.invalid" });
    const before = await effectiveTrialDays();
    try {
      await setTrialDays(admin, 21);
      const r = await registerOrganization({ organizationName: `Trial ${uid()}`, kind: "BUSINESS", name: "T", email: `${uid("t")}@example.test`, password: "een lang test wachtwoord" });
      const org = await systemDb.organization.findUniqueOrThrow({ where: { id: r.organizationId } });
      expect(Math.round((org.trialEndsAt!.getTime() - Date.now()) / 86_400_000)).toBe(21);
    } finally {
      await setTrialDays(admin, before);
    }
  });
  it("payment instructions are set by the platform admin", async () => {
    const admin = await platformAdmin();
    const before = await paymentInstructions();
    await setPaymentInstructions(admin, "Test-instructies");
    expect(await paymentInstructions()).toBe("Test-instructies");
    await setPaymentInstructions(admin, before ?? "");
  });
});

describe("Production readiness: compliance reviews", () => {
  it("only a recorded APPROVED review verifies a tax rule; other decisions reset it; reviews are append-only", async () => {
    const admin = await platformAdmin();
    const o = await newOrganization();
    // A dedicated far-future rule version so the reference rules used by other tests are untouched.
    const day = String(1 + Math.floor(Math.random() * 28)).padStart(2, "0");
    const from = `2${String(100 + Math.floor(Math.random() * 800))}-03-${day}`;
    await systemDb.taxRuleVersion.create({ data: { taxType: "DIVIDENDBELASTING", effectiveFrom: new Date(`${from}T00:00:00Z`), parameters: { rate: 25 }, legalStatus: "SOURCE_FOUND" } });
    const key = `DIVIDENDBELASTING@${from}`;
    const base = { subject: "TAX_RULE" as const, subjectKey: key, reviewerName: "Mr. Test Adviseur", reviewerQualification: "Belastingadviseur", reference: "ADV-2026-001", reviewedOn: "2026-11-01" };
    await expect(recordReview(o.userId, { ...base, decision: "APPROVED" })).rejects.toMatchObject({ key: "errors.forbidden" });
    await expect(recordReview(admin, { ...base, decision: "REJECTED" })).rejects.toMatchObject({ key: "errors.reasonRequired" });
    await expect(recordReview(admin, { ...base, subjectKey: "BTW@1900-01-01", decision: "APPROVED" })).rejects.toMatchObject({ key: "errors.notFound" });
    await recordReview(admin, { ...base, decision: "APPROVED" });
    const rule = await systemDb.taxRuleVersion.findFirstOrThrow({ where: { taxType: "DIVIDENDBELASTING", effectiveFrom: new Date(`${from}T00:00:00Z`) } });
    expect(rule).toMatchObject({ legalStatus: "VERIFIED", verifiedBy: "Mr. Test Adviseur (Belastingadviseur)", verificationReference: "ADV-2026-001" });
    expect((await complianceRegister()).find((i) => i.key === key)?.status).toBe("VERIFIED");
    await recordReview(admin, { ...base, decision: "CHANGES_REQUIRED", notes: "Ingangsdatum onjuist" });
    expect((await systemDb.taxRuleVersion.findUniqueOrThrow({ where: { id: rule.id } })).legalStatus).toBe("PENDING_VERIFICATION");
    // The database refuses VERIFIED without evidence, and review records cannot be changed.
    await expect(systemDb.taxRuleVersion.update({ where: { id: rule.id }, data: { legalStatus: "VERIFIED" } })).rejects.toThrow(/tax_rule_verified_evidence/);
    const review = await systemDb.complianceReview.findFirstOrThrow({ where: { subjectKey: key } });
    await expect(systemDb.complianceReview.update({ where: { id: review.id }, data: { decision: "APPROVED" } })).rejects.toThrow();
  });
});

describe("Production readiness: bank format library", () => {
  // A synthetic file generated by this test exercises the validation workflow; it is not a bank sample.
  const profile = { delimiter: ";" as const, hasHeader: true, dateColumn: 0, dateFormat: "DD-MM-YYYY" as const, amountColumn: 2, decimalSeparator: "," as const, descriptionColumn: 1 };
  const file = "Datum;Omschrijving;Bedrag\n05-10-2026;Ontvangst;100,00\n06-10-2026;Kosten;-40,50\n";
  it("validated only when the sample matches the bank's statement; editing the layout resets it; tenants can apply only validated formats", async () => {
    const admin = await platformAdmin();
    const f = await saveFormat(admin, { bankName: `Testbank ${uid()}`, formatName: "CSV", profile });
    expect(f.status).toBe("DRAFT");
    const mismatch = await validateFormat(admin, { formatId: f.id, expectedLineCount: 2, expectedTotalIn: "100", expectedTotalOut: "40", confirmRealSample: true }, file);
    expect(mismatch).toMatchObject({ ok: false, mismatches: ["totalOut"] });
    expect((await systemDb.bankFormat.findUniqueOrThrow({ where: { id: f.id } })).status).toBe("DRAFT");
    const bad = await validateFormat(admin, { formatId: f.id, expectedLineCount: 1, expectedTotalIn: "1", expectedTotalOut: "1", confirmRealSample: true }, "Datum;Omschrijving;Bedrag\n31-02-2026;x;1,00\n");
    expect(bad).toMatchObject({ ok: false, error: { key: "banking.invalidDate" } });

    const o = await newOrganization();
    const company = await createCompany(o.access, companyInput());
    const { administration } = await createAdministration(await refresh(o.access), { companyId: company.id, code: "B", name: "B", baseCurrency: "SRD", startYear: 2026, startMonth: 1 });
    const fa = await systemDb.financialAccount.findFirstOrThrow({ where: { administrationId: administration.id } });
    await expect(applyFormat(await refresh(o.access), fa.id, f.id)).rejects.toMatchObject({ key: "errors.notFound" });

    const ok = await validateFormat(admin, { formatId: f.id, expectedLineCount: 2, expectedTotalIn: "100,00", expectedTotalOut: "40,50", confirmRealSample: true }, file);
    expect(ok.ok).toBe(true);
    const v = await systemDb.bankFormat.findUniqueOrThrow({ where: { id: f.id } });
    expect(v).toMatchObject({ status: "VALIDATED", sampleSummary: { lineCount: 2, totalIn: "100.00", totalOut: "40.50" } });
    expect(JSON.stringify(v)).not.toContain("Ontvangst"); // the file's lines are never stored

    await applyFormat(await refresh(o.access), fa.id, f.id);
    expect((await systemDb.financialAccount.findUniqueOrThrow({ where: { id: fa.id } })).importProfile).toMatchObject({ dateColumn: 0, amountColumn: 2 });

    await saveFormat(admin, { id: f.id, bankName: f.bankName, formatName: "CSV", profile: { ...profile, decimalSeparator: "." } });
    expect((await systemDb.bankFormat.findUniqueOrThrow({ where: { id: f.id } })).status).toBe("DRAFT");
  });
});

describe("Production readiness: throttling and the readiness dashboard", () => {
  it("uploads are refused after the per-user limit within the window", async () => {
    const u = uid("u");
    const o = uid("o");
    for (let n = 0; n < THROTTLES.upload.perUser; n++) expect(await hit("upload", u, o)).toBe(false);
    expect(await hit("upload", u, o)).toBe(true);
  });
  it("evaluates live statuses without exposing values; owner items complete only with evidence", async () => {
    const admin = await platformAdmin();
    const r = await evaluate({ NODE_ENV: "production" });
    expect(r.items.find((i) => i.id === "O1")!.status).toBe("WAITING_OWNER");
    expect(r.pilotReady).toBe(false);
    expect(r.gaReady).toBe(false);
    const withSecrets = await evaluate({ NODE_ENV: "production", ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"), CRON_SECRET: "c".repeat(40) });
    expect(JSON.stringify(withSecrets)).not.toContain("c".repeat(40));
    await expect(recordEvidence(admin, { item: "O12", reference: "Pentest 2026-11", confirm: false as never })).rejects.toThrow();
    await recordEvidence(admin, { item: "O12", reference: "Pentest TEST-REF", confirm: true });
    expect((await evaluate({ NODE_ENV: "production" })).items.find((i) => i.id === "O12")).toMatchObject({ status: "COMPLETED" });
  });
});
