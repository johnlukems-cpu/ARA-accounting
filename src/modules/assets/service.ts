import Decimal from "decimal.js";
import { z } from "zod";
import type { Tx } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { audit } from "@/core/audit/audit";
import { assertCan, type Access } from "@/core/auth/access";
import { UserError } from "@/core/errors";
import * as engine from "@/core/ledger/engine";
import type { LineInput } from "@/core/ledger/domain";
import { defaultDepreciationStart, depreciationSchedule } from "./schedule";

const scope = (a: Access) => ({ organizationId: a.organizationId, userId: a.userId });
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const amountStr = z.string().trim().transform((v) => v.replace(",", ".")).pipe(z.string().regex(/^\d+(\.\d+)?$/, "validation.amount"));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date");

export const assetSchema = z.object({
  administrationId: z.string().min(1),
  categoryId: z.string().min(1, "validation.required"),
  number: z.string().trim().min(1, "validation.required").max(20).regex(/^[A-Za-z0-9_-]+$/, "validation.code"),
  name: z.string().trim().min(2, "validation.required").max(160),
  acquisitionDate: date,
  acquisitionCost: amountStr,
  residualValue: amountStr.optional().or(z.literal("").transform(() => undefined)),
  usefulLifeMonths: z.coerce.number().int().min(1, "validation.positive").max(1200),
  method: z.enum(["STRAIGHT_LINE", "DECLINING_BALANCE"]),
  decliningRatePct: amountStr.optional().or(z.literal("").transform(() => undefined)),
  depreciationStart: date.optional().or(z.literal("").transform(() => undefined)),
  location: z.string().trim().max(120).optional(),
  costCenterId: z.string().optional().transform((v) => v || undefined),
  /** Account credited for the acquisition (default: capital expenditure clearing 0090). "NONE" = already booked on the asset account. */
  counterAccountId: z.string().min(1, "validation.required"),
});

async function adminFor(tx: Tx, id: string) {
  const admin = await tx.administration.findUnique({ where: { id } });
  if (!admin) throw new UserError("errors.notFound");
  return admin;
}

async function depJournal(tx: Tx, administrationId: string, type: "DEPRECIATION" | "FIXED_ASSET") {
  const j = await tx.journal.findFirst({ where: { administrationId, type, status: "ACTIVE" }, orderBy: { code: "asc" } });
  if (!j) throw new UserError("ledger.invalidJournal");
  return j;
}

/** Registers an asset and (unless already booked) posts the acquisition: Dr asset account / Cr counter account. */
export async function registerAsset(access: Access, input: z.infer<typeof assetSchema>) {
  return withTenant(scope(access), async (tx) => {
    const admin = await adminFor(tx, input.administrationId);
    assertCan(access, "assets.create", admin.companyId);
    const cat = await tx.assetCategory.findUnique({ where: { id: input.categoryId } });
    if (!cat || cat.administrationId !== admin.id || cat.status !== "ACTIVE") throw new UserError("assets.invalidCategory");
    const residual = input.residualValue ?? "0";
    if (new Decimal(residual).gte(input.acquisitionCost)) throw new UserError("assets.residualTooHigh");
    if (input.method === "DECLINING_BALANCE" && !input.decliningRatePct) throw new UserError("assets.rateRequired");
    const start = input.depreciationStart ?? defaultDepreciationStart(input.acquisitionDate);
    if (!start.endsWith("-01")) throw new UserError("assets.startFirstOfMonth");
    // Validates the schedule parameters before anything is written.
    depreciationSchedule({ cost: input.acquisitionCost, residual, usefulLifeMonths: input.usefulLifeMonths, method: input.method, decliningRatePct: input.decliningRatePct, start: toDate(start) });
    if (await tx.asset.findUnique({ where: { administrationId_number: { administrationId: admin.id, number: input.number } } })) throw new UserError("errors.codeTaken");

    const asset = await tx.asset.create({
      data: {
        organizationId: access.organizationId, administrationId: admin.id, categoryId: cat.id, number: input.number, name: input.name,
        acquisitionDate: toDate(input.acquisitionDate), acquisitionCost: input.acquisitionCost, residualValue: residual, usefulLifeMonths: input.usefulLifeMonths,
        method: input.method, decliningRatePct: input.decliningRatePct ?? null, depreciationStart: toDate(start), location: input.location || null, costCenterId: input.costCenterId ?? null, createdById: access.userId,
      },
    });
    let entryId: string | null = null;
    if (input.counterAccountId !== "NONE") {
      const counter = await tx.account.findUnique({ where: { id: input.counterAccountId } });
      if (!counter || counter.administrationId !== admin.id || ["RECEIVABLE", "PAYABLE", "FIXED_ASSET"].includes(counter.controlType)) throw new UserError("assets.invalidCounterAccount");
      const journal = await depJournal(tx, admin.id, "FIXED_ASSET");
      const entry = await engine.createAndPost(tx, access, {
        administrationId: admin.id, journalId: journal.id, entryDate: input.acquisitionDate, description: `Aanschaf ${input.number} ${input.name}`,
        lines: [
          { accountId: cat.assetAccountId, debit: input.acquisitionCost, costCenterId: input.costCenterId },
          { accountId: counter.id, credit: input.acquisitionCost },
        ],
        sourceType: "ASSET", sourceId: asset.id, idempotencyKey: `asset-acq:${asset.id}`,
      });
      entryId = entry.id;
      await tx.asset.update({ where: { id: asset.id }, data: { acquisitionEntryId: entry.id } });
    }
    await tx.assetTransaction.create({ data: { organizationId: access.organizationId, assetId: asset.id, type: "ACQUISITION", date: toDate(input.acquisitionDate), amount: input.acquisitionCost, entryId, createdById: access.userId } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "asset.registered", entity: "Asset", entityId: asset.id, details: { number: asset.number, cost: input.acquisitionCost } });
    return asset;
  });
}

