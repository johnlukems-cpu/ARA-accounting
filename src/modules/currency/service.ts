import Decimal from "decimal.js";
import type { Administration, Prisma } from "@prisma/client";
import { z } from "zod";
import type { Tx } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { audit } from "@/core/audit/audit";
import { assertCan, can, type Access } from "@/core/auth/access";
import { UserError } from "@/core/errors";
import * as engine from "@/core/ledger/engine";
import type { LineInput } from "@/core/ledger/domain";
import { RATE_TYPES, fxPolicyOf, fxPolicySchema, parseCbvsCsv, revaluationLines, type BalanceGroup, type FxPolicy, type RateTypeCode } from "./domain";

const scope = (a: Access) => ({ organizationId: a.organizationId, userId: a.userId });
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

// ───────────── Rates ─────────────

export const rateSchema = z.object({
  baseCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "validation.currency").default("SRD"),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "validation.currency"),
  rateType: z.enum(RATE_TYPES),
  rate: z.string().trim().transform((v) => v.replace(",", ".")).pipe(z.string().regex(/^\d+(\.\d{1,10})?$/, "validation.amount")),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date"),
  reference: z.string().trim().max(200).optional(),
});

export async function createRate(access: Access, raw: z.input<typeof rateSchema>) {
  const input = rateSchema.parse(raw);
  return withTenant(scope(access), async (tx) => {
    assertCan(access, "currency.create");
    if (input.currency === input.baseCurrency) throw new UserError("currency.sameCurrency");
    if (!new Decimal(input.rate).gt(0)) throw new UserError("validation.positive");
    const existing = await tx.exchangeRate.findFirst({ where: { baseCurrency: input.baseCurrency, currency: input.currency, rateType: input.rateType, effectiveDate: day(input.effectiveDate), status: { not: "REJECTED" } } });
    if (existing) throw new UserError("currency.rateExists");
    const r = await tx.exchangeRate.create({
      data: { organizationId: access.organizationId, baseCurrency: input.baseCurrency, currency: input.currency, rateType: input.rateType, rate: input.rate, effectiveDate: day(input.effectiveDate), reference: input.reference || null, createdById: access.userId },
    });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "fx.rateCreated", entity: "ExchangeRate", entityId: r.id, details: { pair: `${input.currency}/${input.baseCurrency}`, type: input.rateType, rate: input.rate, date: input.effectiveDate } });
    return r;
  });
}

/** Approve or reject a pending rate. Segregation of duties: not by the person who entered or imported it. */
export async function decideRate(access: Access, id: string, decision: "APPROVED" | "REJECTED") {
  return withTenant(scope(access), async (tx) => {
    assertCan(access, "currency.approve");
    const r = await tx.exchangeRate.findUnique({ where: { id } });
    if (!r) throw new UserError("errors.notFound");
    if (r.status !== "PENDING") throw new UserError("currency.rateDecided");
    if (r.createdById === access.userId) throw new UserError("ledger.segregation");
    const updated = await tx.exchangeRate.update({ where: { id }, data: { status: decision, approvedById: access.userId, approvedAt: new Date() } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: decision === "APPROVED" ? "fx.rateApproved" : "fx.rateRejected", entity: "ExchangeRate", entityId: id });
    return updated;
  });
}

/** Imports CBvS buying and selling rates (ARA CSV layout, see parseCbvsCsv) as pending CBVS_BUY / CBVS_SELL rates. */
export async function importCbvsRates(access: Access, input: { baseCurrency: string; content: string; fileName: string }) {
  return withTenant(scope(access), async (tx) => {
    assertCan(access, "currency.create");
    const { rows, errors } = parseCbvsCsv(input.content);
    if (errors.length) throw new UserError("currency.csvErrors", { lines: errors.slice(0, 5).map((e) => e.line).join(", ") });
    if (!rows.length) throw new UserError("currency.csvEmpty");
    let created = 0;
    let skipped = 0;
    for (const row of rows) {
      if (row.currency === input.baseCurrency) {
        skipped += 2;
        continue;
      }
      for (const [rateType, rate] of [["CBVS_BUY", row.buy], ["CBVS_SELL", row.sell]] as const) {
        const exists = await tx.exchangeRate.findFirst({ where: { baseCurrency: input.baseCurrency, currency: row.currency, rateType, effectiveDate: day(row.date), status: { not: "REJECTED" } } });
        if (exists) {
          skipped++;
          continue;
        }
        await tx.exchangeRate.create({ data: { organizationId: access.organizationId, baseCurrency: input.baseCurrency, currency: row.currency, rateType, rate, effectiveDate: day(row.date), source: "CBVS_IMPORT", reference: input.fileName.slice(0, 200), createdById: access.userId } });
        created++;
      }
    }
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "fx.cbvsImported", entity: "ExchangeRate", details: { file: input.fileName, created, skipped } });
    return { created, skipped };
  });
}

