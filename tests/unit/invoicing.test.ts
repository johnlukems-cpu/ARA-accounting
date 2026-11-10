import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { agingBucket, calculateLines, dueDateFor, invoiceLedgerLines, type TaxCodeInfo } from "@/modules/invoicing/domain";
import { buildLines, totals } from "@/core/ledger/domain";

const codes = new Map<string, TaxCodeInfo>([
  ["btw10", { id: "btw10", rate: "10", deductiblePct: "100", outputAccountId: "out", inputAccountId: "in" }],
  ["btw25", { id: "btw25", rate: "25", deductiblePct: "100", outputAccountId: "out", inputAccountId: "in" }],
  ["half", { id: "half", rate: "10", deductiblePct: "50", outputAccountId: "out", inputAccountId: "in" }],
]);

describe("invoice calculation (T3)", () => {
  it("computes net, BTW per line (rounded per line) and gross", () => {
    const r = calculateLines(
      [
        { description: "Rijst 25 kg", quantity: "3", unitPrice: "333.33", accountId: "rev", taxCodeId: "btw10" },
        { description: "Parfum", quantity: "1", unitPrice: "1000", discountPct: "10", accountId: "rev", taxCodeId: "btw25" },
        { description: "Export", quantity: "2", unitPrice: "50", accountId: "rev" },
      ],
      codes,
    );
    expect(r.lines.map((l) => [l.netAmount, l.taxAmount])).toEqual([["999.99", "100.00"], ["900.00", "225.00"], ["100.00", "0.00"]]);
    expect([r.net, r.tax, r.gross]).toEqual(["1999.99", "325.00", "2324.99"]);
  });

  it("due date adds the payment term", () => {
    expect(dueDateFor("2026-01-31", 30)).toBe("2026-03-02");
  });

  it("aging buckets: current, 1–30, 31–60, 61–90, > 90", () => {
    expect([0, -5, 1, 30, 31, 60, 61, 90, 91, 400].map((d) => agingBucket(d))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
});

describe("invoice journal lines", () => {
  const base = { currency: "SRD", rate: "1", controlAccountId: "ctrl", partyId: "p1", description: "VF-1", taxCodes: codes };

  it("sales invoice: Dr receivable gross, Cr revenue net, Cr output BTW — balanced", () => {
    const calc = calculateLines([{ description: "Dienst", quantity: "1", unitPrice: "1000", accountId: "rev", taxCodeId: "btw10" }], codes);
    const lines = invoiceLedgerLines({ ...base, type: "SALES", kind: "INVOICE", lines: calc.lines });
    expect(lines).toEqual([
      expect.objectContaining({ accountId: "rev", credit: "1000.00" }),
      expect.objectContaining({ accountId: "out", credit: "100.00" }),
      expect.objectContaining({ accountId: "ctrl", debit: "1100.00" }),
    ]);
    const built = buildLines(lines, "SRD");
    const t = totals(built, "SRD");
    expect(t.debit.equals(t.credit)).toBe(true);
  });

  it("purchase invoice with partly deductible BTW puts the non-deductible part into the cost", () => {
    const calc = calculateLines([{ description: "Brandstof", quantity: "1", unitPrice: "200", accountId: "exp", taxCodeId: "half" }], codes);
    const lines = invoiceLedgerLines({ ...base, type: "PURCHASE", kind: "INVOICE", lines: calc.lines });
    expect(lines).toEqual([
      expect.objectContaining({ accountId: "exp", debit: "210.00" }),
      expect.objectContaining({ accountId: "in", debit: "10.00" }),
      expect.objectContaining({ accountId: "ctrl", credit: "220.00" }),
    ]);
  });

  it("credit notes swap sides", () => {
    const calc = calculateLines([{ description: "Retour", quantity: "1", unitPrice: "100", accountId: "rev", taxCodeId: "btw10" }], codes);
    const lines = invoiceLedgerLines({ ...base, type: "SALES", kind: "CREDIT_NOTE", lines: calc.lines });
    expect(lines.find((l) => l.accountId === "ctrl")).toMatchObject({ credit: "110.00" });
    expect(lines.find((l) => l.accountId === "rev")).toMatchObject({ debit: "100.00" });
  });

  it("foreign-currency invoice converts at the invoice rate (USD 1,000 × 38 = SRD 38,000)", () => {
    const calc = calculateLines([{ description: "Consultancy", quantity: "1", unitPrice: "1000", accountId: "rev" }], codes);
    const lines = invoiceLedgerLines({ ...base, currency: "USD", rate: "38", type: "SALES", kind: "INVOICE", lines: calc.lines });
    const built = buildLines(lines, "SRD");
    expect(built.find((l) => l.accountId === "ctrl")).toMatchObject({ debitBase: "38000.00", txAmount: "1000.00", txCurrency: "USD" });
    expect(new Decimal(totals(built, "SRD").debit.toString()).toFixed(2)).toBe("38000.00");
  });
});
