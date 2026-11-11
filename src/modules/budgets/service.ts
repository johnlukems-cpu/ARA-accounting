import Decimal from "decimal.js";
import type { AccountCategory } from "@prisma/client";
import { z } from "zod";
import type { Tx } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { audit } from "@/core/audit/audit";
import { assertCan, type Access } from "@/core/auth/access";
import { UserError } from "@/core/errors";
import { BUDGET_CATEGORIES, distribute, isAlert, natural, parseBudgetCsv, variance } from "./domain";

const scope = (a: Access) => ({ organizationId: a.organizationId, userId: a.userId });
const pct = z.string().trim().transform((v) => v.replace(",", ".")).pipe(z.string().regex(/^-?\d+(\.\d{1,2})?$/, "validation.amount"));

export const budgetSchema = z.object({
  administrationId: z.string().min(1),
  fiscalYearId: z.string().min(1, "validation.required"),
  name: z.string().trim().min(2, "validation.required").max(80),
  scenario: z.enum(["BASE", "BEST", "WORST"]).default("BASE"),
  basis: z.enum(["MANUAL", "PRIOR_ACTUALS", "PRIOR_BUDGET"]).default("MANUAL"),
  adjustmentPct: pct.default("0"),
  alertThresholdPct: pct.default("10"),
});

async function adminFor(tx: Tx, id: string) {
  const admin = await tx.administration.findUnique({ where: { id } });
  if (!admin) throw new UserError("errors.notFound");
  return admin;
}

export async function budgetableAccounts(tx: Tx, administrationId: string) {
  return tx.account.findMany({ where: { administrationId, type: "DETAIL", status: "ACTIVE", category: { in: BUDGET_CATEGORIES } }, orderBy: { number: "asc" } });
}

/** Posted natural amounts per account and period of a fiscal year (B1: drafts never count). */
export async function actualsByPeriod(tx: Tx, administrationId: string, fiscalYearId: string) {
  const rows = await tx.$queryRaw<{ accountId: string; category: AccountCategory; period: number; amount: string }[]>`
    SELECT l."accountId", a.category, p.number AS period, SUM(l."debitBase" - l."creditBase")::text AS amount
      FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId" JOIN "AccountingPeriod" p ON p.id = e."periodId" JOIN "Account" a ON a.id = l."accountId"
     WHERE e."administrationId" = ${administrationId} AND e."fiscalYearId" = ${fiscalYearId} AND e.status = 'POSTED' AND p.number BETWEEN 1 AND 12
       AND a.category::text = ANY(${BUDGET_CATEGORIES as string[]})
     GROUP BY l."accountId", a.category, p.number`;
  const map = new Map<string, Decimal>();
  for (const r of rows) map.set(`${r.accountId}:${r.period}`, natural(r.amount, r.category));
  return map;
}

async function priorFiscalYear(tx: Tx, administrationId: string, fiscalYearId: string) {
  const fy = await tx.fiscalYear.findUniqueOrThrow({ where: { id: fiscalYearId } });
  return tx.fiscalYear.findFirst({ where: { administrationId, endDate: { lt: fy.startDate } }, orderBy: { endDate: "desc" } });
}

const scale = (v: Decimal.Value, adjustmentPct: string) => new Decimal(v).times(new Decimal(100).plus(adjustmentPct)).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export async function createBudget(access: Access, raw: z.input<typeof budgetSchema>) {
  const input = budgetSchema.parse(raw);
  return withTenant(scope(access), async (tx) => {
    const admin = await adminFor(tx, input.administrationId);
    assertCan(access, "budgets.create", admin.companyId);
    const fy = await tx.fiscalYear.findUnique({ where: { id: input.fiscalYearId } });
    if (!fy || fy.administrationId !== admin.id) throw new UserError("errors.notFound");
    if (await tx.budget.findFirst({ where: { administrationId: admin.id, fiscalYearId: fy.id, name: input.name, scenario: input.scenario } })) throw new UserError("errors.codeTaken");

    // Lines for the basis, scaled by the adjustment.
    const lines: { accountId: string; period: number; amount: string }[] = [];
    if (input.basis !== "MANUAL") {
      const prior = await priorFiscalYear(tx, admin.id, fy.id);
      if (!prior) throw new UserError("budgets.noPriorYear");
      if (input.basis === "PRIOR_ACTUALS") {
        for (const [key, amount] of await actualsByPeriod(tx, admin.id, prior.id)) {
          const [accountId, period] = key.split(":") as [string, string];
          const v = scale(amount, input.adjustmentPct);
          if (!v.isZero()) lines.push({ accountId, period: Number(period), amount: v.toFixed(2) });
        }
      } else {
        const source = await tx.budgetVersion.findFirst({
          where: { status: "APPROVED", budget: { administrationId: admin.id, fiscalYearId: prior.id, scenario: input.scenario, status: "ACTIVE" } },
          orderBy: [{ approvedAt: "desc" }], include: { lines: true },
        });
        if (!source) throw new UserError("budgets.noPriorBudget");
        for (const l of source.lines) {
          const v = scale(l.amount.toString(), input.adjustmentPct);
          if (!v.isZero()) lines.push({ accountId: l.accountId, period: l.period, amount: v.toFixed(2) });
        }
      }
    }
    const budget = await tx.budget.create({
      data: { organizationId: access.organizationId, administrationId: admin.id, fiscalYearId: fy.id, name: input.name, scenario: input.scenario, alertThresholdPct: input.alertThresholdPct, createdById: access.userId },
    });
    const version = await tx.budgetVersion.create({
      data: { organizationId: access.organizationId, budgetId: budget.id, version: 1, basis: input.basis, adjustmentPct: input.adjustmentPct, createdById: access.userId },
    });
    if (lines.length) await tx.budgetLine.createMany({ data: lines.map((l) => ({ organizationId: access.organizationId, versionId: version.id, ...l })) });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "budget.created", entity: "Budget", entityId: budget.id, details: { name: input.name, fiscalYear: fy.code, basis: input.basis, adjustmentPct: input.adjustmentPct, lines: lines.length } });
    return { budget, version };
  });
}

