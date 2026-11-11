import { describe, expect, it } from "vitest";
import { extractFromText, matchSupplier, sniffMime } from "@/modules/scan/domain";

const INVOICE = `Bouwmaterialen Paramaribo N.V.
Domineestraat 10, Paramaribo
Fiscaal nummer: 1234567
FACTUUR
Factuurnummer: BMP-2026-0042
Factuurdatum: 03-03-2026
Vervaldatum: 02-04-2026
Cement 10 zakken
Subtotaal: SRD 1.000,00
BTW 10%: SRD 100,00
Totaal te betalen: SRD 1.100,00`;

describe("ARA Scan: file type and text extraction", () => {
  it("recognises PDF, JPEG and PNG by their bytes only", () => {
    expect(sniffMime(new TextEncoder().encode("%PDF-1.7 ..."))).toBe("application/pdf");
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffMime(new TextEncoder().encode("<html>"))).toBeNull();
  });

  it("reads invoice number, dates and amounts from a text layer; consistent totals raise confidence", () => {
    const f = extractFromText(INVOICE);
    expect(f.invoiceNumber.value).toBe("BMP-2026-0042");
    expect(f.invoiceDate.value).toBe("2026-03-03");
    expect(f.dueDate.value).toBe("2026-04-02");
    expect([f.netAmount.value, f.taxAmount.value, f.grossAmount.value]).toEqual(["1000.00", "100.00", "1100.00"]);
    expect(f.grossAmount.confidence).toBe(0.9);
    expect(f.supplierTaxNumber.value).toBe("1234567");
    expect(f.currency.value).toBe("SRD");
    expect(f.supplierName.value).toBe("Bouwmaterialen Paramaribo N.V.");
    expect(extractFromText("niets bruikbaars").invoiceNumber.value).toBeNull();
  });

  it("matches the supplier by tax number first, then by name similarity", () => {
    const parties = [{ id: "a", name: "Bouwmaterialen Paramaribo NV", taxNumber: "1234567" }, { id: "b", name: "Hakrin Handel" }];
    expect(matchSupplier(extractFromText(INVOICE), parties)).toEqual({ party: parties[0], confidence: 0.98 });
    const byName = matchSupplier({ ...extractFromText(INVOICE), supplierTaxNumber: { value: null, confidence: 0 } }, parties);
    expect(byName?.party.id).toBe("a");
    expect(byName!.confidence).toBeLessThan(0.98);
    expect(matchSupplier({ ...extractFromText("Onbekende Winkel\n"), supplierTaxNumber: { value: null, confidence: 0 } }, parties)).toBeNull();
  });
});
