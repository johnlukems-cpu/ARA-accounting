/**
 * CSV export with protection against spreadsheet formula injection: cells starting with = + - @ tab or CR
 * are prefixed with an apostrophe (numbers stay numeric). Semicolon-separated for Dutch Excel locales.
 */
const NUMERIC = /^-?\d+(\.\d+)?$/;

export function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  if (!NUMERIC.test(s) && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: unknown[][]): string {
  return "﻿" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n") + "\r\n";
}

export function csvResponse(filename: string, rows: unknown[][]): Response {
  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"`,
      "Cache-Control": "no-store",
    },
  });
}
