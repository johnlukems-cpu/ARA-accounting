import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { buttonClass } from "@/components/ui/button-class";
import { Badge, Card, EmptyState, PageHeader, Table, Td, TextLink } from "@/components/ui/misc";

export default async function RelationsPage({ searchParams }: { searchParams: Promise<{ q?: string; role?: string }> }) {
  const t = await getTranslations();
  const ctx = await requireApp(undefined, { needCompany: true });
  if (!ctx.administration) redirect("/onboarding");
  const admin = ctx.administration;
  if (!can(ctx.access, "sales.view", admin.companyId) && !can(ctx.access, "purchase.view", admin.companyId)) redirect("/app?denied=1");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const where: Prisma.PartyWhereInput = {
    administrationId: admin.id,
    ...(sp.role === "customers" ? { isCustomer: true } : sp.role === "suppliers" ? { isSupplier: true } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }, { kkfNumber: { contains: q } }, { btwNumber: { contains: q } }] } : {}),
  };
  const parties = await withTenant(ctx.access, (tx) => tx.party.findMany({ where, orderBy: { name: "asc" }, take: 200 }));
  const mayCreate = can(ctx.access, "sales.create", admin.companyId) || can(ctx.access, "purchase.create", admin.companyId);

  return (
    <>
      <PageHeader title={t("invoicing.relationsTitle")} description={`${admin.code} · ${admin.name}`}
        actions={mayCreate && <Link href="/app/relations/new" className={buttonClass("primary", "sm")}>{t("invoicing.addRelation")}</Link>} />
      <Card>
        <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_12rem_auto]" role="search">
          <input name="q" defaultValue={q} placeholder={t("invoicing.searchRelations")} aria-label={t("invoicing.searchRelations")} className="h-9 rounded-lg border border-border px-3 text-sm" />
          <select name="role" defaultValue={sp.role ?? ""} aria-label={t("invoicing.role")} className="h-9 rounded-lg border border-border px-2 text-sm">
            <option value="">{t("invoicing.allRelations")}</option>
            <option value="customers">{t("invoicing.customers")}</option>
            <option value="suppliers">{t("invoicing.suppliers")}</option>
          </select>
          <button className={buttonClass("secondary", "sm")}>{t("common.filter")}</button>
        </form>
        {parties.length === 0 ? <EmptyState title={t("invoicing.noParties")} /> : (
          <Table head={[t("administration.code"), t("company.name"), t("invoicing.role"), t("company.kkfNumber"), t("ledger.currency"), t("common.status")]}>
            {parties.map((p) => (
              <tr key={p.id}>
                <Td className="font-medium">{p.code}</Td>
                <Td><TextLink href={`/app/relations/${p.id}`}>{p.name}</TextLink></Td>
                <Td className="space-x-1">{p.isCustomer && <Badge tone="info">{t("invoicing.customer")}</Badge>}{p.isSupplier && <Badge>{t("invoicing.supplier")}</Badge>}</Td>
                <Td>{p.kkfNumber ?? "—"}</Td>
                <Td>{p.currency}</Td>
                <Td>{p.status === "ARCHIVED" && <Badge>{t("common.statuses.ARCHIVED")}</Badge>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