async function loadVersion(tx: Tx, versionId: string) {
  const v = await tx.budgetVersion.findUnique({ where: { id: versionId }, include: { budget: true } });
  if (!v) throw new UserError("errors.notFound");
  const admin = await adminFor(tx, v.budget.administrationId);
  return { v, admin };
}

async function draft(tx: Tx, access: Access, versionId: string) {
  const { v, admin } = await loadVersion(tx, versionId);
  assertCan(access, "budgets.edit", admin.companyId);
  if (v.status !== "DRAFT") throw new UserError("budgets.notDraft");
  return { v, admin };
}

async function writeCells(tx: Tx, organizationId: string, versionId: string, administrationId: string, cells: { accountId: string; period: number; amount: string }[]) {
  const allowed = new Set((await budgetableAccounts(tx, administrationId)).map((a) => a.id));
  for (const c of cells) {
    if (!allowed.has(c.accountId)) throw new UserError("budgets.invalidAccount");
    if (!Number.isInteger(c.period) || c.period < 1 || c.period > 12) throw new UserError("budgets.csvPeriod");
  }
  const accountIds = [...new Set(cells.map((c) => c.accountId))];
  await tx.budgetLine.deleteMany({ where: { versionId, dimensionId: "", OR: cells.map((c) => ({ accountId: c.accountId, period: c.period })) } });
  const rows = cells.filter((c) => !new Decimal(c.amount).isZero()).map((c) => ({ organizationId, versionId, accountId: c.accountId, period: c.period, amount: new Decimal(c.amount).toFixed(2) }));
  if (rows.length) await tx.budgetLine.createMany({ data: rows });
  return { accounts: accountIds.length, lines: rows.length };
}

/** Saves grid cells of a draft version (each cell replaces the amount for that account and month). */
export async function saveCells(access: Access, versionId: string, cells: { accountId: string; period: number; amount: string }[]) {
  return withTenant(scope(access), async (tx) => {
    const { v, admin } = await draft(tx, access, versionId);
    const r = await writeCells(tx, access.organizationId, v.id, admin.id, cells);
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "budget.linesSaved", entity: "BudgetVersion", entityId: v.id, details: r });
    return r;
  });
}

/** Spreads a yearly amount for one account: evenly or following last year's monthly actuals. */
export async function distributeYear(access: Access, input: { versionId: string; accountId: string; amount: string; method: "EVEN" | "PRIOR_YEAR" }) {
  return withTenant(scope(access), async (tx) => {
    const { v, admin } = await draft(tx, access, input.versionId);
    let weights: Decimal[] | undefined;
    if (input.method === "PRIOR_YEAR") {
      const prior = await priorFiscalYear(tx, admin.id, v.budget.fiscalYearId);
      if (!prior) throw new UserError("budgets.noPriorYear");
      const actual = await actualsByPeriod(tx, admin.id, prior.id);
      weights = Array.from({ length: 12 }, (_, i) => Decimal.max(actual.get(`${input.accountId}:${i + 1}`) ?? 0, 0));
    }
    const parts = distribute(new Decimal(input.amount).toFixed(2), weights);
    return writeCells(tx, access.organizationId, v.id, admin.id, parts.map((amount, i) => ({ accountId: input.accountId, period: i + 1, amount })));
  });
}

