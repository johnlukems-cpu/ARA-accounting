import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { formatEntryNumber } from "@/core/ledger/engine";
import { entryTransitionAction, reverseEntryAction } from "@/actions/ledger";
import { formatAmount, formatCell } from "@/lib/format";
import { ActionForm, Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/button-class";
import { Card, Dl, PageHeader, Table, Td, TextLink } from "@/components/ui/misc";
import { EntryStatusBadge } from "@/components/finance/entry-status";

function Transition({ id, intent, label, variant = "secondary" }: { id: string; intent: string; label: string; variant?: "primary" | "secondary" | "danger" }) {
  return (
    <ActionForm action={entryTransitionAction} className="space-y-0">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="intent" value={intent} />
      <SubmitButton variant={variant} className="h-9 px-3">{label}</SubmitButton>
    </ActionForm>
  );
}

export default async function EntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const ctx = await requireApp();

  const data = await withTenant(ctx.access, async (tx) => {
    const entry = await tx.journalEntry.findUnique({
      where: { id },
      include: {
        journal: true, fiscalYear: true, period: true, reverses: { select: { id: true, entryNumber: true } }, reversedBy: { select: { id: true, entryNumber: true } },
        lines: { orderBy: { lineNo: "asc" }, include: { account: { select: { number: true, name: true } } } },
      },
    });
    if (!entry) return null;
    const admin = await tx.administration.findUniqueOrThrow({ where: { id: entry.administrationId } });
    const history = await tx.auditLog.findMany({ where: { entity: "JournalEntry", entityId: entry.id }, orderBy: { seq: "asc" } });
    const userIds = [...new Set([entry.createdById, entry.approvedById, entry.postedById, ...history.map((h) => h.userId)].filter(Boolean))] as string[];
    const users = new Map((await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const dimIds = [...new Set(entry.lines.flatMap((l) => [l.costCenterId, l.projectId, l.departmentId]).filter(Boolean))] as string[];
    const dims = new Map((await tx.dimensionValue.findMany({ where: { id: { in: dimIds } } })).map((d) => [d.id, d.code]));
    return { entry, admin, history, users, dims };
  });
  if (!data || !can(ctx.access, "ledger.view", data.admin.companyId)) notFound();
  const { entry, admin, history, users, dims } = data;
  const companyId = admin.companyId;
  const number = formatEntryNumber(entry.journal.code, entry.fiscalYear.code, entry.entryNumber);
  const date = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeZone: "UTC" });
  const posted = entry.status === "POSTED";
  const mayEdit = !posted && can(ctx.access, "ledger.edit", companyId);
  const foreign = entry.lines.some((l) => l.txCurrency !== entry.currency);

  return (
    <>
      <PageHeader title={posted ? number : t("ledger.draftEntry")} description={entry.description} actions={<EntryStatusBadge status={entry.status} kind={entry.kind} reversed={!!entry.reversedByEntryId} />} />

      {!posted && (
        <div className="mb-6 flex flex-wrap items-start gap-2">
          {mayEdit && <Link href={`/app/ledger/entries/${entry.id}/edit`} className={buttonClass("secondary")}>{t("common.edit")}</Link>}
          {entry.status === "DRAFT" && entry.journal.requiresApproval && can(ctx.access, "ledger.create", companyId) && <Transition id={entry.id} intent="submit" label={t("ledger.submit")} />}
          {(entry.status === "SUBMITTED" || entry.status === "DRAFT") && entry.journal.requiresApproval && can(ctx.access, "ledger.approve", companyId) && <Transition id={entry.id} intent="approve" label={t("ledger.approve")} />}
          {can(ctx.access, "ledger.post", companyId) && (!entry.journal.requiresApproval || entry.status === "APPROVED") && <Transition id={entry.id} intent="post" label={t("ledger.post")} variant="primary" />}
          {mayEdit && entry.sourceType === "MANUAL" && <Transition id={entry.id} intent="delete" label={t("ledger.deleteDraft")} variant="danger" />}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card title={t("ledger.lines")}>
          <Table head={[t("ledger.account"), t("ledger.lineDescription"), ...(foreign ? [t("ledger.original")] : []), t("ledger.debit"), t("ledger.credit")]}>
            {entry.lines.map((l) => (
              <tr key={l.id}>
                <Td>
                  <TextLink href={`/app/ledger/general-ledger?account=${l.accountId}`}>{l.account.number}</TextLink> {l.account.name}
                  {[l.costCenterId, l.projectId, l.departmentId].filter(Boolean).length > 0 && (
                    <span className="block text-xs text-muted-foreground">{[l.costCenterId, l.projectId, l.departmentId].filter(Boolean).map((d) => dims.get(d!)).join(" · ")}</span>
                  )}
                </Td>
                <Td className="text-muted-foreground">{l.isRounding ? t("ledger.roundingLine") : l.description}</Td>
                {foreign && <Td className="amount whitespace-nowrap text-xs text-muted-foreground">{l.txCurrency !== entry.currency ? `${formatAmount(l.txAmount.abs(), l.txCurrency, locale)} × ${l.exchangeRate.toString()}` : ""}</Td>}
                <Td className="amount whitespace-nowrap text-right">{formatCell(l.debitBase, locale)}</Td>
                <Td className="amount whitespace-nowrap text-right">{formatCell(l.creditBase, locale)}</Td>
              </tr>
            ))}
            <tr className="font-semibold">
              <Td>{t("ledger.total")} ({entry.currency})</Td><Td />{foreign && <Td />}
              <Td className="amount text-right">{formatCell(entry.totalDebitBase, locale)}</Td>
              <Td className="amount text-right">{formatCell(entry.totalCreditBase, locale)}</Td>
            </tr>
          </Table>
        </Card>

        <div className="space-y-6">
          <Card title={t("ledger.details")}>
            <Dl items={[
              [t("ledger.journal"), `${entry.journal.code} · ${entry.journal.name}`],
              [t("ledger.entryDate"), date(entry.entryDate)],
              [t("periods.period"), `${entry.fiscalYear.code} / ${entry.period.number}`],
              [t("ledger.documentDate"), entry.documentDate ? date(entry.documentDate) : null],
              [t("ledger.reference"), entry.reference],
              [t("ledger.source"), t(`ledger.sources.${entry.sourceType}`)],
              [t("ledger.createdBy"), users.get(entry.createdById)],
              [t("ledger.approvedBy"), entry.approvedById ? users.get(entry.approvedById) : null],
              [t("ledger.postedBy"), entry.postedById ? `${users.get(entry.postedById)} · ${format.dateTime(entry.postedAt!, { dateStyle: "short", timeStyle: "short" })}` : null],
              ...(entry.reason ? [[t("ledger.reason"), entry.reason] as [string, string]] : []),
            ]} />
            {entry.reverses && <p className="mt-3 text-sm">{t("ledger.reversesEntry")} <TextLink href={`/app/ledger/entries/${entry.reverses.id}`}>{formatEntryNumber(entry.journal.code, entry.fiscalYear.code, entry.reverses.entryNumber)}</TextLink></p>}
            {entry.reversedBy && <p className="mt-3 text-sm">{t("ledger.reversedByEntry")} <TextLink href={`/app/ledger/entries/${entry.reversedBy.id}`}>{t("ledger.viewReversal")}</TextLink></p>}
          </Card>

          {posted && !entry.reversedByEntryId && entry.kind !== "REVERSAL" && can(ctx.access, "ledger.reverse", companyId) && (
            <Card title={t("ledger.reverseTitle")} description={t("ledger.reverseIntro")}>
              <ActionForm action={reverseEntryAction}>
                <input type="hidden" name="entryId" value={entry.id} />
                <Field label={t("ledger.reverseDate")} name="entryDate"><Input name="entryDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></Field>
                <Field label={t("ledger.reason")} name="reason"><Input name="reason" required /></Field>
                <Field label={t("ledger.reverseMode")} name="mode">
                  <Select name="mode" defaultValue="reverse">
                    <option value="reverse">{t("ledger.modeReverse")}</option>
                    {(entry.kind === "NORMAL" || entry.kind === "CORRECTION") && <option value="correct">{t("ledger.modeCorrect")}</option>}
                  </Select>
                </Field>
                <SubmitButton variant="danger">{t("ledger.reverse")}</SubmitButton>
              </ActionForm>
            </Card>
          )}

          <Card title={t("ledger.history")}>
            <ol className="space-y-2 text-sm">
              {history.map((h) => (
                <li key={h.seq.toString()}>
                  <span className="font-medium">{t(`ledger.historyActions.${h.action.replace("entry.", "")}`)}</span>
                  <span className="block text-xs text-muted-foreground">{h.userId ? users.get(h.userId) : t("audit.system")} · {format.dateTime(h.createdAt, { dateStyle: "short", timeStyle: "short" })}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
