import { z } from "zod";
import { ROLE_CODES } from "@/core/auth/permissions";

/** Shared input schemas (server actions and future REST API). Messages are translation keys. */

const trimmed = (max: number) => z.string().trim().max(max, "validation.tooLong");
const optionalText = (max: number) =>
  z.string().trim().max(max, "validation.tooLong").transform((v) => (v ? v : undefined)).optional();
const optionalEmail = () => z.string().trim().toLowerCase().max(254).email("validation.email").or(z.literal("")).transform((v) => v || undefined).optional();

export const LEGAL_FORMS = ["EENMANSZAAK", "VOF", "CV", "NV", "STICHTING", "VERENIGING", "COOPERATIE", "OVERHEIDS_NV", "KERKGENOOTSCHAP"] as const;
export const DISTRICTS = ["PARAMARIBO", "WANICA", "NICKERIE", "CORONIE", "SARAMACCA", "COMMEWIJNE", "MAROWIJNE", "PARA", "BROKOPONDO", "SIPALIWINI"] as const;
const optionalDistrict = () => z.enum(DISTRICTS).or(z.literal("")).transform((v) => v || undefined).optional();

export const emailSchema = z.string().trim().toLowerCase().max(254).email("validation.email");
export const passwordSchema = z.string().min(12, "validation.passwordTooShort").max(200, "validation.tooLong");

export const registerSchema = z.object({
  kind: z.enum(["BUSINESS", "ACCOUNTING_FIRM"]),
  organizationName: trimmed(120).min(2, "validation.required"),
  name: trimmed(120).min(2, "validation.required"),
  email: emailSchema,
  password: passwordSchema,
});

export const organizationSchema = z.object({
  name: trimmed(120).min(2, "validation.required"),
  email: optionalEmail(),
  phone: optionalText(40),
  address: optionalText(200),
  district: optionalDistrict(),
  kkfNumber: optionalText(30),
  requireMfaForAdmins: z.boolean(),
});

export const companySchema = z.object({
  name: trimmed(120).min(2, "validation.required"),
  legalName: optionalText(200),
  legalForm: z.enum(LEGAL_FORMS),
  kkfNumber: optionalText(30),
  taxNumber: optionalText(30),
  btwNumber: optionalText(30),
  isBtwRegistered: z.boolean(),
  address: optionalText(200),
  district: optionalDistrict(),
  email: optionalEmail(),
  phone: optionalText(40),
});

export const branchSchema = z.object({
  companyId: z.string().min(1),
  code: trimmed(20).min(1, "validation.required").regex(/^[A-Za-z0-9_-]+$/, "validation.code"),
  name: trimmed(120).min(2, "validation.required"),
  address: optionalText(200),
  district: optionalDistrict(),
});

export const currencyCode = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "validation.currency");

export const administrationSchema = z.object({
  companyId: z.string().min(1),
  code: trimmed(20).min(1, "validation.required").regex(/^[A-Za-z0-9_-]+$/, "validation.code"),
  name: trimmed(120).min(2, "validation.required"),
  baseCurrency: currencyCode.default("SRD"),
  startYear: z.coerce.number().int().min(2000, "validation.year").max(2100, "validation.year"),
  startMonth: z.coerce.number().int().min(1).max(12).default(1),
});

export const fiscalYearSchema = z.object({ administrationId: z.string().min(1) });

export const periodStatusSchema = z.object({
  periodId: z.string().min(1),
  status: z.enum(["OPEN", "SOFT_CLOSED", "CLOSED"]),
  reason: optionalText(500),
});

export const inviteSchema = z.object({
  email: emailSchema,
  name: trimmed(120).min(2, "validation.required"),
  roleCode: z.enum(ROLE_CODES),
});

export const membershipUpdateSchema = z.object({
  membershipId: z.string().min(1),
  roleCode: z.enum(ROLE_CODES).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
});

export const assignmentSchema = z.object({
  companyId: z.string().min(1),
  userId: z.string().min(1),
  roleCode: z.enum(ROLE_CODES),
});
