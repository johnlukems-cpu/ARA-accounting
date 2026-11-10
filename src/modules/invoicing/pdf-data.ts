import "server-only";
import Decimal from "decimal.js";
import { getTranslations } from "next-intl/server";
import type { Tx } from "@/core/db/client";
import { PDF_LABEL_KEYS, type InvoicePdfData, type PdfLabels } from "./pdf";

/** Collects everything the invoice PDF needs (inside a tenant transaction). */
export async function invoicePdfData(tx: Tx, invoiceId: string, locale: string): Promise<{ data: InvoicePdfData; companyId: string; type: string; posted: boolean } | null> {
  const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { lines: { orderBy: { lineNo: "asc" } }, party: true } });
  if (!inv) return null;
  const admin = await tx.administration.findUniqueOrThrow({ where: { id: inv.administrationId }, include: { company: true } });
  const credits = inv.creditsInvoiceId ? await tx.invoice.findUnique({ where: { id: inv.creditsInvoiceId }, select: { number: true } }) : null;
  const banks = await tx.financialAccount.findMany({ where: { administrationId: admin.id, kind: "BANK", status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  const t = await getTranslations({ locale });
  const fmtDate = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("-");

  const taxByRate = new Map<string, { base: Decimal; tax: Decimal }>();
  for (const l of inv.lines) {
    const k = l.taxRate.toString();
    const cur = taxByRate.get(k) ?? { base: new Decimal(0), tax: new Decimal(0) };
    taxByRate.set(k, { base: cur.base.plus(l.netAmount.toString()), tax: cur.tax.plus(l.taxAmount.toString()) });
  }
  const c = admin.company;
  const labels = Object.fromEntries(PDF_LABEL_KEYS.map((k) => [k, t(`invoicePdf.${k}` as never)])) as PdfLabels;
  return {
    companyId: admin.companyId,
    type: inv.type,
    posted: inv.number != null,
    data: {
      labels,
      locale,
      seller: { name: c.name, legalName: c.legalName, address: c.address, district: c.district ? t(`districts.${c.district}` as never) : null, kkf: c.kkfNumber, btw: c.btwNumber, email: c.email, phone: c.phone },
      buyer: { name: inv.party.name, address: inv.party.address, district: inv.party.district ? t(`districts.${inv.party.district}` as never) : null, btw: inv.party.btwNumber, kkf: inv.party.kkfNumber },
      invoice: {
        title: t(inv.kind === "CREDIT_NOTE" ? "invoicePdf.creditNoteTitle" : "invoicePdf.title"), number: inv.number ?? t("invoicePdf.draft"),
        date: fmtDate(inv.invoiceDate), dueDate: fmtDate(inv.dueDate), currency: inv.currency, rate: inv.exchangeRate.toString(), baseCurrency: admin.baseCurrency,
        reference: inv.description, notes: inv.notes, credits: credits?.number ?? null,
      },
      lines: inv.lines.map((l) => ({ description: l.description, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toFixed(2), discountPct: l.discountPct.toString(), net: l.netAmount.toFixed(2), taxRate: l.taxRate.toString() })),
      taxSummary: [...taxByRate.entries()].map(([rate, v]) => ({ rate, base: v.base.toFixed(2), tax: v.tax.toFixed(2) })),
      totals: { net: inv.netAmount.toFixed(2), tax: inv.taxAmount.toFixed(2), gross: inv.grossAmount.toFixed(2) },
      bankAccounts: banks.map((b) => ({ bank: b.bankCode ? t(`banks.${b.bankCode}` as never) : b.name, number: b.accountNumber ?? "", currency: b.currency })),
    },
  };
}