export async function importLines(access: Access, versionId: string, content: string) {
  return withTenant(scope(access), async (tx) => {
    const { v, admin } = await draft(tx, access, versionId);
    const { lines, errors } = parseBudgetCsv(content);
    if (errors.length) throw new UserError("budgets.csvErrors", { lines: errors.slice(0, 5).map((e) => e.line).join(", ") });
    if (!lines.length) throw new UserError("budgets.csvEmpty");
    const accounts = new Map((await budgetableAccounts(tx, admin.id)).map((a) => [a.number, a.id]));
    const unknown = [...new Set(lines.filter((l) => !accounts.has(l.account)).map((l) => l.account))];
    if (unknown.length) throw new UserError("budgets.csvUnknownAccounts", { accounts: unknown.slice(0, 8).join(", ") });
    const r = await writeCells(tx, access.organizationId, v.id, admin.id, lines.map((l) => ({ accountId: accounts.get(l.account)!, period: l.period, amount: l.amount })));
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "budget.imported", entity: "BudgetVersion", entityId: v.id, details: r });
    return r;
  });
}

export async function submitVersion(access: Access, versionId: string) {
  return withTenant(scope(access), async (tx) => {
    const { v } = await draft(tx, access, versionId);
    await tx.budgetVersion.update({ where: { id: v.id }, data: { status: "SUBMITTED", submittedById: access.userId } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "budget.submitted", entity: "BudgetVersion", entityId: v.id });
  });
}

/** Approver sends a submitted version back for changes. */
export async function returnToDraft(access: Access, versionId: string, reason: string) {
  return withTenant(scope(access), async (tx) => {
    const { v, admin } = await loadVersion(tx, versionId);
    assertCan(access, "budgets.approve", admin.companyId);
    if (v.status !== "SUBMITTED") throw new UserError("ledger.wrongStatus");
    await tx.budgetVersion.update({ where: { id: v.id }, data: { status: "DRAFT", submittedById: null } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "budget.returned", entity: "BudgetVersion", entityId: v.id, details: { reason } });
  });
}

/** B3: approval by someone other than the submitter; the previously approved version becomes SUPERSEDED. */
export async function approveVersion(access: Access, versionId: string) {
  return withTenant(scope(access), async (tx) => {
    const { v, admin } = await loadVersion(tx, versionId);
    assertCan(access, "budgets.approve", admin.companyId);
    if (v.status !== "SUBMITTED") throw new UserError("ledger.wrongStatus");
    if (v.submittedById === access.userId) throw new UserError("ledger.segregation");
    await tx.budgetVersion.updateMany({ where: { budgetId: v.budgetId, status: "APPROVED" }, data: { status: "SUPERSEDED" } });
    await tx.budgetVersion.update({ where: { id: v.id }, data: { status: "APPROVED", approvedById: access.userId, approvedAt: new Date() } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "budget.approved", entity: "BudgetVersion", entityId: v.id, details: { version: v.version } });
  });
}

/** New draft version copied from the latest version (one open version at a time). */
export async function newVersion(access: Access, budgetId: string, notes?: string) {
  return withTenant(scope(access), async (tx) => {
    const budget = await tx.budget.findUnique({ where: { id: budgetId }, include: { versions: { orderBy: { version: "desc" }, include: { lines: true } } } });
    if (!budget) throw new UserError("errors.notFound");
    const admin = await adminFor(tx, budget.administrationId);
    assertCan(access, "budgets.edit", admin.companyId);
    if (budget.versions.some((x) => x.status === "DRAFT" || x.status === "SUBMITTED")) throw new UserError("budgets.openVersionExists");
    const latest = budget.versions[0]!;
    const v = await tx.budgetVersion.create({
      data: { organizationId: access.organizationId, budgetId, version: latest.version + 1, basis: latest.basis, adjustmentPct: latest.adjustmentPct, notes: notes || null, createdById: access.userId },
    });
    if (latest.lines.length) await tx.budgetLine.createMany({ data: latest.lines.map((l) => ({ organizationId: access.organizationId, versionId: v.id, accountId: l.accountId, dimensionId: l.dimensionId, period: l.period, amount: l.amount })) });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "budget.versionCreated", entity: "Budget", entityId: budgetId, details: { version: v.version, from: latest.version } });
    return v;
  });
}

// ───────────── Reporting ─────────────

/** Version used for reporting: the requested one, else the approved one, else the latest. */
export async function reportVersion(tx: Tx, budgetId: string, versionId?: string) {
  const versions = await tx.budgetVersion.findMany({ where: { budgetId }, orderBy: { version: "desc" } });
  return versions.find((v) => v.id === versionId) ?? versions.find((v) => v.status === "APPROVED") ?? versions[0] ?? null;
}