/** Latest usable rate on or before `date`, at most `maxAgeDays` old. Approved rates win over pending ones on the same date. */
export async function findRate(tx: Tx, q: { baseCurrency: string; currency: string; rateType: RateTypeCode; date: string; maxAgeDays: number; requireApproved: boolean }) {
  const rows = await tx.exchangeRate.findMany({
    where: {
      baseCurrency: q.baseCurrency, currency: q.currency, rateType: q.rateType,
      effectiveDate: { lte: day(q.date), gte: addDays(day(q.date), -q.maxAgeDays) },
      status: q.requireApproved ? "APPROVED" : { in: ["APPROVED", "PENDING"] },
    },
    orderBy: [{ effectiveDate: "desc" }, { status: "asc" }],
    take: 1,
  });
  return rows[0] ?? null;
}

export function policyOf(admin: Pick<Administration, "settings">): FxPolicy {
  return fxPolicyOf(admin.settings);
}

export async function setPolicy(access: Access, administrationId: string, raw: unknown) {
  return withTenant(scope(access), async (tx) => {
    const admin = await tx.administration.findUnique({ where: { id: administrationId } });
    if (!admin) throw new UserError("errors.notFound");
    assertCan(access, "administrations.manageSettings", admin.companyId);
    const policy = fxPolicySchema.parse(raw);
    const settings = { ...((admin.settings as Record<string, unknown>) ?? {}), fxPolicy: policy };
    await tx.administration.update({ where: { id: admin.id }, data: { settings: settings as Prisma.InputJsonValue } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "fx.policyChanged", entity: "Administration", entityId: admin.id, details: policy });
    return policy;
  });
}

/**
 * Rate for a sales or purchase document (C2): the policy rate on the document date. A different rate typed by the user is
 * an override; it needs `currency.edit` and is audited. Without a policy rate the user must type one.
 */
export async function resolveDocumentRate(tx: Tx, access: Access, admin: Administration, q: { purpose: "sales" | "purchase"; currency: string; date: string; given?: string; documentId?: string }) {
  const policy = policyOf(admin);
  const rateType = q.purpose === "sales" ? policy.sales : policy.purchase;
  const found = await findRate(tx, { baseCurrency: admin.baseCurrency, currency: q.currency, rateType, date: q.date, maxAgeDays: policy.maxAgeDays, requireApproved: policy.requireApproved });
  if (!q.given) {
    if (!found) throw new UserError("currency.noPolicyRate", { currency: q.currency, type: rateType, date: q.date });
    return { rate: found.rate.toString(), source: `${rateType}:${found.id}`, rateDate: iso(found.effectiveDate) };
  }
  if (!(Number(q.given) > 0)) throw new UserError("invoicing.rateRequired", { currency: q.currency });
  if (found && !new Decimal(q.given).eq(found.rate.toString())) {
    if (!can(access, "currency.edit", admin.companyId)) throw new UserError("currency.overrideNotAllowed", { rate: found.rate.toString() });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "fx.rateOverride", entity: "Administration", entityId: admin.id, details: { currency: q.currency, policyRate: found.rate.toString(), given: q.given, document: q.documentId ?? null } });
    return { rate: q.given, source: "MANUAL_OVERRIDE", rateDate: q.date };
  }
  return found ? { rate: found.rate.toString(), source: `${rateType}:${found.id}`, rateDate: iso(found.effectiveDate) } : { rate: q.given, source: "MANUAL", rateDate: q.date };
}

// ───────────── Revaluation (C5–C7) ─────────────

const MONETARY_CONTROLS = ["BANK", "CASH", "RECEIVABLE", "PAYABLE", "CURRENT_ACCOUNT"];

/** Posted foreign-currency balances of monetary accounts up to `upTo`, per account and currency (C7: nothing else). */
export async function monetaryBalances(tx: Tx, admin: Administration, upTo: Date): Promise<BalanceGroup[]> {
  const policy = policyOf(admin);
  const extra = policy.monetaryAccounts.length ? policy.monetaryAccounts : ["----"];
  const rows = await tx.$queryRaw<BalanceGroup[]>`
    SELECT l."accountId", a.number, a.name, l."txCurrency" AS currency, SUM(l."txAmount")::text AS tx, SUM(l."debitBase" - l."creditBase")::text AS base
      FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId" JOIN "Account" a ON a.id = l."accountId"
     WHERE e."administrationId" = ${admin.id} AND e.status = 'POSTED' AND e."entryDate" <= ${upTo} AND l."txCurrency" <> ${admin.baseCurrency}
       AND (a."controlType"::text = ANY(${MONETARY_CONTROLS}) OR a.number = ANY(${extra}))
     GROUP BY l."accountId", a.number, a.name, l."txCurrency"
     ORDER BY a.number, l."txCurrency"`;
  return rows;
}

