import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import type { Prisma, TaxType } from "@prisma/client";
import type { Tx } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { audit } from "@/core/audit/audit";
import { assertCan, type Access } from "@/core/auth/access";
import { UserError } from "@/core/errors";
import * as engine from "@/core/ledger/engine";
import type { LineInput } from "@/core/ledger/domain";
import { sniffMime } from "@/modules/scan/domain";
import { loadBalances, profitAndLoss } from "@/modules/reporting/statements";

const scope = (a: Access) => ({ organizationId: a.organizationId, userId: a.userId });
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const json = (v: unknown) => v as Prisma.InputJsonValue;

/** T1: the rule version in force on a date. */
export async function ruleFor(tx: Tx, taxType: TaxType, date: Date) {
  const rule = await tx.taxRuleVersion.findFirst({ where: { taxType, effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] }, orderBy: { effectiveFrom: "desc" } });
  if (!rule) throw new UserError("tax.noRule", { type: taxType });
  return rule;
}

async function adminFor(tx: Tx, id: string) {
  const a = await tx.administration.findUnique({ where: { id } });
  if (!a) throw new UserError("errors.notFound");
  return a;
}

// ───────────── BTW (T5, T7) ─────────────

export type BtwLine = { taxCodeId: string; code: string; name: string; reportBox: string | null; direction: "OUTPUT" | "INPUT"; base: string; tax: string };

/** Output BTW from sales, input BTW (deductible part) from purchases and cash entries, per BTW code; amounts in SRD (T7). */
export async function calculateBtw(tx: Tx, administrationId: string, from: Date, to: Date) {
  const codes = new Map((await tx.taxCode.findMany({ where: { administrationId } })).map((c) => [c.id, c]));
  const acc = new Map<string, { base: Decimal; tax: Decimal }>();
  const add = (codeId: string, dir: "OUTPUT" | "INPUT", base: Decimal, tax: Decimal) => {
    const k = `${codeId}|${dir}`;
    const cur = acc.get(k) ?? { base: new Decimal(0), tax: new Decimal(0) };
    acc.set(k, { base: cur.base.plus(base), tax: cur.tax.plus(tax) });
  };
  const invoices = await tx.invoice.findMany({ where: { administrationId, status: { in: ["POSTED", "PARTIALLY_PAID", "PAID"] }, invoiceDate: { gte: from, lte: to } }, include: { lines: true } });
  for (const inv of invoices) {
    const sign = inv.kind === "CREDIT_NOTE" ? -1 : 1;
    for (const l of inv.lines) {
      if (!l.taxCodeId) continue;
      const code = codes.get(l.taxCodeId)!;
      const base = r2(new Decimal(l.netAmount.toString()).times(inv.exchangeRate.toString())).times(sign);
      let tax = r2(new Decimal(l.taxAmount.toString()).times(inv.exchangeRate.toString())).times(sign);
      if (inv.type === "PURCHASE") tax = r2(tax.times(code.deductiblePct.toString()).dividedBy(100));
      add(l.taxCodeId, inv.type === "SALES" ? "OUTPUT" : "INPUT", base, tax);
    }
  }
  // Cash and bank entries with a BTW code (banking cash book): the BTW line carries the code.
  const cash = await tx.$queryRaw<{ taxCodeId: string; isTax: boolean; amount: string }[]>`
    SELECT l."taxCodeId", (a.category = 'TAX') AS "isTax", SUM(l."creditBase" - l."debitBase")::text AS amount
      FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId" JOIN "Account" a ON a.id = l."accountId"
     WHERE e."administrationId" = ${administrationId} AND e.status = 'POSTED' AND e."sourceType" = 'BANK' AND l."taxCodeId" IS NOT NULL
       AND e."entryDate" BETWEEN ${from} AND ${to}
     GROUP BY 1, 2`;
  for (const codeId of new Set(cash.map((c) => c.taxCodeId))) {
    const tax = new Decimal(cash.find((c) => c.taxCodeId === codeId && c.isTax)?.amount ?? 0);
    const base = new Decimal(cash.find((c) => c.taxCodeId === codeId && !c.isTax)?.amount ?? 0);
    // credit on the BTW account = output (sale), debit = input (purchase)
    if (!tax.isZero() || !base.isZero()) add(codeId, tax.gte(0) && base.gte(0) ? "OUTPUT" : "INPUT", base.abs(), tax.abs());
  }
  const lines: BtwLine[] = [...acc.entries()].map(([k, v]) => {
    const [codeId, dir] = k.split("|") as [string, "OUTPUT" | "INPUT"];
    const c = codes.get(codeId)!;
    return { taxCodeId: codeId, code: c.code, name: c.name, reportBox: c.reportBox, direction: dir, base: v.base.toFixed(2), tax: v.tax.toFixed(2) };
  }).sort((a, b) => a.direction.localeCompare(b.direction) || a.code.localeCompare(b.code));
  const output = lines.filter((l) => l.direction === "OUTPUT").reduce((s, l) => s.plus(l.tax), new Decimal(0));
  const input = lines.filter((l) => l.direction === "INPUT").reduce((s, l) => s.plus(l.tax), new Decimal(0));
  // Reconciliation with the BTW ledger accounts (settlements of earlier returns, source TAX, excluded).
  const ledger = await tx.$queryRaw<{ accountId: string; amount: string }[]>`
    SELECT l."accountId", SUM(l."creditBase" - l."debitBase")::text AS amount FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
     WHERE e."administrationId" = ${administrationId} AND e.status = 'POSTED' AND e."sourceType" <> 'TAX' AND e."entryDate" BETWEEN ${from} AND ${to}
     GROUP BY 1`;
  const outputAccounts = new Set([...codes.values()].map((c) => c.outputAccountId).filter(Boolean) as string[]);
  const inputAccounts = new Set([...codes.values()].map((c) => c.inputAccountId).filter(Boolean) as string[]);
  const ledgerOutput = ledger.filter((l) => outputAccounts.has(l.accountId)).reduce((s, l) => s.plus(l.amount), new Decimal(0));
  const ledgerInput = ledger.filter((l) => inputAccounts.has(l.accountId)).reduce((s, l) => s.plus(l.amount), new Decimal(0)).negated();
  return {
    lines, output: output.toFixed(2), input: input.toFixed(2), payable: output.minus(input).toFixed(2),
    reconciliation: { ledgerOutput: ledgerOutput.toFixed(2), ledgerInput: ledgerInput.toFixed(2), differenceOutput: ledgerOutput.minus(output).toFixed(2), differenceInput: ledgerInput.minus(input).toFixed(2) },
    outputAccountId: [...outputAccounts][0] ?? null, inputAccountId: [...inputAccounts][0] ?? null,
  };
}

