import { getLocale, getTranslations } from "next-intl/server";
import type { Product } from "@prisma/client";
import { systemDb } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { requireAdmin, adminCan } from "@/modules/admin/guard";
import { saveProductAction } from "@/actions/admin";
import { formatAmount } from "@/lib/format";
import { ActionForm, Field, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui/misc";

/** Product and service catalogue. New products need no code changes; prices are entered by the owner. */
export default async function ProductsPage() {
  const t = await getTranslations();
  const locale = await getLocale();
  const a = await requireAdmin("catalog.view");
  const { products, taxCodes, accounts } = await withTenant(a.access, async (tx) => ({
    products: await tx.product.findMany({ orderBy: [{ status: "asc" }, { code: "asc" }] }),
    taxCodes: await tx.taxCode.findMany({ where: { administrationId: a.home.administrationId, status: "ACTIVE", direction: { in: ["SALES", "BOTH"] } }, orderBy: { code: "asc" } }),
    accounts: await tx.account.findMany({ where: { administrationId: a.home.administrationId, type: "DETAIL", status: "ACTIVE", category: { in: ["REVENUE", "FINANCIAL_INCOME"] } }, orderBy: { number: "asc" } }),
  }));
  const plans = await systemDb.plan.findMany({ where: { status: "ACTIVE" }, orderBy: { code: "asc" } });
  const form = (p?: Product) => (
    <ActionForm action={saveProductAction} resetOnSuccess={!p}>
      {p && <input type="hidden" name="id" value={p.id} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t("admin.product.code")} name="code"><Input name="code" defaultValue={p?.code} required /></Field>
        <Field label={t("admin.product.name")} name="name"><Input name="name" defaultValue={p?.name} required /></Field>
        <Field label={t("admin.product.nameEn")} name="nameEn"><Input name="nameEn" defaultValue={p?.nameEn ?? ""} /></Field>
        <Field label={t("admin.product.category")} name="category"><Select name="category" defaultValue={p?.category ?? "SOFTWARE"}>{["SOFTWARE", "SUBSCRIPTION", "IMPLEMENTATION", "ONBOARDING", "SUPPORT", "CONSULTANCY", "OTHER"].map((c) => <option key={c} value={c}>{t(`admin.productCategories.${c}`)}</option>)}</Select></Field>
        <Field label={t("admin.product.billingType")} name="billingType"><Select name="billingType" defaultValue={p?.billingType ?? "ONE_TIME"}><option value="ONE_TIME">{t("admin.billingTypes.ONE_TIME")}</option><option value="RECURRING">{t("admin.billingTypes.RECURRING")}</option></Select></Field>
        <Field label={t("admin.product.interval")} name="billingInterval" hint={t("admin.product.intervalHint")}><Select name="billingInterval" defaultValue={p?.billingInterval ?? ""}><option value="">—</option>{["MONTHLY", "QUARTERLY", "ANNUAL"].map((i) => <option key={i} value={i}>{t(`admin.intervals.${i}`)}</option>)}</Select></Field>
        <Field label={t("admin.product.price")} name="defaultPrice" hint={t("admin.product.priceHint")}><Input name="defaultPrice" inputMode="decimal" defaultValue={p?.defaultPrice?.toString() ?? ""} /></Field>
        <Field label={t("admin.product.currency")} name="currency"><Input name="currency" defaultValue={p?.currency ?? "SRD"} maxLength={3} /></Field>
        <Field label={t("admin.product.taxCode")} name="taxCodeId" hint={t("admin.product.taxHint")}><Select name="taxCodeId" defaultValue={p?.taxCodeId ?? ""}>{[<option key="" value="">—</option>, ...taxCodes.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)]}</Select></Field>
        <Field label={t("admin.product.revenueAccount")} name="revenueAccountId"><Select name="revenueAccountId" defaultValue={p?.revenueAccountId ?? ""}>{[<option key="" value="">—</option>, ...accounts.map((x) => <option key={x.id} value={x.id}>{x.number} {x.name}</option>)]}</Select></Field>
        <Field label={t("admin.product.plan")} name="planId" hint={t("admin.product.planHint")}><Select name="planId" defaultValue={p?.planId ?? ""}>{[<option key="" value="">—</option>, ...plans.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)]}</Select></Field>
        <Field label={t("common.status")} name="status"><Select name="status" defaultValue={p?.status ?? "ACTIVE"}><option value="ACTIVE">{t("plans.statusActive")}</option><option value="ARCHIVED">{t("admin.product.inactive")}</option></Select></Field>
        <Field label={t("admin.product.description")} name="description" className="sm:col-span-2 lg:col-span-3"><Textarea name="description" rows={2} defaultValue={p?.description ?? ""} /></Field>
      </div>
      <SubmitButton>{p ? t("common.save") : t("admin.product.add")}</SubmitButton>
    </ActionForm>
  );
  return (
    <>
      <PageHeader title={t("admin.nav.products")} description={t("admin.product.intro")} />
      <Card>
        <Table head={[t("admin.product.code"), t("admin.product.name"), t("admin.product.category"), t("admin.product.billing"), t("admin.product.price"), t("common.status"), ""]}>
          {products.map((p) => (
            <tr key={p.id}>
              <Td className="font-mono text-xs">{p.code}</Td><Td>{p.name}</Td><Td className="text-xs">{t(`admin.productCategories.${p.category}`)}</Td>
              <Td className="text-xs">{t(`admin.billingTypes.${p.billingType}`)}{p.billingInterval ? ` · ${t(`admin.intervals.${p.billingInterval}`)}` : ""}</Td>
              <Td className="amount text-right">{p.defaultPrice ? formatAmount(p.defaultPrice.toString(), p.currency, locale) : <span className="text-muted-foreground">{t("plans.priceOnRequest")}</span>}</Td>
              <Td><Badge tone={p.status === "ACTIVE" ? "success" : "neutral"}>{p.status === "ACTIVE" ? t("plans.statusActive") : t("admin.product.inactive")}</Badge></Td>
              <Td>{adminCan(a, "catalog.edit") && <details><summary className="cursor-pointer text-sm text-accent">{t("common.edit")}</summary><div className="mt-3 min-w-[34rem]">{form(p)}</div></details>}</Td>
            </tr>
          ))}
        </Table>
      </Card>
      {adminCan(a, "catalog.edit") && <Card title={t("admin.product.add")} className="mt-6">{form()}</Card>}
    </>
  );
}
