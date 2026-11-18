import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { withTenant } from "@/core/tenancy/tenant";
import { requireAdmin, adminCan } from "@/modules/admin/guard";
import { listCustomers } from "@/modules/admin/crm";
import { createCustomerAction } from "@/actions/admin";
import { CustomerFields, staffOptions } from "@/components/admin/customer-form";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Badge, Card, EmptyState, PageHeader, Table, Td } from "@/components/ui/misc";

const STAGES = ["LEAD", "CONTACTED", "QUALIFIED", "PROPOSAL", "CUSTOMER", "INACTIVE"] as const;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; stage?: string; manager?: string; category?: string; new?: string }> }) {
  const t = await getTranslations();
  const a = await requireAdmin("crm.view");
  const sp = await searchParams;
  const stage = STAGES.find((s) => s === sp.stage);
  const list = await withTenant(a.access, (tx) => listCustomers(tx, { q: sp.q?.trim() || undefined, stage, managerId: sp.manager || undefined, category: sp.category || undefined }));
  const staff = await staffOptions(a.home.organizationId);
  return (
    <>
      <PageHeader title={t("admin.nav.customers")} description={t("admin.customer.intro")} />
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={sp.q} placeholder={t("admin.customer.search")} aria-label={t("admin.customer.search")} className="h-9 min-w-56 flex-1 rounded-lg border border-border bg-surface px-3 text-sm" />
        <select name="stage" defaultValue={sp.stage ?? ""} aria-label={t("admin.customer.stage")} className="h-9 rounded-lg border border-border bg-surface px-2 text-sm"><option value="">{t("admin.customer.allStages")}</option>{STAGES.map((s) => <option key={s} value={s}>{t(`admin.stages.${s}`)}</option>)}</select>
        <select name="manager" defaultValue={sp.manager ?? ""} aria-label={t("admin.customer.manager")} className="h-9 rounded-lg border border-border bg-surface px-2 text-sm"><option value="">{t("admin.customer.allManagers")}</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <input name="category" defaultValue={sp.category} placeholder={t("admin.customer.category")} aria-label={t("admin.customer.category")} className="h-9 w-40 rounded-lg border border-border bg-surface px-3 text-sm" />
        <button className="h-9 rounded-lg border border-border px-3 text-sm">{t("common.filter")}</button>
      </form>
      <Card>
        {list.length === 0 ? <EmptyState title={t("admin.customer.none")} /> : (
          <Table head={[t("admin.customer.number"), t("admin.customer.name"), t("admin.customer.stage"), t("admin.customer.contact"), t("admin.customer.email"), t("admin.customer.manager")]}>
            {list.map((c) => (
              <tr key={c.id}>
                <Td className="font-mono text-xs">{c.number}</Td>
                <Td><Link href={`/admin/customers/${c.id}`} className="font-medium hover:underline">{c.name}</Link>{c.category && <span className="block text-xs text-muted-foreground">{c.category}</span>}</Td>
                <Td><Badge tone={c.stage === "CUSTOMER" ? "success" : c.stage === "INACTIVE" ? "neutral" : "info"}>{t(`admin.stages.${c.stage}`)}</Badge></Td>
                <Td className="text-sm">{c.contacts[0]?.name ?? "—"}</Td>
                <Td className="text-sm">{c.email ?? "—"}</Td>
                <Td className="text-sm">{staff.find((s) => s.id === c.accountManagerId)?.name ?? "—"}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {adminCan(a, "crm.create") && (
        <Card title={t("admin.customer.new")} className="mt-6">
          <details open={!!sp.new}>
            <summary className="cursor-pointer text-sm font-medium text-accent">{t("admin.customer.newOpen")}</summary>
            <div className="mt-3">
              <ActionForm action={createCustomerAction}>
                <CustomerFields staff={staff} />
                <SubmitButton>{t("admin.customer.create")}</SubmitButton>
              </ActionForm>
            </div>
          </details>
        </Card>
      )}
    </>
  );
}
