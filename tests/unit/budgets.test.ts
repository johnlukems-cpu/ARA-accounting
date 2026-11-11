import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { distribute, isAlert, natural, parseBudgetCsv, variance } from "@/modules/budgets/domain";

describe("budget arithmetic (B2)", () => {
  it("variance, percentage and utilisation; favourable depends on revenue or cost", () => {
    expect(variance("1000", "1200", "REVENUE")).toEqual({ variance: "200.00", pct: "20.0", utilisation: "120.0", favourable: true });
    expect(variance("1000", "1200", "OPERATING_EXPENSE")).toEqual({ variance: "200.00", pct: "20.0", utilisation: "120.0", favourable: false });
    expect(variance("0", "50", "OPERATING_EXPENSE")).toMatchObject({ pct: null, utilisation: null, favourable: false });
    expect(variance("500", "500", "REVENUE").favourable).toBeNull();
  });

  it("natural amounts: revenue credited is positive, costs debited are positive", () => {
    expect(natural("-1500", "REVENUE").toFixed(2)).toBe("1500.00");
    expect(natural("800", "OPERATING_EXPENSE").toFixed(2)).toBe("800.00");
  });

  it("alerts only for unfavourable variances at or beyond the threshold, and for unbudgeted costs", () => {
    expect(isAlert("1000", "1100", "OPERATING_EXPENSE", "10")).toBe(true);
    expect(isAlert("1000", "1099", "OPERATING_EXPENSE", "10")).toBe(false);
    expect(isAlert("1000", "850", "REVENUE", "10")).toBe(true);
    expect(isAlert("1000", "1500", "REVENUE", "10")).toBe(false);
    expect(isAlert("0", "10", "OPERATING_EXPENSE", "10")).toBe(true);
  });
});

describe("distribution", () => {
  it("spreads evenly without losing a cent", () => {
    const parts = distribute("1000");
    expect(parts.reduce((s, p) => s.plus(p), new Decimal(0)).toFixed(2)).toBe("1000.00");
    expect(new Set(parts)).toEqual(new Set(["83.34", "83.33"]));
  });
  it("follows a pattern (e.g. last year) and falls back to even when the pattern is empty", () => {
    expect(distribute("1200", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 3])).toEqual([...Array(10).fill("0.00"), "300.00", "900.00"]);
    expect(distribute("1200", Array(12).fill(0))).toEqual(Array(12).fill("100.00"));
  });
});

describe("budget import", () => {
  it("reads wide and long layouts with Dutch amounts and reports bad rows", () => {
    const { lines, errors } = parseBudgetCsv("rekening;jan;feb;mrt;apr;mei;jun;jul;aug;sep;okt;nov;dec\n4100;1.000,00;1.000;1000;;;;;;;;;\n8010;3;2.500,50\n4200;13;5\n4300;1;abc\nxx;1;2\n4400;1\n");
    expect(lines.filter((l) => l.account === "4100").map((l) => l.amount).slice(0, 4)).toEqual(["1000", "1000", "1000", "0"]);
    expect(lines.find((l) => l.account === "8010")).toEqual({ account: "8010", period: 3, amount: "2500.5" });
    expect(errors).toEqual([{ line: 4, key: "budgets.csvPeriod" }, { line: 5, key: "budgets.csvAmount" }, { line: 6, key: "budgets.csvAccount" }, { line: 7, key: "budgets.csvColumns" }]);
  });
});