export async function prepareBtwReturn(access: Access, input: { administrationId: string; month: string }) {
  return withTenant(scope(access), async (tx) => {
    const admin = await adminFor(tx, input.administrationId);
    assertCan(access, "tax.edit", admin.companyId);
    if (!/^\d{4}-\d{2}$/.test(input.month)) throw new UserError("validation.date");
    const from = day(`${input.month}-01`);
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0));
    const rule = await ruleFor(tx, "BTW", from);
    const calc = await calculateBtw(tx, admin.id, from, to);
    const existing = await tx.taxReturn.findUnique({ where: { administrationId_taxType_periodFrom_periodTo: { administrationId: admin.id, taxType: "BTW", periodFrom: from, periodTo: to } } });
    if (existing && existing.status !== "DRAFT") throw new UserError("tax.alreadyApproved");
    const data = { ruleVersionId: rule.id, calculation: json(calc), acknowledgedById: null, acknowledgedAt: null };
    const ret = existing
      ? await tx.taxReturn.update({ where: { id: existing.id }, data })
      : await tx.taxReturn.create({ data: { organizationId: access.organizationId, administrationId: admin.id, taxType: "BTW", periodFrom: from, periodTo: to, createdById: access.userId, ...data } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "tax.prepared", entity: "TaxReturn", entityId: ret.id, details: { type: "BTW", month: input.month, payable: calc.payable } });
    return ret;
  });
}

// ───────────── Inkomstenbelasting rechtspersonen (T6) ─────────────

export async function calculateIb(tx: Tx, ret: { administrationId: string; fiscalYearId: string | null; ruleParameters: unknown; adjustments: { amount: { toString(): string } }[] }) {
  if (!ret.fiscalYearId) throw new UserError("errors.notFound");
  const balances = await loadBalances(tx, { administrationId: ret.administrationId, fiscalYearId: ret.fiscalYearId, fromPeriod: 0, toPeriod: 13 });
  const pl = profitAndLoss(balances);
  const commercial = new Decimal(pl.totals.resultBeforeTax);
  const adjustments = ret.adjustments.reduce((s, a) => s.plus(a.amount.toString()), new Decimal(0));
  const taxable = commercial.plus(adjustments);
  const rate = new Decimal(String((ret.ruleParameters as { rate?: number }).rate ?? NaN));
  if (!rate.isFinite()) throw new UserError("tax.noRule", { type: "IB_RECHTSPERSONEN" });
  const tax = taxable.gt(0) ? r2(taxable.times(rate).dividedBy(100)) : new Decimal(0);
  // Voorlopige aanslag paid: debit movement on the "Betaalde voorlopige aanslag" account (1450) in the year.
  const prepaidAcc = balances.find((b) => b.number === "1450");
  const prepaid = prepaidAcc ? Decimal.max(prepaidAcc.closing, 0) : new Decimal(0);
  return { commercialResult: commercial.toFixed(2), adjustments: adjustments.toFixed(2), taxableProfit: taxable.toFixed(2), loss: taxable.lt(0) ? taxable.abs().toFixed(2) : "0.00", rate: rate.toString(), tax: tax.toFixed(2), prepaid: prepaid.toFixed(2), payable: tax.minus(prepaid).toFixed(2) };
}