/** Posted depreciation (sum) of an asset. */
async function postedDepreciation(tx: Tx, assetId: string) {
  const [r] = await tx.$queryRaw<{ total: string | null }[]>`
    SELECT SUM(d.amount)::text AS total FROM "DepreciationLine" d JOIN "JournalEntry" e ON e.id = d."entryId"
     WHERE d."assetId" = ${assetId} AND e.status = 'POSTED'`;
  return new Decimal(r?.total ?? 0);
}

/**
 * Creates the depreciation proposal for a month: one DRAFT entry in the depreciation journal (Dr expense / Cr accumulated
 * per category) plus one line per asset. Posting follows the journal's approval rule. A month can never be proposed twice.
 */
export async function proposeDepreciation(access: Access, input: { administrationId: string; year: number; month: number }) {
  return withTenant(scope(access), async (tx) => {
    const admin = await adminFor(tx, input.administrationId);
    assertCan(access, "assets.create", admin.companyId);
    if (input.month < 1 || input.month > 12) throw new UserError("validation.invalid");
    const assets = await tx.asset.findMany({ where: { administrationId: admin.id, status: "ACTIVE" }, include: { category: true, depreciation: { where: { year: input.year, month: input.month } } } });
    const due: { asset: (typeof assets)[number]; amount: Decimal }[] = [];
    for (const a of assets) {
      if (a.depreciation.length > 0) continue;
      const line = depreciationSchedule({ cost: a.acquisitionCost.toString(), residual: a.residualValue.toString(), usefulLifeMonths: a.usefulLifeMonths, method: a.method, decliningRatePct: a.decliningRatePct?.toString(), start: a.depreciationStart })
        .find((l) => l.year === input.year && l.month === input.month);
      if (line) due.push({ asset: a, amount: new Decimal(line.amount) });
    }
    if (due.length === 0) throw new UserError("assets.nothingToDepreciate");
    const lastDay = new Date(Date.UTC(input.year, input.month, 0)).toISOString().slice(0, 10);
    const byCat = new Map<string, { expense: string; accumulated: string; amount: Decimal; costCenterId: string | null }>();
    const lines: LineInput[] = [];
    for (const d of due) {
      const key = `${d.asset.categoryId}|${d.asset.costCenterId ?? ""}`;
      const cur = byCat.get(key) ?? { expense: d.asset.category.expenseAccountId, accumulated: d.asset.category.accumulatedAccountId, amount: new Decimal(0), costCenterId: d.asset.costCenterId };
      cur.amount = cur.amount.plus(d.amount);
      byCat.set(key, cur);
    }
    for (const c of byCat.values()) {
      lines.push({ accountId: c.expense, debit: c.amount.toFixed(2), costCenterId: c.costCenterId, description: `Afschrijving ${input.month}-${input.year}` });
      lines.push({ accountId: c.accumulated, credit: c.amount.toFixed(2), description: `Afschrijving ${input.month}-${input.year}` });
    }
    const journal = await depJournal(tx, admin.id, "DEPRECIATION");
    const entry = await engine.createEntry(tx, access, {
      administrationId: admin.id, journalId: journal.id, entryDate: lastDay, description: `Afschrijvingen ${String(input.month).padStart(2, "0")}-${input.year}`,
      lines, sourceType: "DEPRECIATION", idempotencyKey: `depreciation:${admin.id}:${input.year}-${input.month}:${Date.now()}`,
    });
    await tx.depreciationLine.createMany({ data: due.map((d) => ({ organizationId: access.organizationId, assetId: d.asset.id, year: input.year, month: input.month, amount: d.amount.toFixed(2), entryId: entry.id })) });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "depreciation.proposed", entity: "JournalEntry", entityId: entry.id, details: { year: input.year, month: input.month, assets: due.length, total: due.reduce((s, d) => s.plus(d.amount), new Decimal(0)).toFixed(2) } });
    return entry;
  });
}

