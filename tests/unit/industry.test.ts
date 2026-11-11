import { describe, expect, it } from "vitest";
import { contentHash, diffContent, validateContent, type TemplateContent } from "@/modules/industry/content";
import { PLATFORM_TEMPLATES } from "@/modules/industry/library";

const empty: TemplateContent = { accounts: [], journals: [], assetCategories: [], dimensions: [], kpis: [] };
const acc = (number: string, extra: object = {}) => ({ ref: `a${number}`, number, name: `Rekening ${number}`, nameEn: `Account ${number}`, category: "REVENUE" as const, parent: "8000", ...extra });

describe("industry template library", () => {
  it("has the 15 required Surinamese templates, the 4 proposed ones and the general template", () => {
    expect(PLATFORM_TEMPLATES).toHaveLength(20);
    expect(PLATFORM_TEMPLATES.filter((t) => t.proposed).map((t) => t.code)).toEqual(["MINING", "OILGAS", "FORESTRY", "FISHERIES"]);
    expect(new Set(PLATFORM_TEMPLATES.map((t) => t.code)).size).toBe(20);
  });

  it.each(PLATFORM_TEMPLATES.map((t) => [t.code, t] as const))("%s combines with the base chart without issues", (_code, t) => {
    expect(validateContent(t.content).issues).toEqual([]);
  });
});

describe("template content validation", () => {
  it("rejects numbers of the base chart, reserved module ranges, duplicate refs and unknown parents", () => {
    const { issues } = validateContent({ ...empty, accounts: [acc("8010"), acc("1105"), acc("8150"), acc("8160", { ref: "a8150" }), acc("8170", { parent: "8010" })] });
    expect(issues.map((i) => i.key)).toEqual(["industry.issueDuplicateNumber", "industry.issueReservedNumber", "industry.issueDuplicateRef", "industry.issueParent"]);
  });

  it("checks asset categories, journal codes and KPI codes", () => {
    const { issues } = validateContent({ ...empty, assetCategories: [{ code: "XX", name: "Fout", asset: "8010", accumulated: "0105", lifeMonths: 12 }], journals: [{ code: "MEM", name: "Dubbel", type: "GENERAL" }], kpis: ["madeUp"] });
    expect(issues.map((i) => i.key)).toEqual(["industry.issueAssetCategory", "industry.issueJournal", "industry.issueKpi"]);
  });

  it("hash ignores key order and changes with content", () => {
    const a = { ...empty, accounts: [acc("8150")] };
    const b = { kpis: [], dimensions: [], assetCategories: [], journals: [], accounts: [{ parent: "8000", category: "REVENUE" as const, nameEn: "Account 8150", name: "Rekening 8150", number: "8150", ref: "a8150" }] };
    expect(contentHash(a)).toBe(contentHash(b));
    expect(contentHash({ ...a, kpis: ["dso"] })).not.toBe(contentHash(a));
  });

  it("diff reports new, changed and removed accounts by ref", () => {
    const from = { ...empty, accounts: [acc("8150"), acc("8160")] };
    const to = { ...empty, accounts: [acc("8150", { name: "Nieuwe naam" }), acc("8170")], journals: [{ code: "PRJ", name: "Projecten", type: "GENERAL" as const }] };
    const d = diffContent(from, to);
    expect(d.newAccounts.map((a) => a.number)).toEqual(["8170"]);
    expect(d.changedAccounts.map((c) => c.to.name)).toEqual(["Nieuwe naam"]);
    expect(d.removedAccounts.map((a) => a.number)).toEqual(["8160"]);
    expect(d.newJournals.map((j) => j.code)).toEqual(["PRJ"]);
  });
});