async function refreshIb(tx: Tx, returnId: string) {
  const ret = await tx.taxReturn.findUniqueOrThrow({ where: { id: returnId }, include: { adjustments: true } });
  const rule = await tx.taxRuleVersion.findUniqueOrThrow({ where: { id: ret.ruleVersionId } });
  const calc = await calculateIb(tx, { administrationId: ret.administrationId, fiscalYearId: ret.fiscalYearId, ruleParameters: rule.parameters, adjustments: ret.adjustments });
  return tx.taxReturn.update({ where: { id: ret.id }, data: { calculation: json(calc), acknowledgedById: null, acknowledgedAt: null } });
}

export async function prepareIbReturn(access: Access, input: { administrationId: string; fiscalYearId: string }) {
  return withTenant(scope(access), async (tx) => {
    const admin = await adminFor(tx, input.administrationId);
    assertCan(access, "tax.edit", admin.companyId);
    const fy = await tx.fiscalYear.findUnique({ where: { id: input.fiscalYearId } });
    if (!fy || fy.administrationId !== admin.id) throw new UserError("errors.notFound");
    const rule = await ruleFor(tx, "IB_RECHTSPERSONEN", fy.endDate);
    const existing = await tx.taxReturn.findUnique({ where: { administrationId_taxType_periodFrom_periodTo: { administrationId: admin.id, taxType: "IB_RECHTSPERSONEN", periodFrom: fy.startDate, periodTo: fy.endDate } } });
    if (existing && existing.status !== "DRAFT") throw new UserError("tax.alreadyApproved");
    const ret = existing ?? await tx.taxReturn.create({ data: { organizationId: access.organizationId, administrationId: admin.id, taxType: "IB_RECHTSPERSONEN", periodFrom: fy.startDate, periodTo: fy.endDate, fiscalYearId: fy.id, ruleVersionId: rule.id, calculation: {}, createdById: access.userId } });
    const updated = await refreshIb(tx, ret.id);
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "tax.prepared", entity: "TaxReturn", entityId: ret.id, details: { type: "IB_RECHTSPERSONEN", year: fy.code } });
    return updated;
  });
}

export async function addAdjustment(access: Access, input: { returnId: string; kind: "NON_DEDUCTIBLE" | "EXEMPT_INCOME" | "DEPRECIATION_DIFFERENCE" | "LOSS_OFFSET" | "OTHER"; description: string; amount: string }) {
  return withTenant(scope(access), async (tx) => {
    const ret = await tx.taxReturn.findUnique({ where: { id: input.returnId } });
    if (!ret || ret.taxType !== "IB_RECHTSPERSONEN") throw new UserError("errors.notFound");
    assertCan(access, "tax.edit", (await adminFor(tx, ret.administrationId)).companyId);
    if (ret.status !== "DRAFT") throw new UserError("tax.alreadyApproved");
    let amount = new Decimal(input.amount);
    // Sign conventions: non-deductible costs increase, exempt income and loss offset decrease the taxable profit.
    if (input.kind === "NON_DEDUCTIBLE") amount = amount.abs();
    if (input.kind === "EXEMPT_INCOME" || input.kind === "LOSS_OFFSET") amount = amount.abs().negated();
    await tx.taxAdjustment.create({ data: { organizationId: access.organizationId, returnId: ret.id, kind: input.kind, description: input.description, amount: amount.toFixed(2), createdById: access.userId } });
    await refreshIb(tx, ret.id);
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "tax.adjustment", entity: "TaxReturn", entityId: ret.id, details: { kind: input.kind, amount: amount.toFixed(2) } });
  });
}

// ───────────── Dividendbelasting ─────────────