/** Withdraws an unposted depreciation proposal (its lines go with it). */
export async function cancelDepreciation(access: Access, entryId: string) {
  return withTenant(scope(access), async (tx) => {
    const entry = await tx.journalEntry.findUnique({ where: { id: entryId }, select: { status: true, sourceType: true } });
    if (!entry || entry.sourceType !== "DEPRECIATION") throw new UserError("errors.notFound");
    if (entry.status === "POSTED") throw new UserError("ledger.postedImmutable");
    await tx.depreciationLine.deleteMany({ where: { entryId } });
    await engine.deleteSourceDraft(tx, access, entryId);
  });
}

/**
 * Disposal or sale (A4): depreciation must be posted up to the month before disposal. Removes cost and posted accumulated
 * depreciation, books the proceeds on the counter account and the result as gain or loss.
 */
export async function disposeAsset(access: Access, input: { assetId: string; date: string; proceeds: string; counterAccountId?: string }) {
  return withTenant(scope(access), async (tx) => {
    const asset = await tx.asset.findUnique({ where: { id: input.assetId }, include: { category: true } });
    if (!asset) throw new UserError("errors.notFound");
    const admin = await adminFor(tx, asset.administrationId);
    assertCan(access, "assets.post", admin.companyId);
    if (asset.status === "DISPOSED") throw new UserError("assets.alreadyDisposed");
    const d = toDate(input.date);
    if (d < asset.acquisitionDate) throw new UserError("assets.disposalBeforeAcquisition");
    const pending = await tx.depreciationLine.count({ where: { assetId: asset.id, entryId: { in: (await tx.journalEntry.findMany({ where: { administrationId: admin.id, status: { not: "POSTED" }, sourceType: "DEPRECIATION" }, select: { id: true } })).map((e) => e.id) } } });
    if (pending > 0) throw new UserError("assets.pendingDepreciation");
    const schedule = depreciationSchedule({ cost: asset.acquisitionCost.toString(), residual: asset.residualValue.toString(), usefulLifeMonths: asset.usefulLifeMonths, method: asset.method, decliningRatePct: asset.decliningRatePct?.toString(), start: asset.depreciationStart });
    const posted = await tx.depreciationLine.findMany({ where: { assetId: asset.id } });
    const missing = schedule.filter((l) => Date.UTC(l.year, l.month - 1, 1) < Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) && !posted.some((p) => p.year === l.year && p.month === l.month));
    if (missing.length > 0) throw new UserError("assets.depreciationBehind", { months: missing.length });

    const accumulated = await postedDepreciation(tx, asset.id);
    const cost = new Decimal(asset.acquisitionCost.toString());
    const nbv = cost.minus(accumulated);
    const proceeds = new Decimal(input.proceeds || "0");
    const result = proceeds.minus(nbv);
    const lines: LineInput[] = [{ accountId: asset.category.assetAccountId, credit: cost.toFixed(2), description: `Afboeking ${asset.number}` }];
    if (accumulated.gt(0)) lines.push({ accountId: asset.category.accumulatedAccountId, debit: accumulated.toFixed(2), description: `Afboeking cum. afschrijving ${asset.number}` });
    if (proceeds.gt(0)) {
      if (!input.counterAccountId) throw new UserError("assets.counterAccountRequired");
      const counter = await tx.account.findUnique({ where: { id: input.counterAccountId } });
      if (!counter || counter.administrationId !== admin.id || ["PAYABLE", "FIXED_ASSET"].includes(counter.controlType)) throw new UserError("assets.invalidCounterAccount");
      lines.push({ accountId: counter.id, debit: proceeds.toFixed(2), description: `Opbrengst ${asset.number}` });
    }
    if (result.gt(0)) lines.push({ accountId: asset.category.gainAccountId, credit: result.toFixed(2), description: `Boekwinst ${asset.number}` });
    if (result.lt(0)) lines.push({ accountId: asset.category.lossAccountId, debit: result.abs().toFixed(2), description: `Boekverlies ${asset.number}` });
    const journal = await depJournal(tx, admin.id, "FIXED_ASSET");
    const entry = await engine.createAndPost(tx, access, {
      administrationId: admin.id, journalId: journal.id, entryDate: input.date, description: `${proceeds.gt(0) ? "Verkoop" : "Buitengebruikstelling"} ${asset.number} ${asset.name}`,
      lines, sourceType: "ASSET", sourceId: asset.id, idempotencyKey: `asset-disposal:${asset.id}`,
    });
    await tx.asset.update({ where: { id: asset.id }, data: { status: "DISPOSED", disposedAt: d, disposalProceeds: proceeds.toFixed(2) } });
    await tx.assetTransaction.create({ data: { organizationId: access.organizationId, assetId: asset.id, type: "DISPOSAL", date: d, amount: proceeds.toFixed(2), entryId: entry.id, details: { bookValue: nbv.toFixed(2), result: result.toFixed(2) }, createdById: access.userId } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "asset.disposed", entity: "Asset", entityId: asset.id, details: { proceeds: proceeds.toFixed(2), bookValue: nbv.toFixed(2), result: result.toFixed(2) } });
    return { entry, bookValue: nbv.toFixed(2), result: result.toFixed(2) };
  });
}

