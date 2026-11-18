import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { withTenant } from "@/core/tenancy/tenant";
import { requireAdmin, adminCan } from "@/modules/admin/guard";
import { setStageAction } from "@/actions/admin";
import { ActionForm, Select, SubmitButton } from "@/components/ui/form";
import { PageHeader, TextLink } from "@/components/ui/misc";

const STAGES = ["LEAD", "CONTACTED", "QUALIFIED", "PROPOSAL", "CUSTOMER", "INACTIVE"] as const;

/** CRM pipeline: Lead → Contacted → Qualified → Proposal → Customer → Inactive. */
export default async function CrmPipeline() {
  const t = await getTranslations();
  const a = await requireAdmin("crm.view");
  const customers = await withTenant(a.access, (tx) => tx.crmCustomer.findMany({ where: { status: "ACTIVE" }, orderBy: { updatedAt: "desc" }, take: 600 }));
  const edit = adminCan(a, "crm.edit");
  return (
    <>
      <PageHeader title={t("admin.crm.title")} description={t("admin.crm.intro")} actions={<TextLink href="/admin/customers?new=1">{t("admin.customer.new")}</TextLink>} />
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {STAGES.map((s) => {
          const list = customers.filter((c) => c.stage === s);
          return (
            <section key={s} aria-label={t(`admin.stages.${s}`)} className="rounded-xl border border-border bg-muted/40 p-3">
              <h2 className="mb-2 flex items-center justify-between text-sm font-semibold">{t(`admin.stages.${s}`)}<span className="rounded-full bg-surface px-2 text-xs text-muted-foreground">{list.length}</span></h2>
              <ul className="space-y-2">
                {list.slice(0, 40).map((c) => (
                  <li key={c.id} className="rounded-lg border border-border bg-surface p-2 text-sm">
                    <Link href={`/admin/customers/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                    <span className="block text-xs text-muted-foreground">{c.number}{c.category ? ` · ${c.category}` : ""}</span>
                    {edit && (
                      <ActionForm action={setStageAction} className="mt-1 flex gap-1 space-y-0">
                        <input type="hidden" name="id" value={c.id} />
                        <Select name="stage" defaultValue={c.stage} aria-label={t("admin.customer.stage")} className="h-7 text-xs">{STAGES.map((x) => <option key={x} value={x}>{t(`admin.stages.${x}`)}</option>)}</Select>
                        <SubmitButton variant="secondary" className="h-7 px-2 text-xs">{t("common.save")}</SubmitButton>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