/** Dividend declaration: gross dividend from retained earnings; tax withheld at the rule's rate; net payable to shareholders. */
export async function prepareDividend(access: Access, input: { administrationId: string; date: string; gross: string }) {
  return withTenant(scope(access), async (tx) => {
    const admin = await adminFor(tx, input.administrationId);
    assertCan(access, "tax.edit", admin.companyId);
    const d = day(input.date);
    const rule = await ruleFor(tx, "DIVIDENDBELASTING", d);
    const gross = new Decimal(input.gross);
    if (!gross.gt(0)) throw new UserError("validation.positive");
    const rate = new Decimal(String((rule.parameters as { rate?: number }).rate));
    const tax = r2(gross.times(rate).dividedBy(100));
    const calc = { gross: gross.toFixed(2), rate: rate.toString(), tax: tax.toFixed(2), net: gross.minus(tax).toFixed(2), payable: tax.toFixed(2) };
    if (await tx.taxReturn.findUnique({ where: { administrationId_taxType_periodFrom_periodTo: { administrationId: admin.id, taxType: "DIVIDENDBELASTING", periodFrom: d, periodTo: d } } })) throw new UserError("tax.dividendExists");
    const ret = await tx.taxReturn.create({ data: { organizationId: access.organizationId, administrationId: admin.id, taxType: "DIVIDENDBELASTING", periodFrom: d, periodTo: d, ruleVersionId: rule.id, calculation: json(calc), createdById: access.userId } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "tax.prepared", entity: "TaxReturn", entityId: ret.id, details: { type: "DIVIDENDBELASTING", ...calc } });
    return ret;
  });
}

// ───────────── Approval (T2) and posting ─────────────

const side = (v: Decimal) => (v.gt(0) ? { debit: v.toFixed(2) } : { credit: v.abs().toFixed(2) });

/**
 * Approval by someone other than the preparer. A rule that is not VERIFIED needs an explicit acknowledgement (T2), and a
 * BTW reconciliation difference needs an explanation. On approval the settlement is posted by the tax journal.
 */
