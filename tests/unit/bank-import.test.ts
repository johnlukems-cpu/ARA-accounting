import { describe, expect, it } from "vitest";
import { matchScore, parseAmount, parseCsv, parseDate, parseStatement, type ImportProfile } from "@/modules/banking/csv-import";

const profile: ImportProfile = {
  delimiter: ";", hasHeader: true, dateColumn: 0, dateFormat: "DD-MM-YYYY", amountColumn: 2, decimalSeparator: ",",
  descriptionColumn: 1, counterpartyColumn: 3, referenceColumn: 4,
};

describe("CSV parsing", () => {
  it("handles quotes, escaped quotes, embedded delimiters and newlines", () => {
    expect(parseCsv('a;"b;c";"d ""e"""\r\n"f\ng";h\n', ";")).toEqual([["a", "b;c", 'd "e"'], ["f\ng", "h"]]);
  });

  it("parses Surinamese date and amount formats", () => {
    expect(parseDate("05-03-2026", "DD-MM-YYYY")).toBe("2026-03-05");
    expect(parseDate("3/5/26", "MM/DD/YYYY")).toBe("2026-03-05");
    expect(() => parseDate("31-02-2026", "DD-MM-YYYY")).toThrow();
    expect(parseAmount("1.234,56", ",").toString()).toBe("1234.56");
    expect(parseAmount("-2.000,00", ",").toString()).toBe("-2000");
    expect(parseAmount("(150.25)", ".").toString()).toBe("-150.25");
    expect(parseAmount("75,00-", ",").toString()).toBe("-75");
  });

  it("builds signed lines with stable hashes; identical lines in one file stay distinct", () => {
    const csv = "Datum;Omschrijving;Bedrag;Tegenpartij;Ref\n10-03-2026;Betaling VF2026-00001;6.600,00;Klant Wanica NV;R1\n11-03-2026;Bankkosten;-25,00;;R2\n11-03-2026;Bankkosten;-25,00;;R2\n";
    const lines = parseStatement(csv, profile);
    expect(lines.map((l) => [l.bookingDate, l.amount])).toEqual([["2026-03-10", "6600.00"], ["2026-03-11", "-25.00"], ["2026-03-11", "-25.00"]]);
    expect(new Set(lines.map((l) => l.lineHash)).size).toBe(3);
    expect(parseStatement(csv, profile).map((l) => l.lineHash)).toEqual(lines.map((l) => l.lineHash));
  });

  it("supports separate debit/credit columns and reports the failing line", () => {
    const p: ImportProfile = { ...profile, amountColumn: undefined, debitColumn: 2, creditColumn: 3, counterpartyColumn: undefined, referenceColumn: undefined };
    const lines = parseStatement("D;O;Af;Bij\n01-04-2026;Huur;5.000,00;\n02-04-2026;Ontvangst;;1.100,00\n", p);
    expect(lines.map((l) => l.amount)).toEqual(["-5000.00", "1100.00"]);
    expect(() => parseStatement("D;O;Af;Bij\n01-04-2026;Huur;abc;\n", p)).toThrow(expect.objectContaining({ key: "banking.invalidAmount", values: expect.objectContaining({ line: 2 }) }));
  });
});

describe("match scoring", () => {
  it("ranks exact amount + invoice number + name highest", () => {
    const tx = { amount: "6600.00", description: "Betaling VF2026-00001 rijst", counterpartyName: "KLANT WANICA" };
    expect(matchScore(tx, { remaining: "6600.00", documentNumber: "VF2026-00001", partyName: "Klant Wanica NV" })).toBe(100);
    expect(matchScore(tx, { remaining: "6600.00", documentNumber: "VF2026-00002", partyName: "Overige Handel" })).toBe(50);
    expect(matchScore(tx, { remaining: "9000.00", documentNumber: "VF2026-00007", partyName: "Andere" })).toBe(15);
  });
});
