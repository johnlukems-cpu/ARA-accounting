import { describe, expect, it } from "vitest";
import { systemDb } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { trialBalance, generalLedger } from "@/modules/ledger/reports";
import { buildReports } from "@/modules/reporting/service";
import { runScan } from "@/modules/quality/service";
import { createAdministration, createCompany } from "@/modules/organization/service";
import { companyInput, newOrganization, refresh } from "../integration/helpers";

/**
 * Phase 12 load test: ≥ 1 000 000 posted journal lines in ONE administration, then time the heavy read paths.
 * Volume is inserted with set-based SQL as DRAFT entries and then posted in bulk, so every database guard
 * (account/administration check, period check, deferred balance check) still runs on every row.
 * Run: npm run test:load   (LOAD_LINES overrides the volume, default 1 000 000)
 */
const LINES = Number(process.env.LOAD_LINES ?? 1_000_000);
const LINES_PER_ENTRY = 4;
const ENTRIES = Math.ceil(LINES / LINES_PER_ENTRY);
const BATCH = 25_000; // entries per transaction
const RUN = `ld${Date.now().toString(36)}`; // unique id prefix per run (tests never truncate)

const timings: Record<string, number> = {};
async function timed<T>(name: string, fn: () => Promise<T>) {
  const t = performance.now();
  const r = await fn();
  timings[name] = Math.round(performance.now() - t);
  return r;
}

describe("Phase 12: ledger volume", () => {
  it(`posts ${LINES.toLocaleString("nl-NL")} lines in one administration and keeps reports within budget`, async () => {
    const o = await newOrganization();
    const company = await createCompany(o.access, companyInput("Volume NV"));
    const access = await refresh(o.access);
    const year = 2026;
    const { administration } = await createAdministration(access, { companyId: company.id, code: "VOL", name: "Volume", baseCurrency: "SRD", startYear: year, startMonth: 1 });
    const adminId = administration.id;
    const fy = await systemDb.fiscalYear.findFirstOrThrow({ where: { administrationId: adminId } });
    const periods = await systemDb.accountingPeriod.findMany({ where: { fiscalYearId: fy.id, number: { gte: 1 } }, orderBy: { number: "asc" } });
    const journal = await systemDb.journal.findFirstOrThrow({ where: { administrationId: adminId, type: "GENERAL" } });
    const accounts = await systemDb.account.findMany({ where: { administrationId: adminId, type: "DETAIL", status: "ACTIVE" }, orderBy: { number: "asc" }, take: 40 });
    expect(accounts.length).toBeGreaterThanOrEqual(8);

    await timed("insert", async () => {
      for (let from = 1; from <= ENTRIES; from += BATCH) {
        const to = Math.min(ENTRIES, from + BATCH - 1);
        await systemDb.$transaction(async (tx) => {
          // Entries: spread over 12 periods; amounts are whole cents so totals are exact.
          await tx.$executeRawUnsafe(`
            INSERT INTO "JournalEntry" (id, "organizationId", "administrationId", "journalId", "fiscalYearId", "periodId", "entryNumber",
              "entryDate", description, currency, status, kind, "sourceType", "totalDebitBase", "totalCreditBase", "createdById", "updatedAt")
            SELECT '${RUN}-' || g, $1, $2, $3, $4, (($5::text[])[1 + (g % 12)]), NULL,
              make_date(${year}, 1 + (g % 12), 1 + (g % 28)), 'Volume ' || g, 'SRD', 'DRAFT', 'NORMAL', 'MANUAL',
              ((g % 9000) + 100)::numeric / 100 * 2, ((g % 9000) + 100)::numeric / 100 * 2, $6, now()
            FROM generate_series($7::int, $8::int) g`,
            o.organizationId, adminId, journal.id, fy.id, periods.map((p) => p.id), o.userId, from, to);
          // Four lines per entry: two debits, two credits on rotating accounts.
          await tx.$executeRawUnsafe(`
            INSERT INTO "JournalLine" (id, "organizationId", "administrationId", "entryId", "lineNo", "accountId",
              "debitBase", "creditBase", "txCurrency", "txAmount", "exchangeRate", "isRounding")
            SELECT '${RUN}-' || g || '-' || n, $1, $2, '${RUN}-' || g, n, (($3::text[])[1 + ((g * 7 + n) % array_length($3::text[], 1))]),
              CASE WHEN n <= 2 THEN ((g % 9000) + 100)::numeric / 100 ELSE 0 END,
              CASE WHEN n > 2 THEN ((g % 9000) + 100)::numeric / 100 ELSE 0 END,
              'SRD', CASE WHEN n <= 2 THEN 1 ELSE -1 END * ((g % 9000) + 100)::numeric / 100, 1, false
            FROM generate_series($4::int, $5::int) g CROSS JOIN generate_series(1, ${LINES_PER_ENTRY}) n`,
            o.organizationId, adminId, accounts.map((a) => a.id), from, to);
          await tx.$executeRawUnsafe(`ANALYZE "JournalEntry"`);
          await tx.$executeRawUnsafe(`UPDATE "JournalEntry" SET status = 'POSTED', "entryNumber" = split_part(id, '-', 2)::int, "postedAt" = now(), "postedById" = $1
            WHERE "administrationId" = $2 AND status = 'DRAFT'`, o.userId, adminId); // exactly this batch: earlier batches are posted
        }, { timeout: 600_000 });
      }
    });
    await systemDb.$executeRawUnsafe(`ANALYZE "JournalEntry"`);
    await systemDb.$executeRawUnsafe(`ANALYZE "JournalLine"`);

    const lineCount = await systemDb.journalLine.count({ where: { administrationId: adminId } });
    expect(lineCount).toBeGreaterThanOrEqual(LINES);

    const scope = { organizationId: o.organizationId, userId: o.userId };
    const tb = await timed("trialBalance", () => withTenant(scope, (tx) => trialBalance(tx, { administrationId: adminId, fiscalYearId: fy.id, fromPeriod: 1, toPeriod: 12 })));
    const sum = (k: "closingDebit" | "closingCredit") => tb.rows.reduce((s, r) => s + Number(r[k]), 0);
    expect(Math.abs(sum("closingDebit") - sum("closingCredit"))).toBeLessThan(0.005);
    await timed("generalLedger", () => withTenant(scope, (tx) => generalLedger(tx, { administrationId: adminId, fiscalYearId: fy.id, accountId: accounts[0]!.id, fromPeriod: 6, toPeriod: 6 })));
    await timed("reports", () => withTenant(scope, (tx) => buildReports(tx, { administrationId: adminId, fiscalYearId: fy.id, fromPeriod: 1, toPeriod: 12 })));
    await timed("qualityScan", () => withTenant(scope, (tx) => runScan(tx, { administrationId: adminId, today: new Date(`${year}-12-31T00:00:00Z`), trigger: "MANUAL", userId: o.userId })));

    process.stdout.write(`\nLOAD RESULT lines=${lineCount} entries=${ENTRIES} tbRows=${tb.rows.length} ${JSON.stringify(timings)}\n`);
    // Budgets for interactive pages (single administration, local PostgreSQL 16).
    // Measured on the Phase 12 run: trial balance 3.7 s, general ledger 1.5 s, reports 4.3 s, quality scan 3.9 s.
    expect(timings.trialBalance).toBeLessThan(6_000);
    expect(timings.generalLedger).toBeLessThan(3_000);
    expect(timings.reports).toBeLessThan(8_000);
    expect(timings.qualityScan).toBeLessThan(10_000);
  });
});
