import { z } from "zod";
import { DISTRICTS } from "@/modules/organization/schemas";

const opt = (max: number) => z.string().trim().max(max, "validation.tooLong").transform((v) => v || undefined).optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date");
const decimalStr = (msg = "validation.amount") =>
  z.string().trim().transform((v) => v.replace(",", ".")).pipe(z.string().regex(/^-?\d+(\.\d+)?$/, msg));
const positiveAmount = decimalStr().refine((v: string) => Number(v) > 0, "validation.positive");
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "validation.currency");

export const partySchema = z.object({
  administrationId: z.string().min(1),
  code: z.string().trim().min(1, "validation.required").max(20).regex(/^[A-Za-z0-9_-]+$/, "validation.code"),
  name: z.string().trim().min(2, "validation.required").max(160),
  isCustomer: z.boolean(),
  isSupplier: z.boolean(),
  kkfNumber: opt(30), taxNumber: opt(30), btwNumber: opt(30),
  email: z.string().trim().toLowerCase().email("validation.email").or(z.literal("")).transform((v) => v || undefined).optional(),
  phone: opt(40), address: opt(200),
  district: z.enum(DISTRICTS).or(z.literal("")).transform((v) => v || undefined).optional(),
  currency: currency.default("SRD"),
  paymentTermDays: z.coerce.number().int().min(0).max(365).default(30),
  defaultRevenueAccountId: opt(40), defaultExpenseAccountId: opt(40), defaultTaxCodeId: opt(40),
  bankName: opt(80), bankAccountNumber: opt(40),
}).refine((v) => v.isCustomer || v.isSupplier, { message: "invoicing.customerOrSupplier", path: ["isCustomer"] });

export const invoiceLineSchema = z.object({
  description: z.string().trim().min(1, "validation.required").max(300),
  quantity: decimalStr().refine((v: string) => Number(v) !== 0, "validation.nonZero"),
  unitPrice: decimalStr(),
  discountPct: decimalStr().optional().or(z.literal("").transform(() => undefined)),
  accountId: z.string().min(1, "validation.required"),
  taxCodeId: opt(40),
  costCenterId: opt(40),
  projectId: opt(40),
});

export const invoiceSchema = z.object({
  id: z.string().optional(),
  administrationId: z.string().min(1),
  type: z.enum(["SALES", "PURCHASE"]),
  kind: z.enum(["INVOICE", "CREDIT_NOTE"]).default("INVOICE"),
  partyId: z.string().min(1, "validation.required"),
  externalNumber: opt(60),
  invoiceDate: date,
  dueDate: date,
  currency,
  exchangeRate: decimalStr().optional().or(z.literal("").transform(() => undefined)),
  description: opt(300),
  notes: opt(1000),
  creditsInvoiceId: opt(40),
  lines: z.array(invoiceLineSchema).min(1, "invoicing.minOneLine").max(300),
});

export const financialAccountSchema = z.object({
  administrationId: z.string().min(1),
  kind: z.enum(["BANK", "CASH"]),
  name: z.string().trim().min(2, "validation.required").max(80),
  bankCode: z.enum(["DSB", "HAKRIN", "FINA", "REPUBLIC", "SCB", "GODO", "VCB", "SPSB", "AMANAH", "OTHER"]).optional().or(z.literal("").transform(() => undefined)),
  accountNumber: opt(40),
  currency,
});

export const paymentSchema = z.object({
  administrationId: z.string().min(1),
  direction: z.enum(["IN", "OUT"]),
  financialAccountId: z.string().min(1, "validation.required"),
  partyId: opt(40),
  date,
  amount: positiveAmount,
  exchangeRate: decimalStr().optional().or(z.literal("").transform(() => undefined)),
  reference: opt(100),
  description: opt(300),
  idempotencyKey: z.string().max(100).optional(),
  bankTransactionId: z.string().optional(),
  allocations: z.array(z.object({ openItemId: z.string().min(1), amount: positiveAmount })).max(200).default([]),
});

export const offsetSchema = z.object({ openItemId: z.string().min(1), counterOpenItemId: z.string().min(1), amount: positiveAmount });
