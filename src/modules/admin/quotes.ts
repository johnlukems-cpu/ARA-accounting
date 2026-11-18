import { z } from "zod";
import Decimal from "decimal.js";
import { translatorFor } from "@/lib/translator";
import type { Prisma } from "@prisma/client";
import { systemDb, type Tx } from "@/core/db/client";
import { audit } from "@/core/audit/audit";
import { UserError } from "@/core/errors";
import { calculateLines, type TaxCodeInfo } from "@/modules/invoicing/domain";
import { saveInvoiceInTx } from "@/modules/invoicing/service";
import { assertCan } from "@/core/auth/access";
import { PDF_LABEL_KEYS, renderInvoicePdf, type PdfLabels } from "@/modules/invoicing/pdf";
import { getEmailSender } from "@/integrations/email";
import { asDate, inHome, iso, nextNumber, today } from "./common";
import { convertCustomerInTx, logActivity } from "./crm";
import type { AdminContext } from "./home";

const dec = z.string().trim().transform((v) => v.replace(",", ".")).pipe(z.string().regex(/^-?\d+(\.\d+)?$/, "validation.amount"));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date");

export const quoteLineSchema = z.object({
  productId: z.string().optional().transform((v) => v || null),
  description: z.string().trim().min(1, "validation.required").max(300),
  quantity: dec.refine((v) => Number(v) > 0, "validation.positive"),
  unitPrice: dec.refine((v) => Number(v) >= 0, "validation.amount"),
  discountPct: dec.optional().or(z.literal("").transform(() => undefined)).refine((v) => v === undefined || (Number(v) >= 0 && Number(v) <= 100), "validation.invalid"),
  taxCodeId: z.string().optional().transform((v) => v || null),
});

export const quoteSchema = z.object({
  customerId: z.string().min(1, "validation.required"),
  contactId: z.string().optional().transform((v) => v || null),
  quoteDate: date,
  validUntil: date,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "validation.currency"),
  paymentTermDays: z.coerce.number().int().min(0).max(365).default(14),
  introduction: z.string().trim().max(2000).optional().transform((v) => v || null),
  terms: z.string().trim().max(4000).optional().transform((v) => v || null),
  notes: z.string().trim().max(2000).optional().transform((v) => v || null),
  lines: z.array(quoteLineSchema).min(1, "invoicing.minOneLine").max(200),
});

async function taxCodes(tx: Tx, administrationId: string) {
  const codes = await tx.taxCode.findMany({ where: { administrationId, status: "ACTIVE" } });
  return new Map<string, TaxCodeInfo>(codes.map((c) => [c.id, { id: c.id, rate: c.rate.toString(), deductiblePct: c.deductiblePct.toString(), outputAccountId: c.outputAccountId, inputAccountId: c.inputAccountId }]));
}

