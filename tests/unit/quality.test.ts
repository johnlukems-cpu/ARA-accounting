import { describe, expect, it } from "vitest";
import { CHECK_CODES, CHECKS, qualityScore } from "@/modules/quality/checks";

describe("quality monitor", () => {
  it("has exactly 12 checks, each implemented", () => {
    expect(CHECK_CODES).toHaveLength(12);
    for (const c of CHECK_CODES) expect(typeof CHECKS[c]).toBe("function");
  });
  it("score: −10 per error, −3 per warning, −1 per info, never below 0", () => {
    expect(qualityScore([])).toBe(100);
    expect(qualityScore([{ severity: "ERROR" }, { severity: "WARNING" }, { severity: "INFO" }])).toBe(86);
    expect(qualityScore(Array(20).fill({ severity: "ERROR" }))).toBe(0);
  });
});
