import Decimal from "decimal.js";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { systemDb } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { audit } from "@/core/audit/audit";
import { assertCan, type Access } from "@/core/auth/access";
import { UserError } from "@/core/errors";
import { ImportError, fileHash, parseStatement, type ImportProfile } from "./csv-import";
import { importProfileSchema } from "./service";

/**
 * Bank statement format library (platform level). A format starts as DRAFT. It becomes VALIDATED only when a REAL
 * statement export from that bank parses without errors AND its line count and totals equal the figures printed on the
 * bank's own statement for the same period. Only the file's SHA-256 and a numeric summary are kept — never the file
 * or its lines. No format is shipped as "compatible" without that evidence.
 */

/** Commercial banks in Suriname for which a sample is requested (the owner confirms the list; see OWNER_ACTION_REGISTER O7). */
export const CANDIDATE_BANKS = ["De Surinaamsche Bank (DSB)", "Hakrinbank", "Finabank", "Republic Bank (Suriname)", "Southern Commercial Bank", "Volkscredietbank", "Godo"] as const;

export interface SampleSummary {
  lineCount: number;
  dateFrom: string;
  dateTo: string;
  totalIn: string;
  totalOut: string;
  withCounterparty: number;
  withReference: number;
}

/** Pure: parses a sample with a profile and summarises it. Throws ImportError with the line number on the first problem. */
export function summariseSample(text: string, profile: ImportProfile): SampleSummary & { sha256: string } {
  const lines = parseStatement(text, profile);
  const dates = lines.map((l) => l.bookingDate).sort();
  let tin = new Decimal(0);
  let tout = new Decimal(0);
  for (const l of lines) {
    const a = new Decimal(l.amount);
    if (a.gt(0)) tin = tin.plus(a);
    else tout = tout.plus(a.abs());
  }
  return {
    sha256: fileHash(text), lineCount: lines.length, dateFrom: dates[0]!, dateTo: dates[dates.length - 1]!, totalIn: tin.toFixed(2), totalOut: tout.toFixed(2),
    withCounterparty: lines.filter((l) => l.counterpartyName).length, withReference: lines.filter((l) => l.bankReference).length,
  };
}

/** Compares a summary with the figures from the bank's own statement. Returns the mismatching fields (empty = match). */
export function compareWithStatement(s: SampleSummary, expected: { lineCount: number; totalIn: string; totalOut: string }): string[] {
  const out: string[] = [];
  if (s.lineCount !== expected.lineCount) out.push("lineCount");
  if (!new Decimal(s.totalIn).equals(new Decimal(expected.totalIn))) out.push("totalIn");
  if (!new Decimal(s.totalOut).equals(new Decimal(expected.totalOut))) out.push("totalOut");
  return out;
}

async function platformAdmin(userId: string) {
  const u = await systemDb.user.findUnique({ where: { id: userId } });
  if (!u?.isPlatformAdmin || !u.isActive) throw new UserError("errors.forbidden");
}

export const formatSchema = z.object({
  id: z.string().optional().transform((v) => v || undefined),
  bankName: z.string().trim().min(2, "validation.required").max(100),
  formatName: z.string().trim().min(2, "validation.required").max(100),
  notes: z.string().trim().max(1000).optional(),
  profile: importProfileSchema,
});

/** Creates or updates a format. Changing the profile of a validated format sets it back to DRAFT. */
export async function saveFormat(userId: string, raw: z.input<typeof formatSchema>) {
  await platformAdmin(userId);
  const input = formatSchema.parse(raw);
  return systemDb.$transaction(async (tx) => {
    if (await tx.bankFormat.findFirst({ where: { bankName: input.bankName, formatName: input.formatName, ...(input.id ? { id: { not: input.id } } : {}) } })) throw new UserError("errors.codeTaken");
    const profile = input.profile as unknown as Prisma.InputJsonValue;
    let f;
    if (input.id) {
      const before = await tx.bankFormat.findUnique({ where: { id: input.id } });
      if (!before) throw new UserError("errors.notFound");
      const changed = JSON.stringify(before.profile) !== JSON.stringify(input.profile);
      f = await tx.bankFormat.update({ where: { id: input.id }, data: { bankName: input.bankName, formatName: input.formatName, notes: input.notes || null, profile, ...(changed ? { status: "DRAFT", sampleSha256: null, sampleSummary: Prisma.DbNull, validatedAt: null, validatedById: null } : {}) } });
    } else f = await tx.bankFormat.create({ data: { bankName: input.bankName, formatName: input.formatName, notes: input.notes || null, profile, createdById: userId } });
    await audit(tx, { organizationId: null, userId, action: input.id ? "platform.bankFormatUpdated" : "platform.bankFormatCreated", entity: "BankFormat", entityId: f.id, details: { bank: input.bankName, format: input.formatName, status: f.status } });
    return f;
  });
}

