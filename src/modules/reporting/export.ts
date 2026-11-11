import type { buildReports, ReportKind } from "./service";
import type { ReportPdf, ReportPdfRow } from "./pdf";
import type { LineRow } from "./statements";

type Report = Awaited<ReturnType<typeof buildReports>>;
type T = (key: string, values?: Record<string, string | number>) => string;

/** Report → sections of rows (labels translated, amounts formatted), shared by the PDF and CSV exports. */
export function reportTables(r: Report, kind: ReportKind, t: T, money: (v: string) => string): Pick<ReportPdf, "columns" | "sections"> {
  const hasPrior = !!r.priorYear;
  const columns = [t("reports.item"), r.fiscalYear.code, ...(hasPrior ? [r.priorYear!.code] : [])];
  const lineRows = (rows: LineRow[], prior: LineRow[] | undefined): ReportPdfRow[] =>
    rows.filter((l) => l.amount !== "0.00" || (prior?.find((p) => p.code === l.code)?.amount ?? "0.00") !== "0.00").flatMap((l) => [
      { label: t(`reports.lines.${l.code}`), values: [money(l.amount), ...(hasPrior ? [money(prior?.find((p) => p.code === l.code)?.amount ?? "0.00")] : [])], bold: true },
      ...l.accounts.map((a) => ({ label: `${a.number} ${a.name}`, values: [money(a.amount), ...(hasPrior ? [""] : [])], indent: true })),
    ]);
  const total = (label: string, cur: string, prior?: string): ReportPdfRow => ({ label, values: [money(cur), ...(hasPrior ? [money(prior ?? "0.00")] : [])], bold: true });
  const sections: ReportPdf["sections"] = [];
  const pl = () => sections.push({
    heading: t("reports.kinds.pl"),
    rows: [
      ...lineRows(r.pl.lines, r.priorPl?.lines),
      total(t("reports.totals.grossMargin"), r.pl.totals.grossMargin, r.priorPl?.totals.grossMargin),
      total(t("reports.totals.operatingResult"), r.pl.totals.operatingResult, r.priorPl?.totals.operatingResult),
      total(t("reports.totals.resultBeforeTax"), r.pl.totals.resultBeforeTax, r.priorPl?.totals.resultBeforeTax),
      total(t("reports.totals.netResult"), r.pl.totals.netResult, r.priorPl?.totals.netResult),
    ],
  });
  const bs = () => {
    sections.push({ heading: t("reports.assets"), rows: [...lineRows(r.bs.assets, r.priorBs?.assets), total(t("reports.totals.assets"), r.bs.totals.assets, r.priorBs?.totals.assets)] });
    sections.push({ heading: t("reports.liabilities"), rows: [
      ...lineRows(r.bs.liabilities, r.priorBs?.liabilities),
      { label: t("reports.resultYear"), values: [money(r.bs.result), ...(hasPrior ? [money(r.priorBs?.result ?? "0.00")] : [])], bold: true },
      total(t("reports.totals.liabilitiesAndEquity"), r.bs.totals.liabilitiesAndEquity, r.priorBs?.totals.liabilitiesAndEquity),
    ] });
  };
  const cf = () => {
    const c = r.cashflow;
    const row = (k: string, v: string, bold = false): ReportPdfRow => ({ label: t(`reports.cf.${k}`), values: [money(v), ...(hasPrior ? [""] : [])], bold });
    sections.push({ heading: t("reports.kinds.cashflow"), rows: [row("netResult", c.netResult), row("depreciation", c.depreciation), row("workingCapital", c.workingCapitalChange), row("operating", c.operating, true), row("investing", c.investing, true), row("financing", c.financing, true), row("total", c.total, true), row("openingCash", c.openingCash), row("closingCash", c.closingCash, true)] });
  };
  const eq = () => sections.push({ heading: t("reports.kinds.equity"), rows: [
    ...r.equity.rows.map((e) => ({ label: `${e.number} ${e.name}`, values: [money(e.closing), ...(hasPrior ? [""] : [])] })),
    { label: t("reports.resultYear"), values: [money(r.equity.result), ...(hasPrior ? [""] : [])] },
    total(t("reports.totals.equity"), r.equity.totals.closing),
  ] });
  const kpis = () => sections.push({ heading: t("reports.kinds.kpis"), rows: r.kpis.map((k) => ({ label: `${t(`industry.kpiNames.${k.code}`)} — ${k.formula}`, values: [k.value === null ? t("budgets.na") : `${k.value}${k.unit === "%" ? "%" : k.unit === "x" ? "x" : k.unit === "days" ? ` ${t("reports.days")}` : ""}`, ...(hasPrior ? [""] : [])] })) });
  if (kind === "pl") pl();
  if (kind === "balance") bs();
  if (kind === "cashflow") cf();
  if (kind === "equity") eq();
  if (kind === "kpis") kpis();
  if (kind === "pack") {
    pl();
    bs();
    cf();
    kpis();
  }
  return { columns, sections };
}

export function tablesToCsv(tables: Pick<ReportPdf, "columns" | "sections">): string[][] {
  return [tables.columns, ...tables.sections.flatMap((s) => [[s.heading], ...s.rows.map((r) => [`${r.indent ? "  " : ""}${r.label}`, ...r.values])])];
}
