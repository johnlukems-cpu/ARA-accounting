import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { Plan } from "@prisma/client";
import { requireApp } from "@/core/auth/context";
import { LIMIT_KEYS, OPTIONAL_MODULES, platformOverview, type Limits } from "@/modules/saas/service";
import { paymentInstructions } from "@/modules/readiness/service";
import { paymentInstructionsAction, savePlanAction, trialDaysAction } from "@/actions/platform";
import { formatAmount } from "@/lib/format";
import { ActionForm, Checkbox, Field, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui/misc";
import { PlatformTabs } from "@/components/platform/tabs";
import { PlanCards } from "@/components/platform/plan-cards";

/** Subscription configuration: plans (prices, limits, modules), trial length, payment instructions and a preview. */
export default async function PlansPage() {
  const t = await getTranslations();
  const locale = await getLocale();
  const ctx = await requireApp();
  if (!ctx.user.isPlatformAdmin) notFound();
  const { plans, trialDays } = await platformOverview(ctx.user.id);
  const instructions = await paymentInstructions();
  const money = (v: Plan["priceMonthlySrd"], c: string) => (v ? formatAmount(v.toString(), c, locale) : "—");

  const planForm = (p?: Plan) => {
    const limits = (p?.limits ?? {}) as Limits;
    const modules = p && Array.isArray(p.modules) ? (p.modules as string[]) : null;
    return (
      <ActionForm action={savePlanAction} resetOnSuccess={!p}>
        {p && <input type="hidden" name="id" value={p.id} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("plans.code")} name="code"><Input name="code" defaultValue={p?.code} required /></Field>
          <Field label={t("plans.name")} name="name"><Input name="name" defaultValue={p?.name} required /></Field>
          <Field label={t("plans.description")} name="description" className="sm:col-span-2"><Input name="description" defaultValue={p?.description ?? ""} /></Field>
          <Field label={t("plans.priceMonthlySrd")} name="priceMonthlySrd"><Input name="priceMonthlySrd" inputMode="decimal" defaultValue={p?.priceMonthlySrd?.toString() ?? ""} placeholder={t("plans.empty")} /></Field>
          <Field label={t("plans.priceMonthlyUsd")} name="priceMonthlyUsd"><Input name="priceMonthlyUsd" inputMode="decimal" defaultValue={p?.priceMonthlyUsd?.toString() ?? ""} placeholder={t("plans.empty")} /></Field>
          <Field label={t("plans.priceAnnualSrd")} name="priceAnnualSrd"><Input name="priceAnnualSrd" inputMode="decimal" defaultValue={p?.priceAnnualSrd?.toString() ?? ""} placeholder={t("plans.empty")} /></Field>
          <Field label={t("plans.priceAnnualUsd")} name="priceAnnualUsd"><Input name="priceAnnualUsd" inputMode="decimal" defaultValue={p?.priceAnnualUsd?.toString() ?? ""} placeholder={t("plans.empty")} /></Field>
          {LIMIT_KEYS.map((k) => <Field key={k} label={t(`saas.limits.${k}`)} name={k}><Input type="number" min={0} name={k} defaultValue={limits[k] ?? ""} placeholder={t("saas.unlimited")} /></Field>)}
          <Field label={t("plans.sortOrder")} name="sortOrder"><Input type="number" min={0} name="sortOrder" defaultValue={p?.sortOrder ?? 0} /></Field>
          <Field label={t("common.status")} name="status"><Select name="status" defaultValue={p?.status ?? "ACTIVE"}><option value="ACTIVE">{t("plans.statusActive")}</option><option value="ARCHIVED">{t("plans.statusArchived")}</option></Select></Field>
        </div>
        <fieldset className="mt-3">
          <legend className="text-sm font-medium">{t("plans.moduleAccess")}</legend>
          <p className="text-xs text-muted-foreground">{t("plans.moduleHint")}</p>
          <div className="mt-2"><Checkbox name="allModules" label={t("plans.allModules")} defaultChecked={modules === null} /></div>
          <div className="mt-1 grid gap-1 sm:grid-cols-2">
            {OPTIONAL_MODULES.map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm"><input type="checkbox" name="modules" value={m} defaultChecked={modules?.includes(m) ?? false} className="size-4" />{t(`plans.modules.${m}`)}</label>
            ))}
          </div>
        </fieldset>
        <SubmitButton>{p ? t("common.save") : t("plans.add")}</SubmitButton>
      </ActionForm>
    );
  };

  return (
    <>
      <PageHeader title={t("platform.title")} description={t("plans.intro")} />
      <PlatformTabs active="plans" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t("plans.trialTitle")} description={t("plans.trialIntro")}>
          <ActionForm action={trialDaysAction} className="flex flex-wrap items-end gap-2 space-y-0">
            <Field label={t("plans.trialDays")} name="trialDays"><Input type="number" min={1} max={365} name="trialDays" defaultValue={trialDays} required className="w-28" /></Field>
            <SubmitButton variant="secondary">{t("common.save")}</SubmitButton>
          </ActionForm>
        </Card>
        <Card title={t("plans.paymentTitle")} description={t("plans.paymentIntro")}>
          <ActionForm action={paymentInstructionsAction}>
            <Field label={t("plans.paymentInstructions")} name="paymentInstructions"><Textarea name="paymentInstructions" rows={4} defaultValue={instructions ?? ""} placeholder={t("plans.paymentPlaceholder")} /></Field>
            <SubmitButton variant="secondary">{t("common.save")}</SubmitButton>
          </ActionForm>
        </Card>
      </div>

      <Card title={t("plans.title")} description={t("plans.listIntro")} className="mt-6">
        {plans.length > 0 && (
          <Table head={[t("plans.code"), t("plans.name"), t("plans.monthly"), t("plans.annual"), t("common.status"), ""]}>
            {plans.map((p) => (
              <tr key={p.id}>
                <Td>{p.code}</Td><Td>{p.name}</Td>
                <Td className="text-xs">{money(p.priceMonthlySrd, "SRD")} / {money(p.priceMonthlyUsd, "USD")}</Td>
                <Td className="text-xs">{money(p.priceAnnualSrd, "SRD")} / {money(p.priceAnnualUsd, "USD")}</Td>
                <Td><Badge tone={p.status === "ACTIVE" ? "success" : "neutral"}>{p.status === "ACTIVE" ? t("plans.statusActive") : t("plans.statusArchived")}</Badge></Td>
                <Td><details><summary className="cursor-pointer text-sm text-accent">{t("common.edit")}</summary><div className="mt-3 min-w-[28rem]">{planForm(p)}</div></details></Td>
              </tr>
            ))}
          </Table>
        )}
        <details className="mt-4" open={plans.length === 0}>
          <summary className="cursor-pointer text-sm font-medium text-accent">{t("plans.add")}</summary>
          <div className="mt-3">{planForm()}</div>
        </details>
      </Card>

      <Card title={t("plans.previewTitle")} description={t("plans.previewIntro")} className="mt-6">
        <PlanCards plans={plans.filter((p) => p.status === "ACTIVE")} />
      </Card>
    </>
  );
}