export const validationSchema = z.object({
  formatId: z.string().min(1),
  expectedLineCount: z.coerce.number().int().min(1),
  expectedTotalIn: z.string().trim().transform((v) => v.replace(",", ".")).pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, "validation.amount")),
  expectedTotalOut: z.string().trim().transform((v) => v.replace(",", ".")).pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, "validation.amount")),
  confirmRealSample: z.literal(true, { message: "banking.confirmRealSample" }),
});

/**
 * Validates a format against a real sample. On success the format becomes VALIDATED with the sample's hash and summary;
 * on a parse error or a mismatch nothing changes and the reason is returned. The file itself is not stored.
 */
export async function validateFormat(userId: string, raw: z.input<typeof validationSchema>, fileText: string) {
  await platformAdmin(userId);
  const input = validationSchema.parse(raw);
  if (fileText.length > 2 * 1024 * 1024) throw new UserError("banking.fileTooLarge");
  const f = await systemDb.bankFormat.findUnique({ where: { id: input.formatId } });
  if (!f || f.status === "RETIRED") throw new UserError("errors.notFound");
  let summary: ReturnType<typeof summariseSample>;
  try {
    summary = summariseSample(fileText, importProfileSchema.parse(f.profile));
  } catch (e) {
    if (e instanceof ImportError) return { ok: false as const, error: { key: e.key, values: e.values } };
    throw e;
  }
  const mismatches = compareWithStatement(summary, { lineCount: input.expectedLineCount, totalIn: input.expectedTotalIn, totalOut: input.expectedTotalOut });
  if (mismatches.length) return { ok: false as const, summary, mismatches };
  const { sha256, ...rest } = summary;
  await systemDb.$transaction(async (tx) => {
    await tx.bankFormat.update({ where: { id: f.id }, data: { status: "VALIDATED", sampleSha256: sha256, sampleSummary: rest as unknown as Prisma.InputJsonValue, validatedAt: new Date(), validatedById: userId } });
    await audit(tx, { organizationId: null, userId, action: "platform.bankFormatValidated", entity: "BankFormat", entityId: f.id, details: { bank: f.bankName, format: f.formatName, sha256, lineCount: rest.lineCount, dateFrom: rest.dateFrom, dateTo: rest.dateTo } });
  });
  return { ok: true as const, summary };
}

export async function retireFormat(userId: string, formatId: string) {
  await platformAdmin(userId);
  await systemDb.$transaction(async (tx) => {
    await tx.bankFormat.update({ where: { id: formatId }, data: { status: "RETIRED" } });
    await audit(tx, { organizationId: null, userId, action: "platform.bankFormatRetired", entity: "BankFormat", entityId: formatId });
  });
}

/** Tenants: copy a VALIDATED library format into a bank account's import profile. */
export async function applyFormat(access: Access, financialAccountId: string, formatId: string) {
  return withTenant({ organizationId: access.organizationId, userId: access.userId }, async (tx) => {
    const format = await tx.bankFormat.findUnique({ where: { id: formatId } });
    if (!format || format.status !== "VALIDATED") throw new UserError("errors.notFound");
    const fa = await tx.financialAccount.findUnique({ where: { id: financialAccountId } });
    if (!fa) throw new UserError("errors.notFound");
    const admin = await tx.administration.findUniqueOrThrow({ where: { id: fa.administrationId } });
    assertCan(access, "banking.edit", admin.companyId);
    await tx.financialAccount.update({ where: { id: fa.id }, data: { importProfile: format.profile as Prisma.InputJsonValue } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "bank.formatApplied", entity: "FinancialAccount", entityId: fa.id, details: { formatId, bank: format.bankName, format: format.formatName } });
  });
}
