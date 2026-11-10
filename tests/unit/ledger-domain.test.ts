import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { buildLines, LedgerError, reverseLines, totals } from "@/core/ledger/domain";

const A = "acc-a";
const B = "acc-b";
const R = "acc-rounding";

describe("buildLines (L1, L2, L5)", () => {
  it("builds a balanced base-currency entry", () => {
    const lines = buildLines([{ accountId: A, debit: "1000" }, { accountId: B, credit: "1000.00" }], "SRD");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ debitBase: "1000.00", creditBase: "0", txAmount: "1000.00", txCurrency: "SRD", exchangeRate: "1" });
    expect(lines[1]).toMatchObject({ debitBase: "0", creditBase: "1000.00", txAmount: "-1000.00" });
  });

  it("rejects unbalanced entries, both sides on one line, empty lines and negative amounts", () => {
    expect(() => buildLines([{ accountId: A, debit: "100" }, { accountId: B, credit: "99.99" }], "SRD")).toThrow(LedgerError);
    expect(() => buildLines([{ accountId: A, debit: "100", credit: "100" }, { accountId: B, credit: "100" }], "SRD")).toThrow(/oneSidePerLine/);
    expect(() => buildLines([{ accountId: A }, { accountId: B, credit: "1" }], "SRD")).toThrow(/oneSidePerLine/);
    expect(() => buildLines([{ accountId: A, debit: "-5" }, { accountId: B, credit: "-5" }], "SRD")).toThrow(/negativeAmount/);
    expect(() => buildLines([{ accountId: A, debit: "5" }], "SRD")).toThrow(/minTwoLines/);
  });

  it("converts foreign-currency lines and keeps the original amount and rate (C1)", () => {
    const lines = buildLines(
      [{ accountId: A, debit: "1000", currency: "USD", rate: "38", rateDate: "2026-03-01", rateSource: "CBVS_SELL" }, { accountId: B, credit: "38000" }],
      "SRD",
    );
    expect(lines[0]).toMatchObject({ debitBase: "38000.00", txCurrency: "USD", txAmount: "1000.00", exchangeRate: "38", rateSource: "CBVS_SELL", rateDate: "2026-03-01" });
  });

  it("requires a rate for foreign currency", () => {
    expect(() => buildLines([{ accountId: A, debit: "10", currency: "USD" }, { accountId: B, credit: "10" }], "SRD")).toThrow(/rateRequired/);
  });

  it("adds a labelled rounding line for conversion residue within tolerance, never otherwise", () => {
    // 3 × USD 0.33 at 37.333 = 12.32 each (12.31989) → 36.96, versus SRD 36.97 credit: 0.01 residue.
    const lines = buildLines(
      [
        { accountId: A, debit: "0.33", currency: "USD", rate: "37.333" },
        { accountId: A, debit: "0.33", currency: "USD", rate: "37.333" },
        { accountId: A, debit: "0.33", currency: "USD", rate: "37.333" },
        { accountId: B, credit: "36.97" },
      ],
      "SRD",
      R,
    );
    const rounding = lines.find((l) => l.isRounding)!;
    expect(rounding).toMatchObject({ accountId: R, debitBase: "0.01", creditBase: "0" });
    const t = totals(lines, "SRD");
    expect(t.debit.equals(t.credit)).toBe(true);

    expect(() => buildLines([{ accountId: A, debit: "1", currency: "USD", rate: "38" }, { accountId: B, credit: "38.05" }], "SRD", R)).toThrow(/unbalanced/);
  });

  it("reverses lines by swapping sides", () => {
    const lines = buildLines([{ accountId: A, debit: "250" }, { accountId: B, credit: "250" }], "SRD");
    const rev = reverseLines(lines);
    expect(rev[0]).toMatchObject({ debitBase: "0", creditBase: "250.00", txAmount: "-250" });
    expect(rev[1]).toMatchObject({ debitBase: "250.00", creditBase: "0", txAmount: "250" });
  });
});

describe("property: any accepted entry is balanced", () => {
  it("holds for 2 000 random entries with mixed currencies", () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let n = 0; n < 2000; n++) {
      const count = 1 + Math.floor(rnd() * 5);
      const inputs = [];
      let sum = new Decimal(0);
      for (let i = 0; i < count; i++) {
        const usd = rnd() < 0.4;
        const amt = new Decimal(Math.floor(rnd() * 1_000_000)).dividedBy(100);
        if (amt.isZero()) continue;
        const rate = usd ? new Decimal(35 + rnd() * 5).toDecimalPlaces(4) : new Decimal(1);
        inputs.push({ accountId: A, debit: amt.toFixed(2), currency: usd ? "USD" : "SRD", rate: usd ? rate.toString() : undefined });
        sum = sum.plus(amt.times(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
      }
      if (inputs.length === 0) continue;
      inputs.push({ accountId: B, credit: sum.toFixed(2) });
      const lines = buildLines(inputs, "SRD", R);
      const t = totals(lines, "SRD");
      expect(t.debit.equals(t.credit)).toBe(true);
      for (const l of lines) expect(new Decimal(l.debitBase).gt(0) !== new Decimal(l.creditBase).gt(0)).toBe(true);
    }
  });
});