export async function approveReturn(access: Access, input: { returnId: string; acknowledgeUnverified: boolean; explanation?: string }) {
  return withTenant(scope(access), async (tx) => {
    const ret = await tx.taxReturn.findUnique({ where: { id: input.returnId } });
    if (!ret) throw new UserError("errors.notFound");
    const admin = await adminFor(tx, ret.administrationId);
    assertCan(access, "tax.approve", admin.companyId);
    if (ret.status !== "DRAFT") throw new UserError("tax.alreadyApproved");
    if (ret.createdById === access.userId) throw new UserError("ledger.segregation");
    const rule = await tx.taxRuleVersion.findUniqueOrThrow({ where: { id: ret.ruleVersionId } });
    if (rule.legalStatus !== "VERIFIED" && !input.acknowledgeUnverified) throw new UserError("tax.acknowledgeRequired");
    const calc = ret.calculation as Record<string, unknown>;
    if (ret.taxType === "BTW") {
      const rec = calc.reconciliation as { differenceOutput: string; differenceInput: string };
      if ((rec.differenceOutput !== "0.00" || rec.differenceInput !== "0.00") && !input.explanation?.trim()) throw new UserError("tax.explanationRequired");
    }
    const acc = async (number: string) => (await tx.account.findFirst({ where: { administrationId: admin.id, number, type: "DETAIL" } }))?.id;
    const lines: LineInput[] = [];
    let date = iso(ret.periodTo);
    let kind: "NORMAL" | "ADJUSTMENT" = "NORMAL";
    if (ret.taxType === "BTW") {
      const c = calc as { output: string; input: string; outputAccountId: string | null; inputAccountId: string | null };
      const settle = await acc("1430");
      if (!c.outputAccountId || !c.inputAccountId || !settle) throw new UserError("tax.accountsMissing");
      const out = new Decimal(c.output);
      const inp = new Decimal(c.input);
      if (!out.isZero()) lines.push({ accountId: c.outputAccountId, ...side(out), description: "BTW-aangifte: af te dragen" });
      if (!inp.isZero()) lines.push({ accountId: c.inputAccountId, ...side(inp.negated()), description: "BTW-aangifte: te vorderen" });
      const net = out.minus(inp);
      if (!net.isZero()) lines.push({ accountId: settle, ...side(net.negated()), description: "BTW-aangifte: saldo" });
    } else if (ret.taxType === "IB_RECHTSPERSONEN") {
      const c = calc as { tax: string; prepaid: string };
      const [expense, payable, prepaidAcc] = [await acc("4950"), await acc("1440"), await acc("1450")];
      if (!expense || !payable || !prepaidAcc) throw new UserError("tax.accountsMissing");
      const tax = new Decimal(c.tax);
      const prepaid = new Decimal(c.prepaid);
      if (!tax.isZero()) lines.push({ accountId: expense, debit: tax.toFixed(2), description: "Belasting naar de winst" });
      if (!prepaid.isZero()) lines.push({ accountId: prepaidAcc, credit: prepaid.toFixed(2), description: "Verrekening voorlopige aanslag" });
      const rest = tax.minus(prepaid);
      if (!rest.isZero()) lines.push({ accountId: payable, ...side(rest.negated()), description: rest.gt(0) ? "Te betalen inkomstenbelasting" : "Te ontvangen inkomstenbelasting" });
      kind = "ADJUSTMENT"; // year-end tax provision in period 13
    } else {
      const c = calc as { gross: string; tax: string; net: string };
      const [retained, dividendPayable, taxPayable] = [await acc("0630"), await acc("1660"), await acc("1470")];
      if (!retained || !dividendPayable || !taxPayable) throw new UserError("tax.accountsMissing");
      lines.push({ accountId: retained, debit: c.gross, description: "Dividenduitkering" }, { accountId: dividendPayable, credit: c.net, description: "Te betalen dividend (netto)" }, { accountId: taxPayable, credit: c.tax, description: "Ingehouden dividendbelasting" });
      date = iso(ret.periodFrom);
    }
    let entryId: string | null = null;
    if (lines.length >= 2) {
      const journal = await tx.journal.findFirst({ where: { administrationId: admin.id, type: "TAX", status: "ACTIVE" } });
      if (!journal) throw new UserError("ledger.invalidJournal");
      if (kind === "ADJUSTMENT") await tx.accountingPeriod.updateMany({ where: { fiscalYearId: ret.fiscalYearId ?? "", number: 13, status: { not: "OPEN" } }, data: { status: "OPEN" } });
      const entry = await engine.createAndPostApproved(tx, access, {
        administrationId: admin.id, journalId: journal.id, entryDate: date, kind, description: `${ret.taxType === "BTW" ? "BTW-aangifte" : ret.taxType === "IB_RECHTSPERSONEN" ? "Inkomstenbelasting" : "Dividenduitkering"} ${iso(ret.periodFrom)} – ${iso(ret.periodTo)}`,
        lines, sourceType: "TAX", sourceId: ret.id, idempotencyKey: `tax-return:${ret.id}`,
      }, access.userId);
      entryId = entry.id;
    }
    const updated = await tx.taxReturn.update({
      where: { id: ret.id },
      data: { status: "APPROVED", approvedById: access.userId, approvedAt: new Date(), entryId, explanation: input.explanation?.trim() || null, ...(rule.legalStatus !== "VERIFIED" ? { acknowledgedById: access.userId, acknowledgedAt: new Date() } : {}) },
    });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "tax.approved", entity: "TaxReturn", entityId: ret.id, details: { type: ret.taxType, ruleStatus: rule.legalStatus, acknowledgedUnverified: rule.legalStatus !== "VERIFIED", entryId } });
    return updated;
  });
}

/** T4: FILED only with a filing-evidence document (Belastingdienst receipt) and an explicit confirmation. */
export async function fileReturn(access: Access, input: { returnId: string; fileName: string; bytes: Uint8Array; reference?: string; confirmed: boolean }) {
  if (!input.confirmed) throw new UserError("tax.confirmFiling");
  const mimeType = sniffMime(input.bytes);
  if (!mimeType) throw new UserError("scan.unsupportedType");
  return withTenant(scope(access), async (tx) => {
    const ret = await tx.taxReturn.findUnique({ where: { id: input.returnId } });
    if (!ret) throw new UserError("errors.notFound");
    assertCan(access, "tax.edit", (await adminFor(tx, ret.administrationId)).companyId);
    if (ret.status !== "APPROVED") throw new UserError("tax.notApproved");
    const doc = await tx.document.create({
      data: { organizationId: access.organizationId, administrationId: ret.administrationId, kind: "EVIDENCE", fileName: input.fileName.slice(0, 200), mimeType, sizeBytes: input.bytes.length, sha256: createHash("sha256").update(input.bytes).digest("hex"), status: "PROCESSED", uploadedById: access.userId },
    });
    await tx.documentFile.create({ data: { documentId: doc.id, organizationId: access.organizationId, data: Buffer.from(input.bytes) } });
    const updated = await tx.taxReturn.update({ where: { id: ret.id }, data: { status: "FILED", evidenceDocumentId: doc.id, filingReference: input.reference?.trim() || null, filedById: access.userId, filedAt: new Date() } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "tax.filed", entity: "TaxReturn", entityId: ret.id, details: { evidence: doc.id, reference: input.reference ?? null } });
    return updated;
  });
}
