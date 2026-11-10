import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { saveEntryAction } from "@/actions/ledger";
import { editorData, EDITOR_CURRENCIES } from "@/modules/ledger/queries";
import { Card, PageHeader } from "@/components/ui/misc";
import { EntryEditor } from "@/components/finance/entry-editor";

export default async function NewEntryPage({ searchParams }: { searchParams: Promise<{ journal?: string }> }) {
  const t = await getTranslations();
  const ctx = await requireApp("ledger.create", { needCompany: true });
  if (!ctx.administration) redirect("/onboarding");
  const admin = ctx.administration;
  const { journal } = await searchParams;
  const data = await withTenant(ctx.access, (tx) => editorData(tx, admin.id));
  const preset = data.journals.find((j) => j.code === journal || j.id === journal) ?? data.journals.find((j) => j.code === "MEM") ?? data.journals[0];
  const today = new Date().toISOString().slice(0, 10);
  const opening = preset?.type === "OPENING" && ctx.fiscalYear ? ctx.fiscalYear.startDate.toISOString().slice(0, 10) : today;

  return (
    <>
      <PageHeader title={t(preset?.type === "OPENING" ? "ledger.newOpeningTitle" : "ledger.newEntryTitle")} description={`${admin.code} · ${admin.name} · ${admin.baseCurrency}`} />
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
          initial={{ journalId: preset?.id ?? "", entryDate: opening, documentDate: "", description: "", reference: "", lines: [] }}
        />
      </Card>
    </>
  );
}