/** Same line arithmetic as sales invoices (rounded per line), so a converted invoice has identical totals. */
async function calculate(tx: Tx, ctx: AdminContext, lines: z.infer<typeof quoteLineSchema>[]) {
  const codes = await taxCodes(tx, ctx.home.administrationId);
  for (const l of lines) if (l.taxCodeId && !codes.has(l.taxCodeId)) throw new UserError("invoicing.invalidTaxCode");
  const calc = calculateLines(lines.map((l) => ({ ...l, accountId: "-", discountPct: l.discountPct })), codes);
  const gross = lines.reduce((s, l) => s.plus(new Decimal(l.quantity).times(l.unitPrice)), new Decimal(0)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return { ...calc, discount: gross.minus(calc.net).toFixed(2) };
}

async function load(tx: Tx, id: string) {
  const q = await tx.quotation.findUnique({ where: { id }, include: { lines: { orderBy: { lineNo: "asc" } }, customer: true } });
  if (!q) throw new UserError("errors.notFound");
  return q;
}

/** Expired = validity passed while waiting for the customer. Applied whenever quotations are read or acted on. */
export async function expireQuotes(tx: Tx) {
  await tx.quotation.updateMany({ where: { status: { in: ["SENT", "VIEWED"] }, validUntil: { lt: asDate(today()) } }, data: { status: "EXPIRED" } });
}

export async function saveQuote(ctx: AdminContext, raw: z.input<typeof quoteSchema>, id?: string) {
  const input = quoteSchema.parse(raw);
  if (input.validUntil < input.quoteDate) throw new UserError("admin.validBeforeDate");
  return inHome(ctx, id ? "quotes.edit" : "quotes.create", async (tx) => {
    const customer = await tx.crmCustomer.findUnique({ where: { id: input.customerId } });
    if (!customer || customer.status !== "ACTIVE") throw new UserError("errors.notFound");
    if (input.contactId && !(await tx.crmContact.findFirst({ where: { id: input.contactId, customerId: customer.id } }))) throw new UserError("errors.notFound");
    for (const l of input.lines) if (l.productId && !(await tx.product.findFirst({ where: { id: l.productId, status: "ACTIVE" } }))) throw new UserError("errors.notFound");
    const calc = await calculate(tx, ctx, input.lines);
    const head = { customerId: customer.id, contactId: input.contactId, quoteDate: asDate(input.quoteDate), validUntil: asDate(input.validUntil), currency: input.currency, paymentTermDays: input.paymentTermDays, introduction: input.introduction, terms: input.terms, notes: input.notes, netAmount: calc.net, discountAmount: calc.discount, taxAmount: calc.tax, grossAmount: calc.gross };
    let quote;
    if (id) {
      const existing = await tx.quotation.findUnique({ where: { id } });
      if (!existing) throw new UserError("errors.notFound");
      if (existing.status !== "DRAFT") throw new UserError("admin.quoteNotDraft");
      await tx.quotationLine.deleteMany({ where: { quotationId: id } });
      quote = await tx.quotation.update({ where: { id }, data: head });
    } else {
      const number = await nextNumber(tx, ctx, "OFF", Number(input.quoteDate.slice(0, 4)));
      quote = await tx.quotation.create({ data: { ...head, organizationId: ctx.home.organizationId, number, createdById: ctx.access.userId } });
      await logActivity(tx, ctx, customer.id, "QUOTATION", `Offerte ${number} aangemaakt`, { entity: "Quotation", entityId: quote.id });
    }
    await tx.quotationLine.createMany({
      data: calc.lines.map((l, i) => ({ organizationId: ctx.home.organizationId, quotationId: quote.id, lineNo: l.lineNo, productId: input.lines[i]!.productId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct || "0", taxCodeId: l.taxCodeId ?? null, taxRate: l.taxRate, netAmount: l.netAmount, taxAmount: l.taxAmount })),
    });
    await audit(tx, { organizationId: ctx.home.organizationId, userId: ctx.access.userId, action: id ? "quote.updated" : "quote.created", entity: "Quotation", entityId: quote.id, details: { number: quote.number, gross: calc.gross, currency: input.currency } });
    return quote;
  });
}

/** Snapshot the current version, then reopen it as a draft with the next revision number. */
export async function reviseQuote(ctx: AdminContext, id: string, reason: string) {
  if (!reason?.trim()) throw new UserError("errors.reasonRequired");
  return inHome(ctx, "quotes.edit", async (tx) => {
    const q = await load(tx, id);
    if (q.status === "DRAFT" || q.status === "CONVERTED") throw new UserError("ledger.wrongStatus");
    await tx.quotationRevision.create({ data: { organizationId: q.organizationId, quotationId: q.id, revision: q.revision, snapshot: JSON.parse(JSON.stringify(q)) as Prisma.InputJsonValue, reason: reason.trim(), createdById: ctx.access.userId } });
    const updated = await tx.quotation.update({ where: { id }, data: { revision: q.revision + 1, status: "DRAFT", sentAt: null, sentTo: null, viewedAt: null, decidedAt: null, decidedBy: null, decisionNote: null } });
    await audit(tx, { organizationId: q.organizationId, userId: ctx.access.userId, action: "quote.revised", entity: "Quotation", entityId: id, details: { number: q.number, fromRevision: q.revision, reason } });
    return updated;
  });
}

async function pdfLabels(locale: string): Promise<PdfLabels> {
  const t = await translatorFor(locale);
  const labels = Object.fromEntries(PDF_LABEL_KEYS.map((k) => [k, t(`invoicePdf.${k}` as never)])) as PdfLabels;
  return { ...labels, dueDate: t("quotes.validUntil"), payTo: t("quotes.pdfPayTo"), payReference: t("quotes.pdfReference"), totalGross: t("quotes.pdfTotal"), footer: t("quotes.pdfFooter") };
}

/** PDF of a quotation (same layout engine as invoices). Seller data comes from ARA's own company record. */
export async function quotePdf(tx: Tx, ctx: { home: { companyId: string; administrationId: string } }, id: string, locale = "nl") {
  const q = await load(tx, id);
  const t = await translatorFor(locale);
  const company = await tx.company.findUniqueOrThrow({ where: { id: ctx.home.companyId } });
  const bank = await tx.financialAccount.findMany({ where: { kind: "BANK", status: "ACTIVE", administrationId: ctx.home.administrationId } });
  const summary = new Map<string, { base: Decimal; tax: Decimal }>();
  for (const l of q.lines) {
    const s = summary.get(l.taxRate.toString()) ?? { base: new Decimal(0), tax: new Decimal(0) };
    summary.set(l.taxRate.toString(), { base: s.base.plus(l.netAmount.toString()), tax: s.tax.plus(l.taxAmount.toString()) });
  }
  return renderInvoicePdf({
    labels: await pdfLabels(locale), locale,
    seller: { name: company.name, legalName: company.legalName, address: company.address, district: company.district, kkf: company.kkfNumber, btw: company.btwNumber, email: company.email, phone: company.phone },
    buyer: { name: q.customer.name, address: q.customer.address, district: q.customer.district, btw: q.customer.taxNumber, kkf: q.customer.kkfNumber },
    invoice: { title: t("quotes.pdfTitle"), number: `${q.number}${q.revision > 1 ? ` (rev. ${q.revision})` : ""}`, date: iso(q.quoteDate), dueDate: iso(q.validUntil), currency: q.currency, rate: "1", baseCurrency: q.currency, reference: null, notes: [q.introduction, q.terms, q.notes].filter(Boolean).join("\n\n") || null, credits: null },
    lines: q.lines.map((l) => ({ description: l.description, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), discountPct: l.discountPct.toString(), net: l.netAmount.toString(), taxRate: l.taxRate.toString() })),
    taxSummary: [...summary.entries()].map(([rate, v]) => ({ rate, base: v.base.toFixed(2), tax: v.tax.toFixed(2) })),
    totals: { net: q.netAmount.toString(), tax: q.taxAmount.toString(), gross: q.grossAmount.toString() },
    bankAccounts: bank.map((b) => ({ bank: b.bankCode ?? b.name, number: b.accountNumber ?? "", currency: b.currency })),
  });
}