async function revaluationPeriod(tx: Tx, admin: Administration, periodId: string) {
  const period = await tx.accountingPeriod.findUnique({ where: { id: periodId }, include: { fiscalYear: true } });
  if (!period || period.fiscalYear.administrationId !== admin.id) throw new UserError("errors.notFound");
  if (period.number < 1 || period.number > 12) throw new UserError("currency.revaluationPeriod");
  return period;
}

export async function revaluationPreview(tx: Tx, admin: Administration, periodId: string) {
  const period = await revaluationPeriod(tx, admin, periodId);
  const policy = policyOf(admin);
  const groups = await monetaryBalances(tx, admin, period.endDate);
  const date = iso(period.endDate);
  const rates: Record<string, string> = {};
  const rateIds: Record<string, string> = {};
  for (const cur of new Set(groups.map((g) => g.currency))) {
    const r = await findRate(tx, { baseCurrency: admin.baseCurrency, currency: cur, rateType: policy.revaluation, date, maxAgeDays: policy.maxAgeDays, requireApproved: policy.requireApproved });
    if (r) {
      rates[cur] = r.rate.toString();
      rateIds[cur] = r.id;
    }
  }
  return { period, policy, date, rates, rateIds, ...revaluationLines(groups, rates) };
}

export async function proposeRevaluation(access: Access, input: { administrationId: string; periodId: string }) {
  return withTenant(scope(access), async (tx) => {
    const admin = await tx.administration.findUnique({ where: { id: input.administrationId } });
    if (!admin) throw new UserError("errors.notFound");
    assertCan(access, "currency.create", admin.companyId);
    const p = await revaluationPreview(tx, admin, input.periodId);
    if (p.missing.length) throw new UserError("currency.missingRates", { currencies: p.missing.join(", "), type: p.policy.revaluation, date: p.date });
    if (!p.lines.length) throw new UserError("currency.nothingToRevalue");
    if (await tx.currencyRevaluation.findFirst({ where: { administrationId: admin.id, periodId: p.period.id, scope: "ALL", status: { in: ["PROPOSED", "POSTED"] } } })) throw new UserError("currency.revaluationExists");
    // AUTO_REVERSE: an earlier posted revaluation must have its reversal, otherwise it would be counted twice.
    if (await tx.currencyRevaluation.findFirst({ where: { administrationId: admin.id, status: "POSTED", reversalEntryId: null, revaluationDate: { lt: p.period.endDate } } }) && p.policy.revaluationMode === "AUTO_REVERSE") {
      throw new UserError("currency.previousNotReversed");
    }
    const fx = await tx.account.findFirst({ where: { administrationId: admin.id, controlType: "FX_RESULT", type: "DETAIL", status: "ACTIVE" }, orderBy: { number: "desc" } });
    const journal = await tx.journal.findFirst({ where: { administrationId: admin.id, type: "FX_ADJUSTMENT", status: "ACTIVE" }, orderBy: { code: "asc" } });
    if (!fx || !journal) throw new UserError("ledger.invalidJournal");
    const lines: LineInput[] = p.lines.map((l) => {
      const d = new Decimal(l.difference);
      return { accountId: l.accountId, currency: l.currency, rate: l.rate, rateDate: p.date, rateSource: `${p.policy.revaluation}:${p.rateIds[l.currency]}`, fxAdjustment: true, description: `Herwaardering ${l.currency} ${l.number} tegen ${l.rate}`, ...(d.gt(0) ? { debit: d.toFixed(2) } : { credit: d.abs().toFixed(2) }) };
    });
    const total = new Decimal(p.total);
    if (!total.isZero()) lines.push({ accountId: fx.id, description: `Ongerealiseerd koersresultaat ${p.date}`, ...(total.gt(0) ? { credit: total.toFixed(2) } : { debit: total.abs().toFixed(2) }) });
    const reval = await tx.currencyRevaluation.create({
      data: {
        organizationId: access.organizationId, administrationId: admin.id, periodId: p.period.id, revaluationDate: p.period.endDate, rates: p.rates,
        lines: p.lines as unknown as Prisma.InputJsonValue, createdById: access.userId,
      },
    });
    const entry = await engine.createEntry(tx, access, {
      administrationId: admin.id, journalId: journal.id, entryDate: p.date, description: `Herwaardering vreemde valuta per ${p.date}`,
      lines, sourceType: "FX_REVALUATION", sourceId: reval.id, idempotencyKey: `revaluation:${reval.id}`,
    });
    await tx.currencyRevaluation.update({ where: { id: reval.id }, data: { entryId: entry.id } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "fx.revaluationProposed", entity: "CurrencyRevaluation", entityId: reval.id, details: { date: p.date, total: p.total, rates: p.rates } });
    return { revaluation: { ...reval, entryId: entry.id }, entry, total: p.total };
  });
}

