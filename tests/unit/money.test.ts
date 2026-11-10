import { describe, expect, it } from "vitest";
import { Money, MoneyError, formatMoney, parseAmount, sum } from "@/core/money";

describe("Money", () => {
  it("uses decimal arithmetic (0.1 + 0.2 = 0.30)", () => {
    expect(Money.of("0.1", "SRD").add(Money.of("0.2", "SRD")).toString()).toBe("0.30");
  });

  it("rounds half away from zero to the currency minor unit", () => {
    expect(Money.of("2.345", "SRD").toString()).toBe("2.35");
    expect(Money.of("-2.345", "SRD").toString()).toBe("-2.35");
    expect(Money.of("2.344", "USD").toString()).toBe("2.34");
  });

  it("refuses JS numbers, invalid amounts and invalid currency codes", () => {
    expect(() => Money.of(1.5 as unknown as string, "SRD")).toThrow(MoneyError);
    expect(() => Money.of("abc", "SRD")).toThrow(MoneyError);
    expect(() => Money.of("1", "$")).toThrow(MoneyError);
  });

  it("refuses to add different currencies", () => {
    expect(() => Money.of("1", "SRD").add(Money.of("1", "USD"))).toThrow(/Currency mismatch/);
  });

  it("converts USD 1,000 at 38 into SRD 38,000.00 (ACCOUNTING_RULES §5 example)", () => {
    const srd = Money.of("1000", "USD").convert("SRD", "38.0000");
    expect(srd.equals(Money.of("38000", "SRD"))).toBe(true);
  });

  it("computes the realised exchange loss of SRD 500 when paid at 38.5", () => {
    const usd = Money.of("1000", "USD");
    const atInvoice = usd.convert("SRD", "38");
    const atPayment = usd.convert("SRD", "38.5");
    expect(atPayment.subtract(atInvoice).toString()).toBe("500.00");
  });

  it("refuses zero or negative rates", () => {
    expect(() => Money.of("1", "USD").convert("SRD", "0")).toThrow(MoneyError);
    expect(() => Money.of("1", "USD").convert("SRD", "-38")).toThrow(MoneyError);
  });

  it("allocates without losing a cent", () => {
    const parts = Money.of("100", "SRD").allocate([1, 1, 1]);
    expect(parts.map(String)).toEqual(["33.34", "33.33", "33.33"]);
    expect(sum(parts, "SRD").toString()).toBe("100.00");
    const neg = Money.of("-0.05", "SRD").allocate([1, 1]);
    expect(sum(neg, "SRD").toString()).toBe("-0.05");
  });

  it("allocates monthly depreciation that sums exactly to the annual amount", () => {
    const months = Money.of("10000", "SRD").allocate(Array(12).fill(1));
    expect(sum(months, "SRD").toString()).toBe("10000.00");
    expect(new Set(months.map(String))).toEqual(new Set(["833.34", "833.33"]));
  });
});

describe("parseAmount", () => {
  it.each([
    ["1.234,56", "nl", "1234.56"],
    ["1,234.56", "nl", "1234.56"],
    ["38000", "nl", "38000"],
    ["12,5", "nl", "12.5"],
    ["12.5", "en", "12.5"],
    ["1.234", "nl", "1234"],
    ["1,234", "en", "1234"],
    ["1.234.567", "en", "1234567"],
    ["-1.000,00", "nl", "-1000"],
    ["(250,00)", "nl", "-250"],
    ["SRD 38.000,00", "nl", "38000"],
  ] as const)("parses %s (%s) → %s", (input, locale, expected) => {
    expect(parseAmount(input, locale)).toBe(expected);
  });

  it.each(["", "abc", "1,2,3.4.5x", "--1"])("rejects %j", (input) => {
    expect(() => parseAmount(input)).toThrow(MoneyError);
  });
});

describe("formatMoney", () => {
  it("formats in Surinamese Dutch with the ISO code", () => {
    expect(formatMoney(Money.of("38000", "SRD"))).toBe("SRD 38.000,00");
    expect(formatMoney(Money.of("-1234567.5", "USD"))).toBe("USD -1.234.567,50");
  });

  it("formats in English", () => {
    expect(formatMoney(Money.of("38000", "SRD"), "en")).toBe("SRD 38,000.00");
  });
});
