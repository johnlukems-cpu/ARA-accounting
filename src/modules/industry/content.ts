import { createHash } from "node:crypto";
import { z } from "zod";
import { STANDARD_CHART, STANDARD_JOURNALS } from "@/modules/ledger/standard-chart";

/**
 * Industry template content. A template is always applied on top of "ARA Standaard Suriname" (the base chart);
 * the content lists only the additions. Everything listed here is applied to a new administration, except `kpis`,
 * which are KPI codes the reporting module (phase 8) shows first for this industry.
 */
const CATEGORIES = ["ASSET", "LIABILITY", "EQUITY", "TAX", "SUSPENSE", "REVENUE", "COST_OF_SALES", "OPERATING_EXPENSE", "FINANCIAL_INCOME", "FINANCIAL_EXPENSE"] as const;
const CONTROLS = ["NONE", "FIXED_ASSET"] as const;
const number = z.string().regex(/^\d{4}$/, "validation.code");
const ref = z.string().regex(/^[a-z0-9_-]{1,40}$/i, "validation.code");

export const templateAccountSchema = z.object({
  ref,
  number,
  name: z.string().trim().min(2).max(120),
  nameEn: z.string().trim().min(2).max(120),
  category: z.enum(CATEGORIES),
  parent: number,
  header: z.boolean().optional(),
  normal: z.enum(["DEBIT", "CREDIT"]).optional(),
  control: z.enum(CONTROLS).optional(),
});

export const templateContentSchema = z.object({
  accounts: z.array(templateAccountSchema).max(200).default([]),
  journals: z.array(z.object({ code: z.string().regex(/^[A-Z0-9]{2,6}$/, "validation.code"), name: z.string().trim().min(2).max(80), type: z.enum(["PURCHASE", "SALES", "GENERAL", "CASH", "BANK"]), requiresApproval: z.boolean().optional() })).max(20).default([]),
  assetCategories: z.array(z.object({ code: z.string().regex(/^[A-Z0-9]{2,8}$/, "validation.code"), name: z.string().trim().min(2).max(80), asset: number, accumulated: number, lifeMonths: z.number().int().min(1).max(1200) })).max(20).default([]),
  dimensions: z.array(z.object({ type: z.enum(["COST_CENTER", "PROJECT", "DEPARTMENT"]), code: z.string().regex(/^[A-Z0-9_-]{1,20}$/i, "validation.code"), name: z.string().trim().min(2).max(80) })).max(50).default([]),
  kpis: z.array(z.string().regex(/^[a-zA-Z]{2,40}$/)).max(20).default([]),
});

export type TemplateContent = z.infer<typeof templateContentSchema>;
export type TemplateAccount = z.infer<typeof templateAccountSchema>;

export const KPI_CODES = ["grossMargin", "netMargin", "currentRatio", "quickRatio", "solvency", "dso", "dpo", "inventoryTurnover", "personnelCostRatio", "fundBalance", "revenueGrowth"] as const;

/** Account numbers that modules create on demand (cash 1040+, banks 1101+, current accounts 1351+/1651+); templates stay clear of them. */
const RESERVED = (n: number) => (n >= 1040 && n <= 1089) || (n >= 1101 && n <= 1199) || (n >= 1351 && n <= 1399) || (n >= 1651 && n <= 1699);

export type ContentIssue = { key: string; values?: Record<string, string> };

/** Business validation on top of the schema: the content must combine with the base chart into one consistent chart. */
export function validateContent(raw: unknown): { content: TemplateContent; issues: ContentIssue[] } {
  const content = templateContentSchema.parse(raw);
  const issues: ContentIssue[] = [];
  const base = new Map(STANDARD_CHART.map((a) => [a.number, a]));
  const own = new Map<string, TemplateAccount>();
  const refs = new Set<string>();
  for (const a of content.accounts) {
    if (base.has(a.number) || own.has(a.number)) issues.push({ key: "industry.issueDuplicateNumber", values: { number: a.number } });
    if (refs.has(a.ref)) issues.push({ key: "industry.issueDuplicateRef", values: { ref: a.ref } });
    if (RESERVED(Number(a.number))) issues.push({ key: "industry.issueReservedNumber", values: { number: a.number } });
    own.set(a.number, a);
    refs.add(a.ref);
  }
  for (const a of content.accounts) {
    const parent = base.get(a.parent) ?? own.get(a.parent);
    if (!parent || !parent.header) issues.push({ key: "industry.issueParent", values: { number: a.number, parent: a.parent } });
  }
  const isFixedAssetDetail = (n: string) => {
    const a = base.get(n) ?? own.get(n);
    return !!a && !a.header && a.control === "FIXED_ASSET";
  };
  for (const c of content.assetCategories) {
    if (!isFixedAssetDetail(c.asset) || !isFixedAssetDetail(c.accumulated) || c.asset === c.accumulated) issues.push({ key: "industry.issueAssetCategory", values: { code: c.code } });
  }
  const journalCodes = new Set(STANDARD_JOURNALS.map((j) => j.code));
  for (const j of content.journals) {
    if (journalCodes.has(j.code)) issues.push({ key: "industry.issueJournal", values: { code: j.code } });
    journalCodes.add(j.code);
  }
  for (const k of content.kpis) if (!(KPI_CODES as readonly string[]).includes(k)) issues.push({ key: "industry.issueKpi", values: { code: k } });
  return { content, issues };
}

/** Canonical JSON (sorted keys) → SHA-256; used to detect whether a template changed. */
export function contentHash(content: TemplateContent): string {
  const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v);
  return createHash("sha256").update(JSON.stringify(canon(content))).digest("hex");
}

/** Difference between two versions (by account ref / journal code / category code / dimension code). */
export function diffContent(from: TemplateContent, to: TemplateContent) {
  const accFrom = new Map(from.accounts.map((a) => [a.ref, a]));
  const accTo = new Map(to.accounts.map((a) => [a.ref, a]));
  return {
    newAccounts: to.accounts.filter((a) => !accFrom.has(a.ref)),
    changedAccounts: to.accounts.filter((a) => accFrom.has(a.ref) && JSON.stringify(accFrom.get(a.ref)) !== JSON.stringify(a)).map((a) => ({ from: accFrom.get(a.ref)!, to: a })),
    removedAccounts: from.accounts.filter((a) => !accTo.has(a.ref)),
    newJournals: to.journals.filter((j) => !from.journals.some((x) => x.code === j.code)),
    newAssetCategories: to.assetCategories.filter((c) => !from.assetCategories.some((x) => x.code === c.code)),
    newDimensions: to.dimensions.filter((d) => !from.dimensions.some((x) => x.type === d.type && x.code === d.code)),
  };
}
