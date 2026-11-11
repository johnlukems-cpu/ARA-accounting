import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { defaultDepreciationStart, depreciationSchedule } from "@/modules/assets/schedule";

const sum = (lines: { amount: string }[]) => lines.reduce((s, l) => s.plus(l.amount), new Decimal(0)).toFixed(2);

describe("depreciation schedules (A1, A2)", () => {
  it("straight-line: 36 months, sums exactly to cost − residual, book value ends at residual", () => {
    const s = depreciationSchedule({ cost: "100000", residual: "10000", usefulLifeMonths: 36, method: "STRAIGHT_LINE", start: new Date("2026-02-01") });
    expect(s).toHaveLength(36);
    expect(sum(s)).toBe("90000.00");
    expect(s[0]).toMatchObject({ year: 2026, month: 2, amount: "2500.00" });
    expect(s[11]).toMatchObject({ year: 2027, month: 1 });
    expect(s[35]!.bookValueAfter).toBe("10000.00");
  });

  it("straight-line with an uneven amount loses no cent", () => {
    const s = depreciationSchedule({ cost: "1000", residual: "0", usefulLifeMonths: 7, method: "STRAIGHT_LINE", start: new Date("2026-01-01") });
    expect(sum(s)).toBe("1000.00");
    expect(new Set(s.map((l) => l.amount))).toEqual(new Set(["142.86", "142.85"]));
  });

  it("declining balance: 40% per year, never below residual, written down to residual at the end", () => {
    const s = depreciationSchedule({ cost: "50000", residual: "5000", usefulLifeMonths: 60, method: "DECLINING_BALANCE", decliningRatePct: "40", start: new Date("2026-01-01") });
    expect(s[0]!.amount).toBe("1666.67"); // 50,000 × 40% / 12
    expect(new Decimal(s[1]!.amount).lt(s[0]!.amount)).toBe(true);
    expect(sum(s)).toBe("45000.00");
    expect(s[s.length - 1]!.bookValueAfter).toBe("5000.00");
  });

  it("rejects invalid input", () => {
    expect(() => depreciationSchedule({ cost: "100", residual: "100", usefulLifeMonths: 12, method: "STRAIGHT_LINE", start: new Date("2026-01-01") })).toThrow();
    expect(() => depreciationSchedule({ cost: "100", residual: "0", usefulLifeMonths: 0, method: "STRAIGHT_LINE", start: new Date("2026-01-01") })).toThrow();
    expect(() => depreciationSchedule({ cost: "100", residual: "0", usefulLifeMonths: 12, method: "DECLINING_BALANCE", start: new Date("2026-01-01") })).toThrow();
  });

  it("default start is the first day of the month after acquisition", () => {
    expect(defaultDepreciationStart("2026-12-15")).toBe("2027-01-01");
  });
});
