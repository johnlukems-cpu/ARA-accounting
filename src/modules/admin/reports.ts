import Decimal from "decimal.js";
import type { Tx } from "@/core/db/client";
import { aging } from "@/modules/invoicing/reports";
import { buildReports } from "@/modules/reporting/service";
import { monthlyValue } from "./billing";
import { dashboard, lastMonths } from "./metrics";
import type { Home } from "./home";

/**
 * Management reports of ARA Intelligent Solutions. Each report is a plain table (title, columns, rows) so the page,
 * CSV and PDF exports show exactly the same figures. Amounts are in the base currency unless a column says otherwise.
 */
export const ADMIN_REPORTS = ["revenueMonthly", "revenueByAccount", "revenueByCustomer", "recurring", "customerGrowth", "receivables", "collection", "expenses", "cashflow", "profitLoss", "churn", "trialConversion"] as const;
export type AdminReportKind = (typeof ADMIN_REPORTS)[number];
export interface ReportTable { columns: string[]; rows: (string | number)[][]; notes?: string[] }

const D = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
const ym = (d: Date) => d.toISOString().slice(0, 7);
const sign = (kind: string) => (kind === "CREDIT_NOTE" ? -1 : 1);

export async function adminReport(tx: Tx, home: Home, kind: AdminReportKind, year: number, now = new Date()): Promise<ReportTable> {
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const salesWhere = { administrationId: home.administrationId, type: "SALES" as const, status: { in: ["POSTED", "PARTIALLY_PAID", "PAID"] as ("POSTED" | "PARTIALLY_PAID" | "PAID")[] }, invoiceDate: { gte: from, lt: to } };

  switch (kind) {
    case "revenueMonthly": {
      const [invoices, payments] = await Promise.all([
        tx.invoice.findMany({ where: salesWhere, select: { kind: true, invoiceDate: true, grossBase: true, netAmount: true, exchangeRate: true } }),
        tx.payment.findMany({ where: { administrationId: home.administrationId, direction: "IN", date: { gte: from, lt: to }, party: { isCustomer: true } }, select: { date: true, amount: true, exchangeRate: true } }),
      ]);
      const rows = months.map((m) => {
        const inv = invoices.filter((i) => ym(i.invoiceDate) === m);
        const net = inv.reduce((s, i) => s.plus(D(i.netAmount.toString()).times(i.exchangeRate.toString()).times(sign(i.kind))), D(0));
        const gross = inv.reduce((s, i) => s.plus(D(i.grossBase.toString()).times(sign(i.kind))), D(0));
        const coll = payments.filter((p) => ym(p.date) === m).reduce((s, p) => s.plus(D(p.amount.toString()).times(p.exchangeRate.toString())), D(0));
        return [m, inv.length, net.toFixed(2), gross.toFixed(2), coll.toFixed(2)];
      });
      const total = (i: number) => rows.reduce((s, r) => s.plus(String(r[i])), D(0)).toFixed(2);
      rows.push(["Totaal", rows.reduce((s, r) => s + Number(r[1]), 0), total(2), total(3), total(4)]);
      return { columns: ["Maand", "Facturen", "Gefactureerd excl. BTW", "Gefactureerd incl. BTW", "Ontvangen"], rows, notes: ["Gefactureerd = geboekte verkoopfacturen min creditnota's (factuurdatum). Ontvangen = betalingen van klanten (betaaldatum)."] };
    }
    case "revenueByAccount": {
      const lines = await tx.invoiceLine.findMany({ where: { invoice: salesWhere }, select: { netAmount: true, accountId: true, invoice: { select: { kind: true, exchangeRate: true } } } });
      const accounts = await tx.account.findMany({ where: { id: { in: [...new Set(lines.map((l) => l.accountId))] } } });
      const by = new Map<string, Decimal>();
      for (const l of lines) by.set(l.accountId, (by.get(l.accountId) ?? D(0)).plus(D(l.netAmount.toString()).times(l.invoice.exchangeRate.toString()).times(sign(l.invoice.kind))));
      const products = await tx.product.findMany({ where: { revenueAccountId: { in: [...by.keys()] } } });
      return { columns: ["Rekening", "Producten", "Omzet excl. BTW"], rows: [...by.entries()].map(([id, v]) => { const a = accounts.find((x) => x.id === id); return [`${a?.number} ${a?.name}`, products.filter((p) => p.revenueAccountId === id).map((p) => p.name).join(", ") || "—", v.toFixed(2)]; }).sort((a, b) => String(a[0]).localeCompare(String(b[0]))), notes: ["Omzet per opbrengstrekening; elk product boekt op zijn eigen opbrengstrekening."] };
    }
    case "revenueByCustomer": {
      const invoices = await tx.invoice.findMany({ where: salesWhere, select: { kind: true, grossBase: true, netAmount: true, exchangeRate: true, party: { select: { id: true, name: true } } } });
      const by = new Map<string, { name: string; net: Decimal; count: number }>();
      for (const i of invoices) {
        const r = by.get(i.party.id) ?? { name: i.party.name, net: D(0), count: 0 };
        r.net = r.net.plus(D(i.netAmount.toString()).times(i.exchangeRate.toString()).times(sign(i.kind)));
        r.count += 1;
        by.set(i.party.id, r);
      }
      return { columns: ["Klant", "Facturen", "Omzet excl. BTW"], rows: [...by.values()].sort((a, b) => b.net.comparedTo(a.net)).map((r) => [r.name, r.count, r.net.toFixed(2)]) };
    }
    case "recurring": {
      const subs = await tx.araSubscription.findMany({ where: { status: "ACTIVE" } });
      const products = await tx.product.findMany();
      const by = new Map<string, Decimal>();
      for (const s of subs) by.set(`${s.productId}|${s.currency}`, (by.get(`${s.productId}|${s.currency}`) ?? D(0)).plus(monthlyValue(s)));
      return { columns: ["Product", "Valuta", "Actieve abonnementen", "MRR", "ARR"], rows: [...by.entries()].map(([k, v]) => { const [pid, cur] = k.split("|"); return [products.find((p) => p.id === pid)?.name ?? pid!, cur!, subs.filter((s) => s.productId === pid && s.currency === cur).length, v.toFixed(2), v.times(12).toFixed(2)]; }), notes: ["MRR = maandbedrag van actieve abonnementen (jaar- en kwartaalabonnementen omgerekend naar per maand), per valuta, niet omgerekend tussen valuta."] };
    }
    case "customerGrowth": {
      const d = await dashboard(tx, home, now);
      return { columns: ["Maand", "Klanten (cumulatief)", "Nieuwe abonnementen", "Actieve abonnementen"], rows: d.customerGrowth.map((c, i) => [c.month, c.customers, d.series[i]!.newSubscriptions, d.series[i]!.activeSubscriptions]) };
    }
    case "receivables": {
      const r = await aging(tx, { administrationId: home.administrationId, side: "RECEIVABLE", asOf: now });
      return { columns: ["Klant", "Valuta", "Niet vervallen", "1–30", "31–60", "61–90", "> 90", "Totaal"], rows: r.rows.map((x) => [x.name, x.currency, ...x.buckets.map((b) => b.toFixed(2)), x.total.toFixed(2)]), notes: ["Openstaande en vervallen posten per klant en valuta (inclusief niet-toegewezen betalingen als negatieve bedragen)."] };
    }
    case "collection": {
      const allocs = await tx.allocation.findMany({ where: { paymentId: { not: null }, openItem: { administrationId: home.administrationId, side: "RECEIVABLE", sourceType: "INVOICE" }, payment: { date: { gte: from, lt: to } } }, select: { amount: true, openItem: { select: { date: true, dueDate: true } }, payment: { select: { date: true } } } });
      const rows = months.map((m) => {
        const a = allocs.filter((x) => ym(x.payment!.date) === m);
        const days = a.length ? Math.round(a.reduce((s, x) => s + (x.payment!.date.getTime() - x.openItem.date.getTime()) / 86_400_000, 0) / a.length) : "—";
        const late = a.filter((x) => x.payment!.date > x.openItem.dueDate).length;
        return [m, a.length, days, late];
      });
      return { columns: ["Maand", "Betaalde facturen (toewijzingen)", "Gem. dagen tot betaling", "Te laat betaald"], rows };
    }
    case "expenses": {
      const lines = await tx.invoiceLine.findMany({ where: { invoice: { administrationId: home.administrationId, type: "PURCHASE", status: { in: ["POSTED", "PARTIALLY_PAID", "PAID"] }, invoiceDate: { gte: from, lt: to } } }, select: { netAmount: true, accountId: true, invoice: { select: { kind: true, exchangeRate: true, invoiceDate: true } } } });
      const accounts = await tx.account.findMany({ where: { id: { in: [...new Set(lines.map((l) => l.accountId))] } } });
      return { columns: ["Rekening", ...months.map((m) => m.slice(5)), "Totaal"], rows: accounts.sort((a, b) => a.number.localeCompare(b.number)).map((a) => {
        const vals = months.map((m) => lines.filter((l) => l.accountId === a.id && ym(l.invoice.invoiceDate) === m).reduce((s, l) => s.plus(D(l.netAmount.toString()).times(l.invoice.exchangeRate.toString()).times(sign(l.invoice.kind))), D(0)));
        return [`${a.number} ${a.name}`, ...vals.map((v) => v.toFixed(2)), vals.reduce((s, v) => s.plus(v), D(0)).toFixed(2)];
      }), notes: ["Geboekte inkoopfacturen excl. BTW per kostenrekening (kasuitgaven zonder factuur staan in de winst-en-verliesrekening)."] };
    }
    case "cashflow": {
      const payments = await tx.payment.findMany({ where: { administrationId: home.administrationId, date: { gte: from, lt: to } }, select: { direction: true, date: true, amount: true, exchangeRate: true } });
      let running = D(0);
      return { columns: ["Maand", "Ontvangsten", "Uitgaven", "Netto", "Cumulatief"], rows: months.map((m) => {
        const p = payments.filter((x) => ym(x.date) === m);
        const inn = p.filter((x) => x.direction === "IN").reduce((s, x) => s.plus(D(x.amount.toString()).times(x.exchangeRate.toString())), D(0));
        const out = p.filter((x) => x.direction === "OUT").reduce((s, x) => s.plus(D(x.amount.toString()).times(x.exchangeRate.toString())), D(0));
        running = running.plus(inn).minus(out);
        return [m, inn.toFixed(2), out.toFixed(2), inn.minus(out).toFixed(2), running.toFixed(2)];
      }), notes: ["Geregistreerde betalingen via bank en kas (exclusief kasboekingen zonder relatie)."] };
    }
    case "profitLoss": {
      const fy = await tx.fiscalYear.findFirst({ where: { administrationId: home.administrationId, code: String(year) } });
      if (!fy) return { columns: ["Post", "Bedrag"], rows: [], notes: ["Geen boekjaar voor dit jaar."] };
      const r = await buildReports(tx, { administrationId: home.administrationId, fiscalYearId: fy.id, fromPeriod: 1, toPeriod: 12 });
      return { columns: ["Post", "Bedrag"], rows: [...r.pl.lines.map((l) => [l.code, l.amount] as (string | number)[]), ["Netto-omzet", r.pl.totals.revenue], ["Bedrijfsresultaat", r.pl.totals.operatingResult], ["Netto resultaat", r.pl.totals.netResult]], notes: ["Alleen geboekte journaalposten (boekhoudkundige weergave)."] };
    }
    case "churn": {
      const subs = await tx.araSubscription.findMany();
      return { columns: ["Maand", "Actief begin maand", "Opgezegd", "Churn %"], rows: months.map((m) => {
        const startOfMonth = new Date(`${m}-01T00:00:00Z`);
        const active = subs.filter((s) => s.startDate < startOfMonth && s.status !== "TRIAL" && (!s.cancelledAt || s.cancelledAt >= startOfMonth)).length;
        const cancelled = subs.filter((s) => s.cancelledAt && ym(s.cancelledAt) === m).length;
        return [m, active, cancelled, active ? ((cancelled / active) * 100).toFixed(1) : "—"];
      }) };
    }
    case "trialConversion": {
      const subs = await tx.araSubscription.findMany({ where: { trialEndsAt: { not: null }, startDate: { gte: from, lt: to } }, include: { events: true } });
      const converted = subs.filter((s) => s.events.some((e) => e.type === "ACTIVATED")).length;
      const cancelled = subs.filter((s) => s.status === "CANCELLED" && !s.events.some((e) => e.type === "ACTIVATED")).length;
      const running = subs.filter((s) => s.status === "TRIAL").length;
      return { columns: ["Proefabonnementen", "Omgezet naar betaald", "Beëindigd zonder omzetting", "Nog in proef", "Conversie %"], rows: [[subs.length, converted, cancelled, running, subs.length - running ? ((converted / (subs.length - running)) * 100).toFixed(1) : "—"]] };
    }
  }
}

export { lastMonths };
