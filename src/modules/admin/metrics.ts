import Decimal from "decimal.js";
import type { Tx } from "@/core/db/client";
import { buildReports } from "@/modules/reporting/service";
import { accountBalance } from "@/modules/banking/service";
import { monthlyValue } from "./billing";
import type { Home } from "./home";

/**
 * Figures for the executive dashboard and the management reports — all computed from database records.
 * Three different notions are kept apart:
 *   • invoiced   = posted sales invoices (billing view, by invoice date, base currency; credit notes subtract);
 *   • collected  = customer payments received in the ledger (cash view, by payment date, base currency);
 *   • accounting = revenue and costs in the general ledger (P&L of the fiscal year, posted entries only).
 * Recurring revenue (MRR/ARR) is shown per currency, from ACTIVE subscriptions; it is not converted.
 */
const D = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
const ym = (d: Date) => d.toISOString().slice(0, 7);

export function lastMonths(n: number, now = new Date()): string[] {
  return Array.from({ length: n }, (_, i) => ym(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (n - 1 - i), 1))));
}

export async function dashboard(tx: Tx, home: Home, now = new Date()) {
  const admin = await tx.administration.findUniqueOrThrow({ where: { id: home.administrationId } });
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const months = lastMonths(12, now);
  const since = new Date(`${months[0]}-01T00:00:00Z`);

  const [stages, newCustomers, subs, invoices, payments, openItems, purchases, financial, tasks, recent, pendingPayments, openTickets, drafts] = await Promise.all([
    tx.crmCustomer.groupBy({ by: ["stage"], where: { status: "ACTIVE" }, _count: { _all: true } }),
    tx.crmCustomer.count({ where: { convertedAt: { gte: monthStart } } }),
    tx.araSubscription.findMany({ include: { customer: { select: { id: true } } } }),
    tx.invoice.findMany({ where: { administrationId: home.administrationId, type: "SALES", status: { in: ["POSTED", "PARTIALLY_PAID", "PAID"] }, invoiceDate: { gte: since < yearStart ? since : yearStart } }, select: { kind: true, invoiceDate: true, grossBase: true } }),
    tx.payment.findMany({ where: { administrationId: home.administrationId, date: { gte: since < yearStart ? since : yearStart }, party: { isCustomer: true } }, select: { direction: true, date: true, amount: true, exchangeRate: true } }),
    tx.openItem.findMany({ where: { administrationId: home.administrationId, side: "RECEIVABLE", status: "OPEN" }, select: { remainingAmount: true, originalRate: true, dueDate: true, sourceType: true } }),
    tx.invoice.findMany({ where: { administrationId: home.administrationId, type: "PURCHASE", status: { in: ["POSTED", "PARTIALLY_PAID", "PAID"] }, invoiceDate: { gte: since } }, select: { kind: true, invoiceDate: true, netAmount: true, exchangeRate: true } }),
    tx.financialAccount.findMany({ where: { administrationId: home.administrationId, status: "ACTIVE" } }),
    tx.crmActivity.findMany({ where: { type: "TASK", doneAt: null }, orderBy: [{ dueDate: "asc" }], take: 10, include: { customer: { select: { id: true, name: true } } } }),
    tx.crmActivity.findMany({ orderBy: { createdAt: "desc" }, take: 10, include: { customer: { select: { id: true, name: true } } } }),
    tx.araPayment.count({ where: { status: "PENDING" } }),
    tx.supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    tx.invoice.count({ where: { administrationId: home.administrationId, type: "SALES", status: { in: ["DRAFT", "REVIEW", "APPROVED"] } } }),
  ]);

  const sign = (kind: string) => (kind === "CREDIT_NOTE" ? -1 : 1);
  const invoicedYear = invoices.filter((i) => i.invoiceDate >= yearStart).reduce((s, i) => s.plus(D(i.grossBase.toString()).times(sign(i.kind))), D(0));
  const paidBase = (p: { amount: Decimal.Value; exchangeRate: Decimal.Value }) => D(p.amount.toString()).times(p.exchangeRate.toString());
  const collectedYear = payments.filter((p) => p.date >= yearStart).reduce((s, p) => s.plus(paidBase(p).times(p.direction === "IN" ? 1 : -1)), D(0));
  const openInvoices = openItems.filter((i) => i.sourceType === "INVOICE" && D(i.remainingAmount.toString()).gt(0));
  const outstanding = openInvoices.reduce((s, i) => s.plus(D(i.remainingAmount.toString()).times(i.originalRate.toString())), D(0));
  const overdueItems = openInvoices.filter((i) => i.dueDate < today);
  const overdue = overdueItems.reduce((s, i) => s.plus(D(i.remainingAmount.toString()).times(i.originalRate.toString())), D(0));

  let cash = D(0);
  for (const fa of financial) {
    const bal = await accountBalance(tx, fa.ledgerAccountId, today);
    cash = cash.plus(bal.base);
  }

  // Accounting view: P&L of the current fiscal year (posted entries only).
  const fy = await tx.fiscalYear.findFirst({ where: { administrationId: home.administrationId, startDate: { lte: today }, endDate: { gte: today } } });
  const pl = fy ? (await buildReports(tx, { administrationId: home.administrationId, fiscalYearId: fy.id, fromPeriod: 1, toPeriod: 12 })).pl : null;
  const accountingRevenue = pl ? D(pl.totals.revenue) : D(0);
  const operatingResult = pl ? D(pl.totals.operatingResult) : D(0);
  const expensesYear = accountingRevenue.minus(operatingResult);

  const mrr = new Map<string, Decimal>();
  for (const s of subs.filter((s) => s.status === "ACTIVE")) mrr.set(s.currency, (mrr.get(s.currency) ?? D(0)).plus(monthlyValue(s)));
  const subCount = (status: string) => subs.filter((s) => s.status === status).length;
  const customersWithActiveSub = new Set(subs.filter((s) => s.status === "ACTIVE" || s.status === "TRIAL").map((s) => s.customerId));
  const stage = (st: string) => stages.find((s) => s.stage === st)?._count._all ?? 0;

  const series = months.map((m) => ({
    month: m,
    invoiced: invoices.filter((i) => ym(i.invoiceDate) === m).reduce((s, i) => s.plus(D(i.grossBase.toString()).times(sign(i.kind))), D(0)).toFixed(2),
    collected: payments.filter((p) => ym(p.date) === m).reduce((s, p) => s.plus(paidBase(p).times(p.direction === "IN" ? 1 : -1)), D(0)).toFixed(2),
    expenses: purchases.filter((i) => ym(i.invoiceDate) === m).reduce((s, i) => s.plus(D(i.netAmount.toString()).times(i.exchangeRate.toString()).times(sign(i.kind))), D(0)).toFixed(2),
    newSubscriptions: subs.filter((s) => ym(s.startDate) === m).length,
    activeSubscriptions: subs.filter((s) => ym(s.startDate) <= m && (!s.cancelledAt || ym(s.cancelledAt) > m)).length,
  }));
  const customers = await tx.crmCustomer.findMany({ where: { convertedAt: { not: null } }, select: { convertedAt: true } });
  const customerGrowth = months.map((m) => ({ month: m, customers: customers.filter((c) => ym(c.convertedAt!) <= m).length }));

  return {
    baseCurrency: admin.baseCurrency,
    customers: { total: stage("CUSTOMER"), active: customersWithActiveSub.size, newThisMonth: newCustomers, leads: stage("LEAD") + stage("CONTACTED") + stage("QUALIFIED") + stage("PROPOSAL"), byStage: Object.fromEntries(["LEAD", "CONTACTED", "QUALIFIED", "PROPOSAL", "CUSTOMER", "INACTIVE"].map((s) => [s, stage(s)])) },
    subscriptions: { total: subs.length, active: subCount("ACTIVE"), trial: subCount("TRIAL"), suspended: subCount("SUSPENDED"), cancelled: subCount("CANCELLED"), mrr: [...mrr.entries()].map(([currency, v]) => ({ currency, mrr: v.toFixed(2), arr: v.times(12).toFixed(2) })) },
    money: { invoicedYear: invoicedYear.toFixed(2), collectedYear: collectedYear.toFixed(2), outstanding: outstanding.toFixed(2), overdue: overdue.toFixed(2), overdueCount: overdueItems.length, accountingRevenue: accountingRevenue.toFixed(2), expensesYear: expensesYear.toFixed(2), operatingResult: operatingResult.toFixed(2), cash: cash.toFixed(2), fiscalYear: fy?.code ?? null },
    series, customerGrowth,
    work: { tasks, recent, pendingPayments, openTickets, draftInvoices: drafts, expiredTrials: subs.filter((s) => s.status === "TRIAL" && s.trialEndsAt && s.trialEndsAt < today).length },
  };
}
