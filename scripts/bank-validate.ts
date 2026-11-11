/**
 * Offline check of a REAL bank statement export against an import profile (nothing is stored or uploaded):
 *   npm run bank:validate -- <profile.json> <statement.csv> [lineCount totalIn totalOut]
 * profile.json holds an ImportProfile (see docs/BANK_IMPORT_VALIDATION.md). With the three figures from the bank's own
 * statement for the same period, the totals are compared too. Prints only counts, dates and totals — never line text.
 */
import { readFileSync } from "node:fs";
import { importProfileSchema } from "../src/modules/banking/service";
import { compareWithStatement, summariseSample } from "../src/modules/banking/formats";
import { ImportError } from "../src/modules/banking/csv-import";

const [profilePath, filePath, count, totalIn, totalOut] = process.argv.slice(2);
if (!profilePath || !filePath) {
  console.error("Usage: npm run bank:validate -- <profile.json> <statement.csv> [lineCount totalIn totalOut]");
  process.exit(2);
}
const profile = importProfileSchema.parse(JSON.parse(readFileSync(profilePath, "utf8")));
const raw = readFileSync(filePath);
const text = raw.toString("utf8").replace(/^﻿/, "");
if (text.includes("�")) console.warn("! The file is not valid UTF-8 (probably Windows-1252). Re-save it as UTF-8 or report the encoding; the importer expects UTF-8.");
try {
  const s = summariseSample(text, profile);
  console.log(`✓ parsed ${s.lineCount} lines, ${s.dateFrom} … ${s.dateTo}`);
  console.log(`  money in  ${s.totalIn}\n  money out ${s.totalOut}\n  with counterparty ${s.withCounterparty}, with reference ${s.withReference}\n  sha256 ${s.sha256}`);
  if (count && totalIn && totalOut) {
    const m = compareWithStatement(s, { lineCount: Number(count), totalIn: totalIn.replace(",", "."), totalOut: totalOut.replace(",", ".") });
    console.log(m.length ? `✗ differs from the bank statement: ${m.join(", ")}` : "✓ matches the bank statement (line count and totals)");
    process.exit(m.length ? 1 : 0);
  }
  console.log("! Totals not compared: pass lineCount totalIn totalOut from the bank's statement to complete the validation.");
} catch (e) {
  if (e instanceof ImportError) {
    console.error(`✗ ${e.key} ${JSON.stringify(e.values)}`);
    process.exit(1);
  }
  throw e;
}
