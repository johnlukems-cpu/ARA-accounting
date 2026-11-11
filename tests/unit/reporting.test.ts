import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { bsLine, plLine, type AccountMeta } from "@/modules/reporting/mapping";
import { forecastBuckets } from "@/modules/reporting/forecast";
import { computeKpis } from "@/modules/reporting/statements";

const acc = (number: string, category: AccountMeta["category"], parentNumber: string | null, controlType: AccountMeta["controlType"] = "NONE"): AccountMeta => ({ id: number, number, name: number, category, controlType, parentNumber, normalBalance: "DEBIT" });

describe("report mapping (R1)", () => {
  it("maps P&L accounts by category and the standard number ranges", () => {
    expect(plLine(acc("4010", "OPERATING_EXPENSE", "4000"))).toBe("PERSONNEL");
    expect(plLine(acc("4800", "OPERATING_EXPENSE", "4000"))).toBe("DEPRECIATION");
    expect(plLine(acc("4950", "OPERATING_EXPENSE", "4000"))).toBe("INCOME_TAX");
    expect(plLine(acc("4740", "OPERATING_EXPENSE", "4000"))).toBe("OTHER_OPEX");
    expect(plLine(acc("8140", "REVENUE", "8000"))).toBe("REVENUE"); // template account
    expect(plLine(acc("8090", "REVENUE", "8000"))).toBe("OTHER_INCOME");
  });
  it("maps balance-sheet accounts by parent/control; tax and suspense follow the sign of the balance", () => {
    expect(bsLine(acc("1101", "ASSET", "1100", "BANK"), true)).toBe("CASH");
    expect(bsLine(acc("0210", "ASSET", "0000", "FIXED_ASSET"), true)).toBe("FIXED_ASSETS");
    expect(bsLine(acc("1345", "ASSET", "1300"), true)).toBe("RECEIVABLES");
    expect(bsLine(acc("1420", "TAX", "1400", "TAX"), false)).toBe("TAX_LIABILITIES");
    expect(bsLine(acc("1410", "TAX", "1400", "TAX"), true)).toBe("TAX_ASSETS");
    expect(bsLine(acc("1910", "SUSPENSE", "1900", "SUSPENSE"), false)).toBe("CURRENT_LIABILITIES");
    expect(bsLine(acc("0710", "LIABILITY", "0700"), false)).toBe("LONG_TERM_LIABILITIES");
  });
});

describe("KPIs (R2)", () => {
  it("division by zero gives null (n.v.t.), never 0", () => {
    const empty = { lines: [], totals: { revenue: "0.00", grossMargin: "0.00", operatingResult: "0.00", resultBeforeTax: "0.00", netResult: "0.00" } };
    const bs = { assets: [], liabilities: [], result: "0.00", totals: { assets: "0.00", liabilitiesAndEquity: "0.00", equity: "0.00" }, balanced: true };
    const k = computeKpis({ pl: empty, bs, days: 30 });
    expect(k.every((x) => x.value === null)).toBe(true);
    expect(k.every((x) => x.formula.length > 5)).toBe(true);
  });
});

describe("cash-flow forecast (R3)", () => {
  const base = { today: new Date("2026-03-01T00:00:00Z"), horizonDays: 90, openingCash: "1000", budgetByMonth: new Map([["2026-04", new Decimal("250")]]) };
  const receivables = [{ due: new Date("2026-03-10T00:00:00Z"), amount: new Decimal("500") }, { due: new Date("2026-02-01T00:00:00Z"), amount: new Decimal("200") }];
  const payables = [{ due: new Date("2026-04-15T00:00:00Z"), amount: new Decimal("300") }];
  it("base: overdue items in the first bucket, budget for later months, running balance", () => {
    const b = forecastBuckets({ ...base, receivables, payables, scenario: "BASE" });
    expect(b.map((x) => [x.from, x.receipts, x.payments, x.budget, x.closing])).toEqual([
      ["2026-03-01", "700.00", "0.00", "0.00", "1700.00"],
      ["2026-03-31", "0.00", "300.00", "250.00", "1650.00"],
      ["2026-04-30", "0.00", "0.00", "0.00", "1650.00"],
    ]);
  });
  it("worst: receipts 30 days later and 90% collected", () => {
    const b = forecastBuckets({ ...base, receivables, payables, scenario: "WORST" });
    expect(b.map((x) => x.receipts)).toEqual(["180.00", "450.00", "0.00"]);
  });
});
