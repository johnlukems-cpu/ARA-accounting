import { describe, expect, it } from "vitest";
import { fiscalYearCode, fiscalYearRange, isoDate, periodForDate, planPeriods, toDateOnly } from "@/modules/organization/periods";

describe("fiscal-year calendar", () => {
  it("builds a calendar year with periods 0, 1–12 and 13", () => {
    const { startDate, endDate } = fiscalYearRange(2026, 1);
    expect(isoDate(startDate)).toBe("2026-01-01");
    expect(isoDate(endDate)).toBe("2026-12-31");
    expect(fiscalYearCode(startDate, endDate)).toBe("2026");
    const periods = planPeriods(startDate, endDate);
    expect(periods.map((p) => p.number)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(isoDate(periods[2]!.endDate)).toBe("2026-02-28");
    expect(isoDate(periods[12]!.startDate)).toBe("2026-12-01");
    expect(isoDate(periods[13]!.startDate)).toBe("2026-12-31");
  });

  it("supports a deviating fiscal year (gebroken boekjaar) and leap years", () => {
    const { startDate, endDate } = fiscalYearRange(2027, 7);
    expect(isoDate(endDate)).toBe("2028-06-30");
    expect(fiscalYearCode(startDate, endDate)).toBe("2027/2028");
    const feb = planPeriods(startDate, endDate).find((p) => p.number === 8)!;
    expect(isoDate(feb.endDate)).toBe("2028-02-29");
  });

  it("finds the regular period for a date", () => {
    const { startDate, endDate } = fiscalYearRange(2026, 1);
    const periods = planPeriods(startDate, endDate);
    expect(periodForDate(periods, toDateOnly("2026-03-31"))?.number).toBe(3);
    expect(periodForDate(periods, toDateOnly("2027-01-01"))).toBeUndefined();
  });

  it("rejects invalid input", () => {
    expect(() => fiscalYearRange(2026, 13)).toThrow();
    expect(() => toDateOnly("2026-02-30")).toThrow();
    expect(() => planPeriods(toDateOnly("2026-01-15"), toDateOnly("2026-12-31"))).toThrow();
  });
});
