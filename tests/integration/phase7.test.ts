import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { systemDb } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { saveParty } from "@/modules/invoicing/service";
import { emptyFields, type Fields } from "@/modules/scan/domain";
import type { Extractor } from "@/modules/scan/extractors";
import { confirmDocument, rejectDocument, saveRule, setAiEnabled, suggestionsFor, uploadDocument, automationStats } from "@/modules/scan/service";
import { createAdministration, createCompany } from "@/modules/organization/service";
import { companyInput, newOrganization, refresh, uid } from "./helpers";

async function books() {
  const org = await newOrganization();
  const company = await createCompany(org.access, companyInput());
  const access = await refresh(org.access);
  const { administration } = await createAdministration(access, { companyId: company.id, code: "HOOFD", name: "Hoofd", baseCurrency: "SRD", startYear: 2026, startMonth: 1 });
  const accounts = await systemDb.account.findMany({ where: { administrationId: administration.id } });
  const codes = await systemDb.taxCode.findMany({ where: { administrationId: administration.id } });
  const acc = (n: string) => accounts.find((a) => a.number === n)!.id;
  const tax = (c: string) => codes.find((x) => x.code === c)!.id;
  const supplier = (await saveParty(access, { administrationId: administration.id, code: `L${uid().slice(0, 5)}`, name: "Bouwmaterialen Paramaribo N.V.", isCustomer: false, isSupplier: true, currency: "SRD", paymentTermDays: 30, taxNumber: "1234567", defaultExpenseAccountId: acc("4500"), defaultTaxCodeId: tax("BTW10") }))!;
  return { access, adminId: administration.id, acc, tax, supplier };
}
type Books = Awaited<ReturnType<typeof books>>;

async function invoicePdf(lines: string[]) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  lines.forEach((l, i) => page.drawText(l, { x: 50, y: 790 - i * 18, size: 11, font }));
  return pdf.save();
}
const INVOICE = (no: string) => ["Bouwmaterialen Paramaribo N.V.", "Fiscaal nummer: 1234567", "FACTUUR", `Factuurnummer: ${no}`, "Factuurdatum: 03-03-2026", "Vervaldatum: 02-04-2026", "Subtotaal: SRD 1.000,00", "BTW 10%: SRD 100,00", "Totaal te betalen: SRD 1.100,00"];

/** Recorded-fixture extractor (stands in for the AI provider in tests). */
const fixture = (values: Partial<Record<keyof Fields, string>>, confidence = 0.97): Extractor => ({
  provider: "fixture",
  model: "recorded",
  async extract() {
    const f = emptyFields();
    for (const [k, v] of Object.entries(values)) f[k as keyof Fields] = { value: v ?? null, confidence };
    return f;
  },
});
const upload = async (b: Books, bytes: Uint8Array, extractors?: Extractor[]) => uploadDocument(b.access, { administrationId: b.adminId, fileName: "factuur.pdf", bytes }, extractors);

