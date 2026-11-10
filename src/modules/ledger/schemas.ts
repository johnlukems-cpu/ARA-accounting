import { z } from "zod";

const opt = (max: number) => z.string().trim().max(max, "validation.tooLong").transform((v) => v || undefined).optional();
const amount = z.string().trim().max(30).regex(/^\d*([.,]\d+)?$/, "validation.amount").optional().transform((v) => (v ? v.replace(",", ".") : undefined));

export const ACCOUNT_CATEGORIES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "COST_OF_SALES", "OPERATING_EXPENSE", "FINANCIAL_INCOME", "FINANCIAL_EXPENSE", "TAX", "SUSPENSE"] as const;
export const CONTROL_TYPES = ["NONE", "RECEIVABLE", "PAYABLE", "BANK", "CASH", "CURRENT_ACCOUNT", "FIXED_ASSET", "TAX", "ROUNDING", "FX_RESULT", "RETAINED_EARNINGS", "SUSPENSE"] as const;
export const JOURNAL_TYPES = ["PURCHASE", "SALES", "BANK", "CASH", "GENERAL", "OPENING", "FIXED_ASSET", "DEPRECIATION", "TAX", "FX_ADJUSTMENT", "CLOSING"] as const;

export const accountSchema = z.object({
  administrationId: z.string().min(1),
  number: z.string().trim().min(1, "validation.required").max(12).regex(/^[0-9A-Za-z.-]+$/, "validation.code"),
  name: z.string().trim().min(2, "validation.required").max(120),
  nameEn: opt(120),
  description: opt(500),
  category: z.enum(ACCOUNT_CATEGORIES),
  type: z.enum(["HEADER", "DETAIL"]).default("DETAIL"),
  parentId: opt(40),
  normalBalance: z.enum(["DEBIT", "CREDIT"]).optional(),
  controlType: z.enum(CONTROL_TYPES).default("NONE"),
  currency: z.string().trim().toUpperCase().regex(/^([A-Z]{3})?$/, "validation.currency").transform((v) => v || undefined).optional(),
});

export const accountUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(2, "validation.required").max(120),
  nameEn: opt(120),
  description: opt(500),
  parentId: opt(40),
  status: z.enum(["ACTIVE", "ARCHIVED"]),
});

export const journalSchema = z.object({
  administrationId: z.string().min(1),
  code: z.string().trim().min(1, "validation.required").max(10).regex(/^[A-Za-z0-9_-]+$/, "validation.code"),
  name: z.string().trim().min(2, "validation.required").max(80),
  type: z.enum(JOURNAL_TYPES),
  requiresApproval: z.boolean(),
});

export const dimensionSchema = z.object({
  administrationId: z.string().min(1),
  type: z.enum(["COST_CENTER", "PROJECT", "DEPARTMENT"]),
  code: z.string().trim().min(1, "validation.required").max(20).regex(/^[A-Za-z0-9_-]+$/, "validation.code"),
  name: z.string().trim().min(2, "validation.required").max(80),
});

export const lineSchema = z.object({
  accountId: z.string().min(1, "validation.required"),
  description: opt(200),
  debit: amount,
  credit: amount,
  currency: z.string().trim().toUpperCase().regex(/^([A-Z]{3})?$/).optional().transform((v) => v || undefined),
  rate: amount,
  costCenterId: opt(40),
  projectId: opt(40),
  departmentId: opt(40),
});

export const entrySchema = z.object({
  administrationId: z.string().min(1),
  journalId: z.string().min(1, "validation.required"),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date"),
  documentDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, "validation.date").optional().transform((v) => v || undefined),
  description: z.string().trim().min(2, "validation.required").max(500),
  reference: opt(100),
  idempotencyKey: z.string().max(100).optional(),
  lines: z.array(lineSchema).min(2, "ledger.minTwoLines").max(500),
});

export const reverseSchema = z.object({
  entryId: z.string().min(1),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date"),
  reason: z.string().trim().min(3, "validation.required").max(500),
  mode: z.enum(["reverse", "correct"]).default("reverse"),
});

export const trialBalanceSchema = z.object({
  fiscalYearId: z.string().optional(),
  fromPeriod: z.coerce.number().int().min(0).max(13).default(0),
  toPeriod: z.coerce.number().int().min(0).max(13).default(13),
  accountFrom: z.string().trim().max(12).optional(),
  accountTo: z.string().trim().max(12).optional(),
  journalId: z.string().optional(),
  hideZero: z.coerce.boolean().default(true),
});
