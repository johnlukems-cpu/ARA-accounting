import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/** Generic A4 report PDF: sections of rows with right-aligned amount columns; page breaks; fingerprint footer (R1). */
export type ReportPdfRow = { label: string; values: string[]; bold?: boolean; indent?: boolean };
export type ReportPdf = { title: string; subtitle: string[]; columns: string[]; sections: { heading: string; rows: ReportPdfRow[] }[]; footer: string };

const A4 = { w: 595.28, h: 841.89 };
const M = 44;
const NAVY = rgb(0.04, 0.12, 0.27);
const GREY = rgb(0.36, 0.4, 0.47);
// WinAnsi (Helvetica): map typographic characters and narrow spaces used by number formatting.
const safe = (s: string) => s.replace(/[  ]/g, " ").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—−]/g, "-").replace(/[^\x20-\x7E¡-ÿ€]/g, "?");

export async function renderReportPdf(d: ReportPdf): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(d.title);
  pdf.setCreator("ARA Accounting");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const colW = 95;
  const colRight = (i: number) => A4.w - M - (d.columns.length - 2 - i) * colW;
  let page: PDFPage;
  let y = 0;
  const text = (s: string, x: number, yy: number, size = 9, f: PDFFont = font, color = rgb(0.06, 0.09, 0.19)) => page.drawText(safe(s), { x, y: yy, size, font: f, color });
  const right = (s: string, xr: number, yy: number, size = 9, f: PDFFont = font) => text(s, xr - f.widthOfTextAtSize(safe(s), size), yy, size, f);
  const newPage = () => {
    page = pdf.addPage([A4.w, A4.h]);
    page.drawRectangle({ x: 0, y: A4.h - 6, width: A4.w, height: 6, color: rgb(0.06, 0.62, 0.42) });
    y = A4.h - M;
    text(d.title, M, y, 15, bold, NAVY);
    y -= 16;
    for (const s of d.subtitle) {
      text(s, M, y, 9, font, GREY);
      y -= 12;
    }
    y -= 8;
    text(d.columns[0] ?? "", M, y, 8, bold, GREY);
    d.columns.slice(1).forEach((c, i) => right(c, colRight(i), y, 8, bold));
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 0.6, color: GREY });
    y -= 12;
    text(d.footer, M, 24, 7, font, GREY);
  };
  newPage();
  for (const section of d.sections) {
    if (y < M + 60) newPage();
    y -= 4;
    text(section.heading, M, y, 10, bold, NAVY);
    y -= 14;
    for (const row of section.rows) {
      if (y < M + 20) newPage();
      const f = row.bold ? bold : font;
      text(row.label.slice(0, 70), M + (row.indent ? 12 : 0), y, row.indent ? 8 : 9, f);
      row.values.forEach((v, i) => right(v, colRight(i), y, row.indent ? 8 : 9, f));
      y -= row.indent ? 11 : 13;
    }
  }
  const pages = pdf.getPages();
  pages.forEach((p, i) => p.drawText(`${i + 1} / ${pages.length}`, { x: A4.w - M - 30, y: 24, size: 7, font, color: GREY }));
  return pdf.save();
}
