import Decimal from "decimal.js";
import type { LineInput } from "@/core/ledger/domain";

/**
 * Pure invoice calculations (ACCOUNTING_RULES T3: tax per line, rounded per line, half away from zero).
 * Amounts are in the invoice currency; the ledger converts with the invoice rate.
 */

export interface InvoiceLineInput {
  description: string;
  quantity: string;
  unitPrice: string;
  discountPct?: string;
  accountId: string;
  taxCodeId?: string | null;
  costCenterId?: string | null;
  projectId?: string | null;
}

export interface TaxCodeInfo {
  id: string;
  rate: Decimal.Value;
  deductiblePct: Decimal.Value;
  outputAccountId: string | null;
  inputAccountId: string | null;
}

export interface CalculatedLine extends InvoiceLineInput {
  lineNo: number;
  netAmount: string;
  taxRate: string;
  taxAmount: string;
}

const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export function calculateLines(lines: InvoiceLineInput[], taxCodes: Map<string, TaxCodeInfo>) {
  let net = new Decimal(0);
  let tax = new Decimal(0);
  const out: CalculatedLine[] = lines.map((l, i) => {
    const qty = new Decimal(l.quantity);
    const price = new Decimal(l.unitPrice);
    const disc = new Decimal(l.discountPct || 0);
    if (disc.lt(0) || disc.gt(100)) throw new Error("discount");
    const lineNet = r2(qty.times(price).times(new Decimal(100).minus(disc)).dividedBy(100));
    const code = l.taxCodeId ? taxCodes.get(l.taxCodeId) : undefined;
    const rate = code ? new Decimal(code.rate) : new Decimal(0);
    const lineTax = r2(lineNet.times(rate).dividedBy(100));
    net = net.plus(lineNet);
    tax = tax.plus(lineTax);
    return { ...l, lineNo: i + 1, netAmount: lineNet.toFixed(2), taxRate: rate.toFixed(4), taxAmount: lineTax.toFixed(2) };
  });
  return { lines: out, net: net.toFixed(2), tax: tax.toFixed(2), gross: net.plus(tax).toFixed(2) };
}

/**
 * Journal lines for a posted invoice.
 * Sales invoice: Dr receivable (gross) / Cr revenue (net per line) / Cr output BTW (per code).
 * Purchase invoice: Dr expense (net + non-deductible BTW) / Dr input BTW (deductible) / Cr payable (gross).
 * Credit notes swap the sides.
 */
export function invoiceLedgerLines(args: {
  type: "SALES" | "PURCHASE";
  kind: "INVOICE" | "CREDIT_NOTE";
  currency: string;
  rate: string;
  controlAccountId: string;
  partyId: string;
  description: string;
  lines: CalculatedLine[];
  taxCodes: Map<string, TaxCodeInfo>;
}): LineInput[] {
  const { type, kind, currency, rate, controlAccountId, partyId, description, taxCodes } = args;
  const sales = type === "SALES";
  // For a sales invoice the "own" lines are credits; for a purchase invoice debits. Credit notes swap.
  const ownSideIsCredit = sales !== (kind === "CREDIT_NOTE");
  const own = (amount: Decimal) => (ownSideIsCredit ? { credit: amount.toFixed(2) } : { debit: amount.toFixed(2) });
  const counter = (amount: Decimal) => (ownSideIsCredit ? { debit: amount.toFixed(2) } : { credit: amount.toFixed(2) });
  const fx = { currency, rate };

  const out: LineInput[] = [];
  let gross = new Decimal(0);
  const taxByAccount = new Map<string, Decimal>();
  for (const l of args.lines) {
    let amount = new Decimal(l.netAmount);
    const taxAmt = new Decimal(l.taxAmount);
    gross = gross.plus(amount).plus(taxAmt);
    if (!taxAmt.isZero()) {
      const code = taxCodes.get(l.taxCodeId!)!;
      if (sales) {
        if (!code.outputAccountId) throw new Error("tax code without output account");
        taxByAccount.set(code.outputAccountId, (taxByAccount.get(code.outputAccountId) ?? new Decimal(0)).plus(taxAmt));
      } else {
        const deductible = r2(taxAmt.times(new Decimal(code.deductiblePct)).dividedBy(100));
        const nonDeductible = taxAmt.minus(deductible);
        amount = amount.plus(nonDeductible); // non-deductible BTW is part of the cost
        if (!deductible.isZero()) {
          if (!code.inputAccountId) throw new Error("tax code without input account");
          taxByAccount.set(code.inputAccountId, (taxByAccount.get(code.inputAccountId) ?? new Decimal(0)).plus(deductible));
        }
      }
    }
    if (amount.isZero()) continue;
    const signFlip = amount.lt(0);
    const abs = amount.abs();
    out.push({
      accountId: l.accountId, description: l.description, ...fx,
      ...(signFlip ? counter(abs) : own(abs)),
      costCenterId: l.costCenterId, projectId: l.projectId, partyId, taxCodeId: l.taxCodeId ?? null,
    });
  }
  for (const [accountId, amount] of taxByAccount) {
    if (amount.isZero()) continue;
    out.push({ accountId, description: "BTW", ...fx, ...(amount.lt(0) ? counter(amount.abs()) : own(amount)), partyId });
  }
  if (!gross.isZero()) {
    out.push({ accountId: controlAccountId, description, ...fx, ...(gross.lt(0) ? own(gross.abs()) : counter(gross)), partyId });
  }
  return out;
}

/** Due date = invoice date + payment term (days), as YYYY-MM-DD. */
export function dueDateFor(invoiceDate: string, termDays: number): string {
  const d = new Date(`${invoiceDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + termDays);
  return d.toISOString().slice(0, 10);
}

export const DEFAULT_AGING_BUCKETS = [0, 30, 60, 90];

/** Aging bucket index for days overdue: 0 = current (not yet due), 1 = 1–30, … last = > last boundary. */
export function agingBucket(daysOverdue: number, boundaries = DEFAULT_AGING_BUCKETS): number {
  if (daysOverdue <= 0) return 0;
  for (let i = 1; i < boundaries.length; i++) if (daysOverdue <= boundaries[i]!) return i;
  return boundaries.length;
}

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}
