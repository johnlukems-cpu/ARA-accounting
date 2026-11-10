import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { formatEntryNumber } from "@/core/ledger/engine";
import { formatAmount } from "@/lib/format";
import { buttonClass } from "@/components/ui/button-class";
import { Card, EmptyState, PageHeader, Table, Td } from "@/components/ui/misc";
import { EntryStatusBadge } from "@/components/finance/entry-status";

const PAGE = 50;
const STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "POSTED"] as const;

export default async function EntriesPage({ searchParams }: { searchParams: Promise<{ status?: string; journal?: string; period?: string; q?: string; page?: string }> }) {
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const ctx = await requireApp("ledger.view", { needCompany: true });
  if (!ctx.administration || !ctx.fiscalYear) redirect("/onboarding");
  const admin = ctx.administration;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  const where: Prisma.JournalEntryWhereInput = {
    administrationId: admin.id,
    fiscalYearId: ctx.fiscalYear.id,
    ...(STATUSES.includes(sp.status as never) ? { status: sp.status as (typeof STATUSES)[number] } : {}),
    ...(sp.journal ? { journalId: sp.journal } : {}),
    ...(sp.period && /^\d+$/.test(sp.period) ? { period: { number: Number(sp.period) } } : {}),
    ...(sp.q ? { OR: [{ description: { contains: sp.q.slice(0, 100), mode: "insensitive" } }, { reference: { contains: sp.q.slice(0, 100), mode: "insensitive" } }] } : {}),
  };
  const { entries, total, journals } = await withTenant(ctx.access, async (tx) => ({
    entries: await tx.journalEntry.findMany({
      where, include: { journal: { select: { code: true } }, period: { select: { number: true } } },
      orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }], skip: (page - 1) * PAGE, take: PAGE,
    }),
    total: await tx.journalEntry.count({ where }),
    journals: await tx.journal.findMany({ where: { administrationId: admin.id }, orderBy: { code: "asc" } }),
  }));
  const qs = (patch: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v !== undefined && v !== "") as [string, string][]);
    return `?${p.toString()}`;
  };

  return (
    <>
      <PageHeader
        title={t("ledger.entriesTitle")}
        description={`${admin.code} · ${t("shell.fiscalYear")} ${ctx.fiscalYear.code}`}
        actions={can(ctx.access, "ledger.create", admin.companyId) && (
          <div className="flex gap-2">
            <Link href="/app/ledger/entries/new?journal=OPN" className={buttonClass("secondary", "sm")}>{t("ledger.newOpening")}</Link>
            <Link href="/app/ledger/entries/new" className={buttonClass("primary", "sm")}>{t("ledger.newEntry")}</Link>
          </div>
        )}
      />
      <Card>
        <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_10rem_10rem_8rem_auto]" role="search">
          <input name="q" defaultValue={sp.q} placeholder={t("ledger.searchEntries")} aria-label={t("ledger.searchEntries")} className="h-9 rounded-lg border border-border px-3 text-sm" />
          <select name="status" defaultValue={sp.status ?? ""} aria-label={t("common.status")} className="h-9 rounded-lg border border-border px-2 text-sm">
            <option value="">{t("ledger.allStatuses")}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{t(`ledger.status.${s}`)}</option>)}
          </select>
          <select name="journal" defaultValue={sp.journal ?? ""} aria-label={t("ledger.journal")} className="h-9 rounded-lg border border-border px-2 text-sm">
            <option value="">{t("ledger.allJournals")}</option>
            {journals.map((j) => <option key={j.id} value={j.id}>{j.code} · {j.name}</option>)}
          </select>
          <select name="period" defaultValue={sp.period ?? ""} aria-label={t("periods.period")} className="h-9 rounded-lg border border-border px-2 text-sm">
            <option value="">{t("ledger.allPeriods")}</option>
            {Array.from({ length: 14 }, (_, n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <button className={buttonClass("secondary", "sm")}>{t("common.filter")}</button>
        </form>
        {entries.length === 0 ? (
          <EmptyState title={t("ledger.noEntries")} />
        ) : (
          <Table head={[t("ledger.number"), t("ledger.entryDate"), t("periods.period"), t("ledger.description"), t("ledger.amount"), t("common.status")]}>
            {entries.map((e) => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap"><Link className="font-medium text-accent hover:underline" href={`/app/ledger/entries/${e.id}`}>{e.entryNumber ? formatEntryNumber(e.journal.code, ctx.fiscalYear!.code, e.entryNumber) : `${e.journal.code} · ${t("ledger.status.DRAFT").toLowerCase()}`}</Link></Td>
                <Td className="whitespace-nowrap">{format.dateTime(e.entryDate, { dateStyle: "medium", timeZone: "UTC" })}</Td>
                <Td>{e.period.number}</Td>
                <Td className="max-w-80 truncate">{e.description}</Td>
                <Td className="amount whitespace-nowrap text-right">{formatAmount(e.totalDebitBase, e.currency, locale)}</Td>
                <Td><EntryStatusBadge status={e.status} kind={e.kind} reversed={!!e.reversedByEntryId} /></Td>
              </tr>
            ))}
          </Table>
        )}
        {total > PAGE && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("common.pageOf", { page, pages: Math.ceil(total / PAGE) })}</span>
            <div className="flex gap-2">
              {page > 1 && <Link className={buttonClass("secondary", "sm")} href={qs({ page: page - 1 })}>{t("common.previous")}</Link>}
              {page * PAGE < total && <Link className={buttonClass("secondary", "sm")} href={qs({ page: page + 1 })}>{t("common.next")}</Link>}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
