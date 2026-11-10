import { getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can, visibleCompanyIds } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { Card, EmptyState, PageHeader, TextLink } from "@/components/ui/misc";

/** Global search across the data the user may see. Later phases add relations, invoices and entries. */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const t = await getTranslations();
  const ctx = await requireApp();
  const q = ((await searchParams).q ?? "").trim().slice(0, 100);
  const companyIds = visibleCompanyIds(ctx.access);
  const contains = { contains: q, mode: "insensitive" as const };

  const results = q.length < 2 ? null : await withTenant(ctx.access, async (tx) => ({
    companies: await tx.company.findMany({ where: { id: { in: companyIds }, OR: [{ name: contains }, { kkfNumber: contains }, { legalName: contains }] }, take: 20 }),
    administrations: await tx.administration.findMany({ where: { companyId: { in: companyIds }, OR: [{ name: contains }, { code: contains }] }, include: { company: { select: { name: true } } }, take: 20 }),
    members: can(ctx.access, "organization.manageUsers")
      ? await tx.organizationMembership.findMany({ where: { user: { OR: [{ name: contains }, { email: contains }] } }, include: { user: { select: { name: true, email: true } } }, take: 20 })
      : [],
  }));

  const total = results ? results.companies.length + results.administrations.length + results.members.length : 0;
  return (
    <>
      <PageHeader title={t("search.title")} description={q ? t("search.resultsFor", { q }) : t("search.hint")} />
      {results && total === 0 && <EmptyState title={t("search.none")} />}
      {results && total > 0 && (
        <div className="grid gap-6 md:grid-cols-3">
          <Card title={t("nav.companies")}>
            <ul className="space-y-2 text-sm">{results.companies.map((c) => <li key={c.id}><TextLink href={`/app/companies/${c.id}`}>{c.name}</TextLink></li>)}</ul>
          </Card>
          <Card title={t("company.administrations")}>
            <ul className="space-y-2 text-sm">{results.administrations.map((a) => <li key={a.id}><TextLink href={`/app/administrations/${a.id}`}>{a.code} · {a.name}</TextLink><span className="block text-xs text-muted-foreground">{a.company.name}</span></li>)}</ul>
          </Card>
          <Card title={t("nav.users")}>
            <ul className="space-y-2 text-sm">{results.members.map((m) => <li key={m.id}>{m.user.name}<span className="block text-xs text-muted-foreground">{m.user.email}</span></li>)}</ul>
          </Card>
        </div>
      )}
    </>
  );
}