async function loadRevaluation(tx: Tx, id: string) {
  const r = await tx.currencyRevaluation.findUnique({ where: { id } });
  if (!r) throw new UserError("errors.notFound");
  const admin = await tx.administration.findUniqueOrThrow({ where: { id: r.administrationId } });
  return { r, admin };
}

export async function cancelRevaluation(access: Access, id: string) {
  return withTenant(scope(access), async (tx) => {
    const { r } = await loadRevaluation(tx, id);
    if (r.status !== "PROPOSED" || !r.entryId) throw new UserError("ledger.wrongStatus");
    await engine.deleteSourceDraft(tx, access, r.entryId);
    await tx.currencyRevaluation.update({ where: { id }, data: { status: "CANCELLED", entryId: null } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "fx.revaluationCancelled", entity: "CurrencyRevaluation", entityId: id });
  });
}

/** Reversal on day 1 of the next period (AUTO_REVERSE). Skipped when that period does not exist yet; can be completed later. */
async function autoReverse(tx: Tx, access: Access, r: { id: string; entryId: string | null; revaluationDate: Date }) {
  const next = iso(addDays(r.revaluationDate, 1));
  const exists = await tx.accountingPeriod.findFirst({ where: { fiscalYear: { administrationId: (await tx.journalEntry.findUniqueOrThrow({ where: { id: r.entryId! } })).administrationId }, number: { gte: 1, lte: 12 }, startDate: { lte: day(next) }, endDate: { gte: day(next) } } });
  if (!exists) return null;
  const reversal = await engine.reverseEntry(tx, access, r.entryId!, { entryDate: next, reason: "Automatische terugboeking herwaardering (C5)", viaSource: true });
  await tx.currencyRevaluation.update({ where: { id: r.id }, data: { reversalEntryId: reversal.id } });
  return reversal;
}

/** Posts an approved proposal (the FX journal requires approval by someone else) and, by policy, books the reversal. */
export async function postRevaluation(access: Access, id: string) {
  return withTenant(scope(access), async (tx) => {
    const { r, admin } = await loadRevaluation(tx, id);
    if (r.status !== "PROPOSED" || !r.entryId) throw new UserError("ledger.wrongStatus");
    const entry = await tx.journalEntry.findUniqueOrThrow({ where: { id: r.entryId } });
    if (entry.status !== "POSTED") await engine.postEntry(tx, access, r.entryId);
    await tx.currencyRevaluation.update({ where: { id }, data: { status: "POSTED" } });
    const reversal = policyOf(admin).revaluationMode === "AUTO_REVERSE" ? await autoReverse(tx, access, r) : null;
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "fx.revaluationPosted", entity: "CurrencyRevaluation", entityId: id, details: { reversalEntryId: reversal?.id ?? null } });
    return { reversal };
  });
}

/** Completes a pending automatic reversal once the next period exists. */
export async function completeReversal(access: Access, id: string) {
  return withTenant(scope(access), async (tx) => {
    const { r, admin } = await loadRevaluation(tx, id);
    assertCan(access, "currency.post", admin.companyId);
    if (r.status !== "POSTED" || r.reversalEntryId || policyOf(admin).revaluationMode !== "AUTO_REVERSE") throw new UserError("ledger.wrongStatus");
    const reversal = await autoReverse(tx, access, r);
    if (!reversal) throw new UserError("currency.nextPeriodMissing");
    return reversal;
  });
}

/** C6: a recalculation first reverses the posted revaluation (dated on the revaluation date). Only before its automatic reversal. */
export async function reverseRevaluation(access: Access, id: string, reason: string) {
  return withTenant(scope(access), async (tx) => {
    const { r } = await loadRevaluation(tx, id);
    if (r.status !== "POSTED" || !r.entryId) throw new UserError("ledger.wrongStatus");
    if (r.reversalEntryId) throw new UserError("currency.alreadyAutoReversed");
    const reversal = await engine.reverseEntry(tx, access, r.entryId, { entryDate: iso(r.revaluationDate), reason, viaSource: true });
    await tx.currencyRevaluation.update({ where: { id }, data: { status: "REVERSED", reversalEntryId: reversal.id } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "fx.revaluationReversed", entity: "CurrencyRevaluation", entityId: id, details: { reason } });
    return reversal;
  });
}
