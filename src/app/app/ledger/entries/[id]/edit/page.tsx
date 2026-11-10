import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { saveEntryAction } from "@/actions/ledger";
import { editorData, EDITOR_CURRENCIES } from "@/modules/ledger/queries";
import { Card, PageHeader } from "@/components/ui/misc";
import { EntryEditor } from "@/components/finance/entry-editor";

export default async function EditEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations();
  const ctx = await requireApp();
  const result = await withTenant(ctx.access, async (tx) => {
    const entry = await tx.journalEntry.findUnique({ where: { id }, include: { lines: { orderBy: { lineNo: "asc" } } } });
    if (!entry) return null;
    const admin = await tx.administration.findUniqueOrThrow({ where: { id: entry.administrationId } });
    return { entry, admin, data: await editorData(tx, admin.id) };
  });
  if (!result || !can(ctx.access, "ledger.edit", result.admin.companyId)) notFound();
  const { entry, admin, data } = result;
  if (entry.status === "POSTED") redirect(`/app/ledger/entries/${entry.id}`);
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

  return (
    <>
      <PageHeader title={t("ledger.editEntryTitle")} description={entry.description} />
      <Card>
        <EntryEditor
          action={saveEntryAction}
          administrationId={admin.id}
          baseCurrency={admin.baseCurrency}
          journals={data.journals}
          accounts={data.accounts}
          dimensions={data.dimensions}
          currencies={[...new Set([admin.baseCurrency, ...EDITOR_CURRENCIES])]}
          canPost={can(ctx.access, "ledger.post", admin.companyId)}
          initial={{
            entryId: entry.id, journalId: entry.journalId, entryDate: iso(entry.entryDate), documentDate: iso(entry.documentDate),
            description: entry.description, reference: entry.reference ?? "",
            lines: entry.lines.filter((l) => !l.isRounding).map((l) => ({
              accountId: l.accountId, description: l.description ?? "",
              debit: l.debitBase.gt(0) ? l.txAmount.abs().toFixed(2) : "", credit: l.creditBase.gt(0) ? l.txAmount.abs().toFixed(2) : "",
              currency: l.txCurrency, rate: l.txCurrency === admin.baseCurrency ? "" : l.exchangeRate.toString(),
              costCenterId: l.costCenterId ?? "", projectId: l.projectId ?? "", departmentId: l.departmentId ?? "",
            })),
          }}
        />
      </Card>
    </>
  );
}