describe("Phase 7: ARA Scan", () => {
  it("stores a PDF, reads its text layer, suggests supplier/account/BTW and leaves it for review without a rule", async () => {
    const b = await books();
    const bytes = await invoicePdf(INVOICE(`BMP-${uid()}`));
    const { document, automation } = await upload(b, bytes); // default extractors; AI is off
    expect(document).toMatchObject({ mimeType: "application/pdf", pageCount: 1, status: "REVIEW_REQUIRED" });
    expect(automation).toMatchObject({ outcome: "REVIEW", reasons: ["noRule"] });
    const extractions = await systemDb.documentExtraction.findMany({ where: { documentId: document.id } });
    expect(extractions.map((e) => e.provider)).toEqual(["text-layer"]); // AI off by default
    const s = await withTenant(b.access, (tx) => suggestionsFor(tx, document.id));
    expect(s.fields.invoiceNumber.value).toMatch(/^BMP-/);
    expect(s.fields.grossAmount).toEqual({ value: "1100.00", confidence: 0.9 });
    expect(s.supplier).toMatchObject({ party: { id: b.supplier.id }, confidence: 0.98 });
    expect(s.account).toEqual({ accountId: b.acc("4500"), confidence: 0.85, source: "supplier" });
    expect(s.taxCode).toEqual({ taxCodeId: b.tax("BTW10"), source: "supplier" });
    // The stored file and the suggestions are evidence.
    await expect(systemDb.documentFile.update({ where: { documentId: document.id }, data: { data: Buffer.from("x") } })).rejects.toThrow(/append-only|immutable/i);
    await expect(systemDb.documentExtraction.deleteMany({ where: { documentId: document.id } })).rejects.toThrow(/append-only|immutable/i);
  });

  it("rejects non-document files and flags the same file uploaded twice (AI3)", async () => {
    const b = await books();
    await expect(upload(b, new TextEncoder().encode("<html><script>alert(1)</script></html>"))).rejects.toMatchObject({ key: "scan.unsupportedType" });
    const bytes = await invoicePdf(INVOICE(`BMP-${uid()}`));
    const first = await upload(b, bytes);
    const second = await upload(b, bytes);
    expect(second.document).toMatchObject({ duplicateOfId: first.document.id, duplicateReason: "SAME_FILE" });
    expect(second.automation.reasons).toContain("duplicate:SAME_FILE");
  });

  it("rules: DRAFT submits a purchase invoice; AUTO_POST posts only within its limits and confidence (AI2)", async () => {
    const b = await books();
    await saveRule(b.access, { administrationId: b.adminId, name: "Bouwmaterialen", partyId: b.supplier.id, accountId: b.acc("4500"), taxCodeId: b.tax("BTW10"), mode: "DRAFT", minConfidence: 0.9 });
    const good = (no: string, gross = "1100.00") => fixture({ supplierTaxNumber: "1234567", supplierName: "Bouwmaterialen Paramaribo", invoiceNumber: no, invoiceDate: "2026-03-03", grossAmount: gross, netAmount: gross === "1100.00" ? "1000.00" : undefined, currency: "SRD", description: "Cement" });
    const drafted = await upload(b, await invoicePdf([`a ${uid()}`]), [good(`A-${uid()}`)]);
    expect(drafted.automation.outcome).toBe("DRAFTED");
    const inv = await systemDb.invoice.findUniqueOrThrow({ where: { id: drafted.automation.invoiceId! } });
    expect(inv).toMatchObject({ status: "REVIEW", type: "PURCHASE" });
    expect(inv.grossAmount.toFixed(2)).toBe("1100.00");
    expect((await systemDb.document.findUniqueOrThrow({ where: { id: drafted.document.id } })).status).toBe("PROCESSED");

    // AUTO_POST needs a limit; with purchase approval switched off it posts.
    await expect(saveRule(b.access, { administrationId: b.adminId, name: "Zonder limiet", partyId: b.supplier.id, accountId: b.acc("4500"), mode: "AUTO_POST" })).rejects.toMatchObject({ key: "scan.maxAmountRequired" });
    await systemDb.automationRule.updateMany({ where: { administrationId: b.adminId }, data: { enabled: false } });
    await saveRule(b.access, { administrationId: b.adminId, name: "Auto", partyId: b.supplier.id, accountId: b.acc("4500"), taxCodeId: b.tax("BTW10"), mode: "AUTO_POST", maxAmount: "5000" });
    await systemDb.administration.update({ where: { id: b.adminId }, data: { settings: { purchaseApproval: false } } });
    const posted = await upload(b, await invoicePdf([`b ${uid()}`]), [good(`B-${uid()}`, "2200.00")]);
    expect(posted.automation.outcome).toBe("POSTED");
    expect((await systemDb.invoice.findUniqueOrThrow({ where: { id: posted.automation.invoiceId! } })).status).toBe("POSTED");

    const tooBig = await upload(b, await invoicePdf([`c ${uid()}`]), [good(`C-${uid()}`, "8800.00")]);
    expect(tooBig.automation).toMatchObject({ outcome: "REVIEW", invoiceId: null });
    expect(tooBig.automation.reasons).toContain("aboveMaxAmount");
    const unsure = await upload(b, await invoicePdf([`d ${uid()}`]), [fixture({ supplierTaxNumber: "1234567", invoiceNumber: `D-${uid()}`, invoiceDate: "2026-03-03", grossAmount: "1100.00" }, 0.6)]);
    expect(unsure.automation.reasons).toEqual(expect.arrayContaining(["confidence:invoiceNumber", "confidence:grossAmount"]));
    const odd = await upload(b, await invoicePdf([`e ${uid()}`]), [fixture({ supplierTaxNumber: "1234567", invoiceNumber: `E-${uid()}`, invoiceDate: "2026-03-03", grossAmount: "1100.00", netAmount: "900.00" })]);
    expect(odd.automation.reasons).toContain("amountMismatch");

    const stats = await withTenant(b.access, (tx) => automationStats(tx, b.adminId, new Date(Date.now() - 3600_000)));
    expect(Object.fromEntries(stats.map((s) => [s.outcome, s.count]))).toMatchObject({ DRAFTED: 1, POSTED: 1, REVIEW: 3 });
  });

  it("manual review creates a draft purchase invoice, blocks a suspected duplicate unless accepted, and can reject", async () => {
    const b = await books();
    const no = `M-${uid()}`;
    const first = await upload(b, await invoicePdf(INVOICE(no)));
    const values = { partyId: b.supplier.id, invoiceNumber: no, invoiceDate: "2026-03-03", dueDate: "2026-04-02", currency: "SRD", accountId: b.acc("4500"), taxCodeId: b.tax("BTW10"), netAmount: "1000.00", description: "Cement", acceptDuplicate: false, exchangeRate: undefined };
    const inv = await confirmDocument(b.access, { documentId: first.document.id, ...values });
    expect(inv.status).toBe("DRAFT");
    const doc = await systemDb.document.findUniqueOrThrow({ where: { id: first.document.id } });
    expect(doc).toMatchObject({ status: "PROCESSED", invoiceId: inv.id });
    expect((doc.confirmed as { values: { invoiceNumber: string } }).values.invoiceNumber).toBe(no);
    await expect(confirmDocument(b.access, { documentId: first.document.id, ...values })).rejects.toMatchObject({ key: "scan.alreadyHandled" });

    // Same supplier + invoice number from a different file (AI3).
    const second = await upload(b, await invoicePdf([...INVOICE(no), "kopie"]));
    expect(second.automation.reasons).toContain("duplicate:SAME_INVOICE_NUMBER");
    await expect(confirmDocument(b.access, { documentId: second.document.id, ...values })).rejects.toMatchObject({ key: "scan.duplicateSuspected" });
    await rejectDocument(b.access, second.document.id, "Dubbel ontvangen");
    expect((await systemDb.document.findUniqueOrThrow({ where: { id: second.document.id } })).status).toBe("REJECTED");
  });

  it("AI is an organisation decision with recorded consent; documents are isolated per organisation", async () => {
    const b = await books();
    await setAiEnabled(b.access, true);
    const org = await systemDb.organization.findUniqueOrThrow({ where: { id: b.access.organizationId } });
    expect((org.settings as { ai: { enabled: boolean; consentById: string } }).ai).toMatchObject({ enabled: true, consentById: b.access.userId });
    const { document } = await upload(b, await invoicePdf(INVOICE(`I-${uid()}`)), [fixture({ invoiceNumber: "X" })]);
    const other = await books();
    await withTenant(other.access, async (tx) => {
      expect(await tx.document.count({ where: { id: document.id } })).toBe(0);
      expect(await tx.documentFile.count({ where: { documentId: document.id } })).toBe(0);
    });
    await expect(rejectDocument(other.access, document.id, "x")).rejects.toMatchObject({ key: "errors.notFound" });
  });
});