/** Moves an asset to another location or cost centre (history only; no ledger effect). */
export async function transferAsset(access: Access, input: { assetId: string; date: string; location?: string; costCenterId?: string | null }) {
  return withTenant(scope(access), async (tx) => {
    const asset = await tx.asset.findUnique({ where: { id: input.assetId } });
    if (!asset) throw new UserError("errors.notFound");
    const admin = await adminFor(tx, asset.administrationId);
    assertCan(access, "assets.edit", admin.companyId);
    if (asset.status === "DISPOSED") throw new UserError("assets.alreadyDisposed");
    await tx.asset.update({ where: { id: asset.id }, data: { location: input.location ?? asset.location, costCenterId: input.costCenterId === undefined ? asset.costCenterId : input.costCenterId } });
    await tx.assetTransaction.create({ data: { organizationId: access.organizationId, assetId: asset.id, type: "TRANSFER", date: toDate(input.date), details: { from: { location: asset.location, costCenterId: asset.costCenterId }, to: { location: input.location, costCenterId: input.costCenterId } }, createdById: access.userId } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "asset.transferred", entity: "Asset", entityId: asset.id, details: { location: input.location ?? null } });
  });
}

/** Asset register as of a date: cost, posted accumulated depreciation, book value. */
export async function assetRegister(tx: Tx, administrationId: string, asOf: Date) {
  const assets = await tx.asset.findMany({ where: { administrationId, acquisitionDate: { lte: asOf } }, include: { category: { select: { code: true, name: true } } }, orderBy: { number: "asc" } });
  const rows = await tx.$queryRaw<{ assetId: string; total: string }[]>`
    SELECT d."assetId", SUM(d.amount)::text AS total FROM "DepreciationLine" d JOIN "JournalEntry" e ON e.id = d."entryId"
     WHERE e.status = 'POSTED' AND e."administrationId" = ${administrationId} AND make_date(d.year, d.month, 1) <= ${asOf} GROUP BY d."assetId"`;
  const acc = new Map(rows.map((r) => [r.assetId, new Decimal(r.total)]));
  return assets.map((a) => {
    const accumulated = a.status === "DISPOSED" && a.disposedAt && a.disposedAt <= asOf ? new Decimal(a.acquisitionCost.toString()) : acc.get(a.id) ?? new Decimal(0);
    const disposed = a.status === "DISPOSED" && a.disposedAt && a.disposedAt <= asOf;
    return { ...a, accumulated: disposed ? "0.00" : accumulated.toFixed(2), bookValue: disposed ? "0.00" : new Decimal(a.acquisitionCost.toString()).minus(accumulated).toFixed(2), disposedAsOf: !!disposed };
  });
}
