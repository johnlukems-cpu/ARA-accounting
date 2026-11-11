import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { parseContent } from "@/modules/industry/service";
import { validateContent } from "@/modules/industry/content";
import { STANDARD_CHART } from "@/modules/ledger/standard-chart";
import {
  addTemplateAccountAction, newDraftAction, publishTemplateAction, removeTemplateAccountAction, saveTemplateJsonAction, templateStatusAction,
} from "@/actions/industry";
import { ActionForm, Checkbox, Field, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/button-class";
import { Badge, Card, PageHeader, Table, Td, TextLink } from "@/components/ui/misc";

const CATEGORIES = ["ASSET", "LIABILITY", "EQUITY", "TAX", "SUSPENSE", "REVENUE", "COST_OF_SALES", "OPERATING_EXPENSE", "FINANCIAL_INCOME", "FINANCIAL_EXPENSE"] as const;

export default async function TemplatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const ctx = await requireApp("industry.view");
  const tpl = await withTenant(ctx.access, (tx) => tx.industryTemplate.findUnique({ where: { id }, include: { versions: { orderBy: { version: "desc" } } } }));
  if (!tpl) notFound();
  const en = locale === "en";
  const own = tpl.ownerOrganizationId === ctx.access.organizationId;
  const draft = tpl.versions.find((v) => v.status === "DRAFT");
  const shown = tpl.versions.find((v) => String(v.version) === sp.v) ?? draft ?? tpl.versions[0];
  if (!shown) notFound();
  const content = parseContent(shown.content);
  const { issues } = validateContent(content);
  const editing = own && shown.status === "DRAFT" && can(ctx.access, "industry.edit");
  const headers = [...STANDARD_CHART.filter((a) => a.header), ...content.accounts.filter((a) => a.header)].sort((a, b) => a.number.localeCompare(b.number));
  const date = (d: Date) => format.dateTime(d, { dateStyle: "medium" });

  return (
    <>
      <PageHeader
        title={(en && tpl.nameEn) || tpl.name}
        description={(en && tpl.descriptionEn) || tpl.description || undefined}
        actions={<div className="flex gap-2">{own ? <Badge tone="info">{t("industry.ownBadge")}</Badge> : <Badge>{t("industry.platformBadge")}</Badge>}{tpl.status === "ARCHIVED" && <Badge>{t("common.statuses.ARCHIVED")}</Badge>}</div>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={t("industry.versions")} className="lg:col-span-1">
          <Table head={[t("industry.version"), t("common.status"), ""]}>
            {tpl.versions.map((v) => (
              <tr key={v.id}>
                <Td><TextLink href={`/app/templates/${tpl.id}?v=${v.version}`}>v{v.version}</TextLink>{v.id === shown.id && " ◂"}<span className="block text-xs text-muted-foreground">{v.publishedAt ? date(v.publishedAt) : ""} {v.changelog ?? ""}</span></Td>
                <Td><Badge tone={v.status === "PUBLISHED" ? "success" : "warning"}>{t(`industry.statuses.${v.status}`)}</Badge></Td>
                <Td><a className={buttonClass("ghost", "sm")} href={`/api/templates/versions/${v.id}/export`}>{t("industry.export")}</a></Td>
              </tr>
            ))}
          </Table>
          {own && !draft && can(ctx.access, "industry.edit") && (
            <ActionForm action={newDraftAction} className="mt-4"><input type="hidden" name="templateId" value={tpl.id} /><SubmitButton variant="secondary">{t("industry.newDraft")}</SubmitButton></ActionForm>
          )}
          {own && can(ctx.access, "industry.manageSettings") && (
            <ActionForm action={templateStatusAction} className="mt-2">
              <input type="hidden" name="templateId" value={tpl.id} />
              <input type="hidden" name="status" value={tpl.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE"} />
              <SubmitButton variant="ghost">{tpl.status === "ACTIVE" ? t("industry.archive") : t("industry.activate")}</SubmitButton>
            </ActionForm>
          )}
        </Card>

        <Card title={`${t("industry.contentOf")} v${shown.version}`} description={t("industry.contentIntro")} className="lg:col-span-2">
          {issues.length > 0 && (
            <ul className="mb-4 space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
              {issues.map((i, n) => <li key={n}>{t(i.key as never, i.values as never)}</li>)}
            </ul>
          )}
          <h3 className="mb-2 text-sm font-semibold">{t("industry.extraAccounts")} ({content.accounts.length})</h3>
          <Table head={[t("ledger.number"), t("company.name"), t("industry.category"), t("industry.parent"), ""]}>
            {content.accounts.map((a) => (
              <tr key={a.ref}>
                <Td className="font-mono">{a.number}</Td>
                <Td>{(en ? a.nameEn : a.name)}{a.header && <Badge>{t("industry.header")}</Badge>}{a.control === "FIXED_ASSET" && <span className="ml-1 text-xs text-muted-foreground">{t("industry.fixedAsset")}</span>}</Td>
                <Td>{t(`ledger.categories.${a.category}`)}</Td>
                <Td className="font-mono">{a.parent}</Td>
                <Td>{editing && (
                  <ActionForm action={removeTemplateAccountAction} className="space-y-0"><input type="hidden" name="versionId" value={shown.id} /><input type="hidden" name="ref" value={a.ref} /><SubmitButton variant="ghost">{t("common.remove")}</SubmitButton></ActionForm>
                )}</Td>
              </tr>
            ))}
          </Table>
          <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
            <div><h3 className="mb-1 font-semibold">{t("industry.journals")}</h3>{content.journals.length ? content.journals.map((j) => <div key={j.code}>{j.code} · {j.name}</div>) : <span className="text-muted-foreground">—</span>}</div>
            <div><h3 className="mb-1 font-semibold">{t("industry.assetCategories")}</h3>{content.assetCategories.length ? content.assetCategories.map((c) => <div key={c.code}>{c.code} · {c.name} ({c.asset}/{c.accumulated}, {c.lifeMonths} {t("assets.monthsShort")})</div>) : <span className="text-muted-foreground">—</span>}</div>
            <div><h3 className="mb-1 font-semibold">{t("industry.dimensions")}</h3>{content.dimensions.length ? content.dimensions.map((d) => <div key={`${d.type}${d.code}`}>{t(`ledger.dimensionTypes.${d.type}`)}: {d.code} · {d.name}</div>) : <span className="text-muted-foreground">—</span>}</div>
            <div><h3 className="mb-1 font-semibold">{t("industry.kpis")}</h3>{content.kpis.length ? content.kpis.map((k) => <div key={k}>{t(`industry.kpiNames.${k}` as never)}</div>) : <span className="text-muted-foreground">—</span>}<p className="mt-1 text-xs text-muted-foreground">{t("industry.kpisNote")}</p></div>
          </div>
        </Card>
      </div>

      {editing && (
        <>
          <Card title={t("industry.addAccount")} className="mt-6">
            <ActionForm action={addTemplateAccountAction} resetOnSuccess>
              <input type="hidden" name="versionId" value={shown.id} />
              <div className="grid gap-4 sm:grid-cols-4">
                <Field label={t("ledger.number")} name="number"><Input name="number" required pattern="\d{4}" maxLength={4} /></Field>
                <Field label={t("company.name")} name="name"><Input name="name" required /></Field>
                <Field label={t("industry.nameEn")} name="nameEn"><Input name="nameEn" /></Field>
                <Field label={t("industry.category")} name="category">
                  <Select name="category" defaultValue="REVENUE">{CATEGORIES.map((c) => <option key={c} value={c}>{t(`ledger.categories.${c}`)}</option>)}</Select>
                </Field>
                <Field label={t("industry.parent")} name="parent" className="sm:col-span-2">
                  <Select name="parent" defaultValue="8000">{headers.map((h) => <option key={h.number} value={h.number}>{h.number} · {h.name}</option>)}</Select>
                </Field>
                <Field label={t("industry.control")} name="control">
                  <Select name="control" defaultValue="NONE"><option value="NONE">—</option><option value="FIXED_ASSET">{t("industry.fixedAsset")}</option></Select>
                </Field>
                <div className="flex items-end pb-2"><Checkbox name="header" label={t("industry.header")} /></div>
              </div>
              <SubmitButton>{t("industry.addAccountButton")}</SubmitButton>
            </ActionForm>
          </Card>
          <Card title={t("industry.jsonTitle")} description={t("industry.jsonIntro")} className="mt-6">
            <ActionForm action={saveTemplateJsonAction}>
              <input type="hidden" name="versionId" value={shown.id} />
              <Textarea name="content" rows={14} className="font-mono text-xs" defaultValue={JSON.stringify(content, null, 2)} />
              <SubmitButton variant="secondary">{t("common.save")}</SubmitButton>
            </ActionForm>
          </Card>
          {can(ctx.access, "industry.manageSettings") && (
            <Card title={t("industry.publishTitle")} description={t("industry.publishIntro")} className="mt-6">
              <ActionForm action={publishTemplateAction}>
                <input type="hidden" name="versionId" value={shown.id} />
                <Field label={t("industry.changelog")} name="changelog"><Input name="changelog" /></Field>
                <SubmitButton>{t("industry.publish")}</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </>
      )}
    </>
  );
}
