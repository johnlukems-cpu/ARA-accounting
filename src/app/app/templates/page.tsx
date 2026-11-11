import { getLocale, getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { parseContent } from "@/modules/industry/service";
import { createCustomTemplateAction, importTemplateAction } from "@/actions/industry";
import { ActionForm, Field, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { Badge, Card, PageHeader, Table, Td, TextLink } from "@/components/ui/misc";

export default async function TemplatesPage() {
  const t = await getTranslations();
  const locale = await getLocale();
  const ctx = await requireApp("industry.view");
  const rows = await withTenant(ctx.access, async (tx) => {
    const templates = await tx.industryTemplate.findMany({ include: { versions: { orderBy: { version: "desc" } } }, orderBy: [{ ownerOrganizationId: { sort: "desc", nulls: "first" } }, { name: "asc" }] });
    return templates.map((tpl) => {
      const published = tpl.versions.find((v) => v.status === "PUBLISHED");
      return { tpl, published, draft: tpl.versions.find((v) => v.status === "DRAFT"), accounts: published ? parseContent(published.content).accounts.length : 0 };
    });
  });
  const en = locale === "en";
  const platform = rows.filter((r) => !r.tpl.ownerOrganizationId);
  const own = rows.filter((r) => r.tpl.ownerOrganizationId);
  const bases = rows.filter((r) => r.published && r.tpl.status === "ACTIVE");
  const mayCreate = can(ctx.access, "industry.create");

  const table = (list: typeof rows) => (
    <Table head={[t("industry.template"), t("industry.code"), t("industry.version"), t("industry.extraAccounts"), t("common.status")]}>
      {list.map(({ tpl, published, draft, accounts }) => (
        <tr key={tpl.id}>
          <Td>
            <TextLink href={`/app/templates/${tpl.id}`}>{(en && tpl.nameEn) || tpl.name}</TextLink>
            <span className="block text-xs text-muted-foreground">{(en && tpl.descriptionEn) || tpl.description}</span>
          </Td>
          <Td className="font-mono text-xs">{tpl.code}</Td>
          <Td>{published ? `v${published.version}` : "—"}{draft && <span className="ml-1 text-xs text-muted-foreground">({t("industry.draftShort")})</span>}</Td>
          <Td className="text-right">{accounts}</Td>
          <Td>{tpl.status === "ARCHIVED" ? <Badge>{t("common.statuses.ARCHIVED")}</Badge> : <Badge tone="success">{t("common.statuses.ACTIVE")}</Badge>}</Td>
        </tr>
      ))}
    </Table>
  );

  return (
    <>
      <PageHeader title={t("industry.title")} description={t("industry.intro")} />
      <Card title={t("industry.platform")} description={t("industry.platformIntro")}>{table(platform)}</Card>
      <Card title={t("industry.own")} className="mt-6">
        {own.length ? table(own) : <p className="text-sm text-muted-foreground">{t("industry.noOwn")}</p>}
      </Card>
      {mayCreate && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card title={t("industry.createTitle")} description={t("industry.createIntro")}>
            <ActionForm action={createCustomTemplateAction}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("industry.basedOn")} name="basedOnTemplateId" className="sm:col-span-2">
                  <Select name="basedOnTemplateId" defaultValue={bases.find((b) => b.tpl.code === "GENERAL")?.tpl.id}>
                    {bases.map(({ tpl, published }) => <option key={tpl.id} value={tpl.id}>{(en && tpl.nameEn) || tpl.name} (v{published!.version})</option>)}
                  </Select>
                </Field>
                <Field label={t("industry.code")} name="code" hint={t("industry.codeHint")}><Input name="code" required maxLength={30} /></Field>
                <Field label={t("company.name")} name="name"><Input name="name" required /></Field>
                <Field label={t("industry.description")} name="description" className="sm:col-span-2"><Input name="description" /></Field>
              </div>
              <SubmitButton>{t("industry.create")}</SubmitButton>
            </ActionForm>
          </Card>
          <Card title={t("industry.importTitle")} description={t("industry.importIntro")}>
            <ActionForm action={importTemplateAction}>
              <Field label={t("industry.file")} name="file"><Input type="file" name="file" accept="application/json,.json" /></Field>
              <Field label={t("industry.orPaste")} name="json"><Textarea name="json" rows={4} className="font-mono text-xs" /></Field>
              <SubmitButton variant="secondary">{t("industry.import")}</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      )}
    </>
  );
}
