import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import Decimal from "decimal.js";
import { formatAmount } from "@/lib/format";

/**
 * BTW invoice PDF (A4). Shows the fields a Surinamese BTW invoice is expected to carry
 * (docs/SURINAME_MARKET.md §8 — exact mandatory fields still PENDING_VERIFICATION).
 * Page-aware: line tables continue on following pages.
 */
export const PDF_LABEL_KEYS = [
  "kkf", "btwNumber", "number", "date", "dueDate", "currency", "reference", "credits", "billTo", "description", "quantity", "unitPrice",
  "discount", "btw", "net", "continued", "btwSummary", "base", "totalNet", "totalBtw", "totalGross", "rate", "payTo", "payReference", "footer",
] as const;
export type PdfLabels = Record<(typeof PDF_LABEL_KEYS)[number], string>;

export interface InvoicePdfData {
  labels: PdfLabels;
  locale: string;
  seller: { name: string; legalName?: string | null; address?: string | null; district?: string | null; kkf?: string | null; btw?: string | null; email?: string | null; phone?: string | null };
  buyer: { name: string; address?: string | null; district?: string | null; btw?: string | null; kkf?: string | null };
  invoice: { title: string; number: string; date: string; dueDate: string; currency: string; rate: string; baseCurrency: string; reference?: string | null; notes?: string | null; credits?: string | null };
  lines: { description: string; quantity: string; unitPrice: string; discountPct: string; net: string; taxRate: string }[];
  taxSummary: { rate: string; base: string; tax: string }[];
  totals: { net: string; tax: string; gross: string };
  bankAccounts: { bank: string; number: string; currency: string }[];
}

const A4 = { w: 595.28, h: 841.89 };
const M = 48;
const NAVY = rgb(0.04, 0.12, 0.27);
const GREY = rgb(0.36, 0.4, 0.47);

// WinAnsi (Helvetica) cannot encode every character; replace the few that may appear in Surinamese names.
const safe = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7E -ÿ€]/g, "?");

