import { describe, expect, it } from "vitest";
import { buildLines } from "@/core/ledger/domain";
import { fxPolicyOf, parseCbvsCsv, revaluationLines } from "@/modules/currency/domain";

describe("CBvS rate file", () => {
  it("parses dates, decimal commas and both separators, and reports bad lines", () => {
    const { rows, errors } = parseCbvsCsv("datum;valuta;aankoop;verkoop\n03-11-2026;usd;37,8500;38,1500\n2026-11-03,EUR,40.10,41.20\n31-02-2026;USD;1;2\n04-11-2026;USD;39,00;38,00\n05-11-2026;XX;1;2\n");
    expect(rows).toEqual([
      { date: "2026-11-03", currency: "USD", buy: "37.85", sell: "38.15" },
      { date: "2026-11-03", currency: "EUR", buy: "40.1", sell: "41.2" },
    ]);
    expect(errors).toEqual([{ line: 4, key: "currency.csvDate" }, { line: 5, key: "currency.csvBuyAboveSell" }, { line: 6, key: "currency.csvCurrency" }]);
  });
});

describe("revaluation (C5)", () => {
  it("revalues to the closing rate and reports currencies without a rate", () => {
    const r = revaluationLines([
      { accountId: "bank", number: "1101", name: "Bank USD", currency: "USD", tx: "1000", base: "38000" },
      { accountId: "cred", number: "1610", name: "Crediteuren", currency: "USD", tx: "-500", base: "-19250" },
      { accountId: "deb", number: "1310", name: "Debiteuren", currency: "EUR", tx: "200", base: "8200" },
      { accountId: "deb", number: "1310", name: "Debiteuren", currency: "USD", tx: "100", base: "3850" },
    ], { USD: "38.5" });
    // The creditor is already at 38.50 (no line); the USD debtor at 38.50 neither; EUR has no rate.
    expect(r.lines.map((l) => [l.number, l.revalued, l.difference])).toEqual([["1101", "38500.00", "500.00"]]);
    expect(r.missing).toEqual(["EUR"]);
    expect(r.total).toBe("500.00");
  });

  it("an adjustment line changes only the base value", () => {
    const lines = buildLines([
      { accountId: "bank", currency: "USD", rate: "38.5", debit: "500", fxAdjustment: true },
      { accountId: "fx", credit: "500" },
    ], "SRD");
    expect(lines[0]).toMatchObject({ txCurrency: "USD", txAmount: "0", debitBase: "500.00", exchangeRate: "38.5", rateSource: "REVALUATION" });
    expect(() => buildLines([{ accountId: "a", currency: "SRD", rate: "1", debit: "1", fxAdjustment: true }, { accountId: "b", credit: "1" }], "SRD")).toThrow();
  });

  it("policy falls back to the documented defaults", () => {
    expect(fxPolicyOf({})).toMatchObject({ sales: "CBVS_BUY", purchase: "CBVS_SELL", revaluation: "CLOSING", maxAgeDays: 7, revaluationMode: "AUTO_REVERSE" });
    expect(fxPolicyOf({ fxPolicy: { sales: "MANUAL" } }).sales).toBe("MANUAL");
  });
});