/**
 * Sends a quotation: e-mails the PDF when SMTP is configured. Without e-mail, `manual: true` records that it was
 * handed over another way (the PDF is downloaded by the user) — never pretending an e-mail went out.
 */
export async function sendQuote(ctx: AdminContext, id: string, opts: { to?: string; manual?: boolean; locale?: string }) {
  const sender = getEmailSender();
  if (!sender && !opts.manual) throw new UserError("admin.noEmail");
  const { q, pdf, to } = await inHome(ctx, "quotes.edit", async (tx) => {
    const q = await load(tx, id);
    if (q.status !== "DRAFT" && q.status !== "SENT") throw new UserError("ledger.wrongStatus");
    if (q.validUntil < asDate(today())) throw new UserError("admin.quoteExpired");
    const contact = q.contactId ? await tx.crmContact.findUnique({ where: { id: q.contactId } }) : null;
    const to = (opts.to || contact?.email || q.customer.email || "").trim();
    if (!opts.manual && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new UserError("validation.email");
    return { q, pdf: opts.manual ? null : await quotePdf(tx, ctx, id, opts.locale), to };
  });
  if (sender && !opts.manual) {
    const t = await translatorFor(opts.locale ?? "nl");
    await sender.send({ to, subject: t("quotes.mailSubject", { number: q.number }), text: t("quotes.mailBody", { number: q.number, customer: q.customer.name, validUntil: iso(q.validUntil) }), attachments: [{ filename: `${q.number}.pdf`, content: pdf!, contentType: "application/pdf" }] });
  }
  return inHome(ctx, "quotes.edit", async (tx) => {
    const updated = await tx.quotation.update({ where: { id }, data: { status: "SENT", sentAt: new Date(), sentTo: opts.manual ? null : to } });
    await logActivity(tx, ctx, q.customerId, "QUOTATION", opts.manual ? `Offerte ${q.number} handmatig overhandigd` : `Offerte ${q.number} gemaild naar ${to}`, { entity: "Quotation", entityId: id });
    await audit(tx, { organizationId: q.organizationId, userId: ctx.access.userId, action: "quote.sent", entity: "Quotation", entityId: id, details: { number: q.number, to: opts.manual ? null : to, manual: !!opts.manual } });
    if (q.customer.stage !== "CUSTOMER" && q.customer.stage !== "PROPOSAL") await tx.crmCustomer.update({ where: { id: q.customerId }, data: { stage: "PROPOSAL" } });
    return updated;
  });
}

/** Records the customer's decision (by staff on the customer's instruction). */
export async function decideQuote(ctx: AdminContext, id: string, decision: "ACCEPTED" | "REJECTED", by: string, note?: string) {
  if (!by?.trim()) throw new UserError("admin.decidedByRequired");
  return inHome(ctx, "quotes.edit", async (tx) => {
    await expireQuotes(tx);
    const q = await load(tx, id);
    if (q.status !== "SENT" && q.status !== "VIEWED") throw new UserError(q.status === "EXPIRED" ? "admin.quoteExpired" : "ledger.wrongStatus");
    const updated = await tx.quotation.update({ where: { id }, data: { status: decision, decidedAt: new Date(), decidedBy: by.trim(), decisionNote: note?.trim() || null } });
    await logActivity(tx, ctx, q.customerId, "QUOTATION", `Offerte ${q.number} ${decision === "ACCEPTED" ? "geaccepteerd" : "afgewezen"} door ${by.trim()}`, { entity: "Quotation", entityId: id, body: note || null });
    await audit(tx, { organizationId: q.organizationId, userId: ctx.access.userId, action: decision === "ACCEPTED" ? "quote.accepted" : "quote.rejected", entity: "Quotation", entityId: id, details: { number: q.number, by, note: note ?? null } });
    return updated;
  });
}

/** Fallback revenue account for quotation lines without a product: 8090 Overige opbrengsten. */
async function fallbackRevenue(tx: Tx, administrationId: string) {
  const a = await tx.account.findFirst({ where: { administrationId, number: "8090", type: "DETAIL", status: "ACTIVE" } });
  if (!a) throw new UserError("admin.noRevenueAccount");
  return a.id;
}

/**
 * Accepted quotation → DRAFT sales invoice in ARA's administration (same lines, prices, discounts and BTW codes).
 * The quotation is kept (status CONVERTED, linked to the invoice). The invoice then follows the normal approval and
 * posting flow; nothing is posted automatically.
 */
export async function convertToInvoice(ctx: AdminContext, id: string) {
  assertCan(ctx.access, "sales.create", ctx.home.companyId);
  return inHome(ctx, "quotes.approve", async (tx) => {
    const q = await load(tx, id);
    if (q.status !== "ACCEPTED") throw new UserError("ledger.wrongStatus");
    // An accepted quotation makes the prospect a customer (same record; the debtor is created now if needed).
    const customer = q.customer.partyId ? q.customer : await convertCustomerInTx(tx, ctx, q.customerId);
    const fallback = await fallbackRevenue(tx, ctx.home.administrationId);
    const products = await tx.product.findMany({ where: { id: { in: q.lines.map((l) => l.productId).filter((x): x is string => !!x) } } });
    const invoiceDate = today();
    const invoice = await saveInvoiceInTx(tx, ctx.access, {
      administrationId: ctx.home.administrationId, type: "SALES", kind: "INVOICE", partyId: customer.partyId!, invoiceDate,
      dueDate: iso(new Date(asDate(invoiceDate).getTime() + q.paymentTermDays * 86_400_000)), currency: q.currency, description: `Offerte ${q.number}`,
      lines: q.lines.map((l) => ({ description: l.description, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), discountPct: l.discountPct.isZero() ? undefined : l.discountPct.toString(), accountId: products.find((p) => p.id === l.productId)?.revenueAccountId ?? fallback, taxCodeId: l.taxCodeId ?? undefined })),
    });
    await tx.quotation.update({ where: { id }, data: { status: "CONVERTED", invoiceId: invoice.id } });
    await logActivity(tx, ctx, q.customerId, "INVOICE", `Conceptfactuur aangemaakt uit offerte ${q.number}`, { entity: "Invoice", entityId: invoice.id });
    await audit(tx, { organizationId: q.organizationId, userId: ctx.access.userId, action: "quote.converted", entity: "Quotation", entityId: id, details: { number: q.number, invoiceId: invoice.id } });
    return invoice;
  });
}

/** Customer portal: list and decide on the customer's own quotations (server-side, explicit ownership check). */
export async function portalQuotes(customerId: string) {
  return systemDb.quotation.findMany({ where: { customerId, status: { not: "DRAFT" } }, orderBy: { quoteDate: "desc" }, include: { lines: true } });
}