export async function renderInvoicePdf(d: InvoicePdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${d.invoice.title} ${d.invoice.number}`);
  pdf.setCreator("ARA Accounting");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const L = d.labels;
  const money = (v: string) => formatAmount(v, "", d.locale).trim();

  let page: PDFPage = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - M;
  const text = (s: string, x: number, yy: number, size = 9, f: PDFFont = font, color = rgb(0.06, 0.09, 0.19)) => page.drawText(safe(s), { x, y: yy, size, font: f, color });
  const right = (s: string, xr: number, yy: number, size = 9, f: PDFFont = font) => text(s, xr - f.widthOfTextAtSize(safe(s), size), yy, size, f);

  const header = () => {
    page.drawRectangle({ x: 0, y: A4.h - 6, width: A4.w, height: 6, color: rgb(0.06, 0.62, 0.42) });
  };
  header();

  // Seller block (left) and title (right)
  text(d.seller.name, M, y - 4, 14, bold, NAVY);
  let sy = y - 20;
  for (const l of [d.seller.legalName, d.seller.address, d.seller.district, d.seller.kkf && `${L.kkf}: ${d.seller.kkf}`, d.seller.btw && `${L.btwNumber}: ${d.seller.btw}`, d.seller.email, d.seller.phone].filter(Boolean) as string[]) {
    text(l, M, sy, 9, font, GREY);
    sy -= 12;
  }
  right(d.invoice.title.toUpperCase(), A4.w - M, y - 4, 16, bold);
  const meta: [string, string][] = [[L.number, d.invoice.number], [L.date, d.invoice.date], [L.dueDate, d.invoice.dueDate], [L.currency, d.invoice.currency]];
  if (d.invoice.reference) meta.push([L.reference, d.invoice.reference]);
  if (d.invoice.credits) meta.push([L.credits, d.invoice.credits]);
  let my = y - 24;
  for (const [k, v] of meta) {
    right(`${k}: ${v}`, A4.w - M, my, 9);
    my -= 12;
  }
  y = Math.min(sy, my) - 16;

  // Buyer
  text(L.billTo, M, y, 8, bold, GREY);
  y -= 13;
  text(d.buyer.name, M, y, 11, bold);
  y -= 13;
  for (const l of [d.buyer.address, d.buyer.district, d.buyer.kkf && `${L.kkf}: ${d.buyer.kkf}`, d.buyer.btw && `${L.btwNumber}: ${d.buyer.btw}`].filter(Boolean) as string[]) {
    text(l, M, y, 9, font, GREY);
    y -= 12;
  }
  y -= 14;

  // Lines table
  const cols = { desc: M, qty: 320, price: 380, disc: 427, btw: 455, net: A4.w - M };
  const tableHeader = () => {
    page.drawLine({ start: { x: M, y: y + 4 }, end: { x: A4.w - M, y: y + 4 }, thickness: 0.7, color: GREY });
    text(L.description, cols.desc, y - 8, 8, bold, GREY);
    right(L.quantity, cols.qty + 40, y - 8, 8, bold);
    right(L.unitPrice, cols.price + 40, y - 8, 8, bold);
    right(L.discount, cols.disc + 28, y - 8, 8, bold);
    right(L.btw, cols.btw + 30, y - 8, 8, bold);
    right(L.net, cols.net, y - 8, 8, bold);
    y -= 14;
    page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 0.4, color: GREY });
    y -= 12;
  };
  tableHeader();
  for (const l of d.lines) {
    const words = safe(l.description).split(/\s+/);
    const wrapped: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(next, 9) > cols.qty - cols.desc - 8 && cur) {
        wrapped.push(cur);
        cur = w;
      } else cur = next;
    }
    wrapped.push(cur);
    const need = wrapped.length * 11 + 4;
    if (y - need < M + 170) {
      page = pdf.addPage([A4.w, A4.h]);
      header();
      y = A4.h - M;
      text(`${d.invoice.title} ${d.invoice.number} (${L.continued})`, M, y, 9, bold, GREY);
      y -= 20;
      tableHeader();
    }
    wrapped.forEach((w, i) => text(w, cols.desc, y - i * 11, 9));
    right(new Decimal(l.quantity).toDecimalPlaces(4).toString().replace(".", d.locale.startsWith("nl") ? "," : "."), cols.qty + 40, y);
    right(money(l.unitPrice), cols.price + 40, y);
    right(new Decimal(l.discountPct).isZero() ? "" : `${new Decimal(l.discountPct).toString()}%`, cols.disc + 28, y);
    right(`${new Decimal(l.taxRate).toString()}%`, cols.btw + 30, y);
    right(money(l.net), cols.net, y);
    y -= need;
  }
  page.drawLine({ start: { x: M, y: y + 6 }, end: { x: A4.w - M, y: y + 6 }, thickness: 0.4, color: GREY });

  // BTW summary and totals
  y -= 8;
  const tx = 330;
  text(L.btwSummary, M, y, 8, bold, GREY);
  let ty = y - 13;
  for (const t of d.taxSummary) {
    text(`${new Decimal(t.rate).toString()}%: ${L.base} ${money(t.base)} — ${L.btw} ${money(t.tax)}`, M, ty, 9);
    ty -= 12;
  }
  const totals: [string, string, boolean][] = [[L.totalNet, d.invoice.currency + " " + money(d.totals.net), false], [L.totalBtw, d.invoice.currency + " " + money(d.totals.tax), false], [L.totalGross, d.invoice.currency + " " + money(d.totals.gross), true]];
  let gy = y;
  for (const [k, v, strong] of totals) {
    text(k, tx, gy, strong ? 11 : 9, strong ? bold : font);
    right(v, A4.w - M, gy, strong ? 11 : 9, strong ? bold : font);
    gy -= strong ? 16 : 13;
  }
  if (d.invoice.currency !== d.invoice.baseCurrency) {
    const r = new Decimal(d.invoice.rate);
    const conv = (v: string) => `${d.invoice.baseCurrency} ${money(new Decimal(v).times(r).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2))}`;
    text(`${L.rate}: 1 ${d.invoice.currency} = ${r.toString()} ${d.invoice.baseCurrency}`, tx, gy, 8, font, GREY);
    gy -= 11;
    text(`${L.btw} ${conv(d.totals.tax)} · ${L.totalGross} ${conv(d.totals.gross)}`, tx, gy, 8, font, GREY);
    gy -= 11;
  }
  y = Math.min(ty, gy) - 16;

  if (d.bankAccounts.length) {
    text(L.payTo, M, y, 8, bold, GREY);
    y -= 12;
    for (const b of d.bankAccounts) {
      text(`${b.bank} ${b.number} (${b.currency})`, M, y, 9);
      y -= 12;
    }
    text(`${L.payReference}: ${d.invoice.number}`, M, y, 9);
    y -= 16;
  }
  if (d.invoice.notes) {
    for (const line of safe(d.invoice.notes).split("\n").slice(0, 8)) {
      text(line, M, y, 9, font, GREY);
      y -= 11;
    }
  }
  for (const p of pdf.getPages()) {
    p.drawText(safe(L.footer), { x: M, y: 24, size: 7, font, color: GREY });
  }
  return pdf.save();
}