type Row = { accountId: string; number: string; name: string; category: AccountCategory; budget: string; actual: string; variance: string; pct: string | null; utilisation: string | null; favourable: boolean | null; alert: boolean };

/** Budget versus actual for a period range (B1, B2), with totals per category and the result. */
export async function budgetVsActual(tx: Tx, q: { budgetId: string; versionId?: string; fromPeriod: number; toPeriod: number }) {
  const budget = await tx.budget.findUniqueOrThrow({ where: { id: q.budgetId } });
  const version = await reportVersion(tx, budget.id, q.versionId);
  const lines = version ? await tx.budgetLine.findMany({ where: { versionId: version.id, period: { gte: q.fromPeriod, lte: q.toPeriod } } }) : [];
  const actual = await actualsByPeriod(tx, budget.administrationId, budget.fiscalYearId);
  const accounts = await budgetableAccounts(tx, budget.administrationId);
  const rows: Row[] = [];
  for (const a of accounts) {
    const b = lines.filter((l) => l.accountId === a.id).reduce((s, l) => s.plus(l.amount.toString()), new Decimal(0));
    let act = new Decimal(0);
    for (let p = q.fromPeriod; p <= q.toPeriod; p++) act = act.plus(actual.get(`${a.id}:${p}`) ?? 0);
    if (b.isZero() && act.isZero()) continue;
    rows.push({ accountId: a.id, number: a.number, name: a.name, category: a.category, budget: b.toFixed(2), actual: act.toFixed(2), ...variance(b, act, a.category), alert: isAlert(b, act, a.category, budget.alertThresholdPct.toString()) });
  }
  const sum = (cats: AccountCategory[], key: "budget" | "actual") => rows.filter((r) => cats.includes(r.category)).reduce((s, r) => s.plus(r[key]), new Decimal(0));
  const income: AccountCategory[] = ["REVENUE", "FINANCIAL_INCOME"];
  const costs: AccountCategory[] = ["COST_OF_SALES", "OPERATING_EXPENSE", "FINANCIAL_EXPENSE"];
  const result = { budget: sum(income, "budget").minus(sum(costs, "budget")).toFixed(2), actual: sum(income, "actual").minus(sum(costs, "actual")).toFixed(2) };
  const categories = BUDGET_CATEGORIES.map((c) => ({ category: c, budget: sum([c], "budget").toFixed(2), actual: sum([c], "actual").toFixed(2) })).filter((c) => c.budget !== "0.00" || c.actual !== "0.00");
  return { budget, version, rows, categories, result: { ...result, ...variance(result.budget, result.actual, "REVENUE") }, alerts: rows.filter((r) => r.alert) };
}

/** Rolling forecast: actuals for periods 1..asOf, budget for the remaining months. */
export async function rollingForecast(tx: Tx, q: { budgetId: string; versionId?: string; asOfPeriod: number }) {
  const budget = await tx.budget.findUniqueOrThrow({ where: { id: q.budgetId } });
  const version = await reportVersion(tx, budget.id, q.versionId);
  const lines = version ? await tx.budgetLine.findMany({ where: { versionId: version.id } }) : [];
  const actual = await actualsByPeriod(tx, budget.administrationId, budget.fiscalYearId);
  const accounts = await budgetableAccounts(tx, budget.administrationId);
  const rows: (ReturnType<typeof variance> & { accountId: string; number: string; name: string; category: AccountCategory; actualToDate: string; remainingBudget: string; forecast: string; yearBudget: string })[] = [];
  for (const a of accounts) {
    const own = lines.filter((l) => l.accountId === a.id);
    const yearBudget = own.reduce((s, l) => s.plus(l.amount.toString()), new Decimal(0));
    let act = new Decimal(0);
    for (let p = 1; p <= q.asOfPeriod; p++) act = act.plus(actual.get(`${a.id}:${p}`) ?? 0);
    const rest = own.filter((l) => l.period > q.asOfPeriod).reduce((s, l) => s.plus(l.amount.toString()), new Decimal(0));
    const forecast = act.plus(rest);
    if (yearBudget.isZero() && forecast.isZero()) continue;
    rows.push({ accountId: a.id, number: a.number, name: a.name, category: a.category, actualToDate: act.toFixed(2), remainingBudget: rest.toFixed(2), forecast: forecast.toFixed(2), yearBudget: yearBudget.toFixed(2), ...variance(yearBudget, forecast, a.category) });
  }
  const income = (c: AccountCategory) => c === "REVENUE" || c === "FINANCIAL_INCOME";
  const net = (key: "forecast" | "yearBudget") => rows.reduce((s, r) => (income(r.category) ? s.plus(r[key]) : s.minus(r[key])), new Decimal(0)).toFixed(2);
  return { budget, version, rows, result: { forecast: net("forecast"), yearBudget: net("yearBudget") } };
}
