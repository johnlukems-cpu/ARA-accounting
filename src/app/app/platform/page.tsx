import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { LIMIT_KEYS, platformOverview } from "@/modules/saas/service";
import { createSubscriptionInvoiceAction, invoiceStepAction, setSubscriptionAction } from "@/actions/saas";
import { PlatformTabs } from "@/components/platform/tabs";
import { formatAmount } from "@/lib/format";
import { ActionForm, Checkbox, Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui/misc";

/** Platform administration (ARA staff only): organisations, plans, subscription invoices and payments. */
export default async function PlatformPage() {
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const ctx = await requireApp();
  if (!ctx.user.isPlatformAdmin) notFound();
  const { rows, plans, invoices } = await platformOverview(ctx.user.id);
  const date = (d: Date | null) => (d ? format.dateTime(d, { dateStyle: "short" }) : "—");
  const orgName = (id: string) => rows.find((r) => r.org.id === id)?.org.name ?? id;

  return (
    <>
      <PageHeader title={t("platform.title")} description={t("platform.intro")} />
      <PlatformTabs active="organisations" />
      <Card title={t("platform.organisations")}>
        <Table head={[t("organization.name"), t("common.status"), t("saas.plan"), t("saas.usage"), ""]}>
          {rows.map(({ org, usage, openInvoices, state }) => (
            <tr key={org.id}>
              <Td>{org.name}<span className="block text-xs text-muted-foreground">{t(`organization.kind.${org.kind}` as never)} · {date(org.createdAt)}</span></Td>
              <Td><Badge tone={state.readOnly ? "warning" : "success"}>{t(`saas.statuses.${org.status}`)}</Badge>{org.trialEndsAt && <span className="block text-xs">{t("saas.trialEnds")}: {date(org.trialEndsAt)}</span>}{openInvoices > 0 && <span className="block text-xs text-amber-700">{openInvoices} {t("saas.openInvoices")}</span>}</Td>
              <Td>{plans.find((p) => p.id === org.planId)?.name ?? "—"}</Td>
              <Td className="text-xs">{LIMIT_KEYS.map((k) => `${t(`saas.limits.${k}`)}: ${usage[k]}`).join(" · ")}</Td>
              <Td>
                <ActionForm action={setSubscriptionAction} className="flex flex-wrap items-center gap-1 space-y-0">
                  <input type="hidden" name="organizationId" value={org.id} />
                  <Select name="planId" defaultValue={org.planId ?? ""} aria-label={t("saas.plan")} className="h-7 w-28 text-xs">{[<option key="" value="">—</option>, ...plans.filter((p) => p.status === "ACTIVE").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)]}</Select>
                  <Select name="status" defaultValue={org.status} aria-label={t("common.status")} className="h-7 w-28 text-xs">{["TRIAL", "ACTIVE", "SUSPENDED", "CANCELLED"].map((s) => <option key={s} value={s}>{t(`saas.statuses.${s}`)}</option>)}</Select>
                  <Input type="date" name="trialEndsAt" aria-label={t("saas.trialEnds")} className="h-7 w-32 text-xs" />
                  <Input name="reason" placeholder={t("saas.reason")} aria-label={t("saas.reason")} className="h-7 w-32 text-xs" />
                  <SubmitButton variant="secondary" className="h-7 px-2 text-xs">{t("common.save")}</SubmitButton>
                </ActionForm>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <div className="mt-6">
        <Card title={t("saas.invoices")}>
          <ActionForm action={createSubscriptionInvoiceAction} resetOnSuccess>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("platform.organisation")} name="organizationId" className="sm:col-span-2"><Select name="organizationId" defaultValue="">{[<option key="" value="">—</option>, ...rows.map((r) => <option key={r.org.id} value={r.org.id}>{r.org.name}</option>)]}</Select></Field>
              <Field label={t("periods.from")} name="periodFrom"><Input type="date" name="periodFrom" required /></Field>
              <Field label={t("periods.to")} name="periodTo"><Input type="date" name="periodTo" required /></Field>
              <Field label={t("ledger.currency")} name="currency"><Select name="currency" defaultValue="SRD"><option>SRD</option><option>USD</option></Select></Field>
              <Field label={t("common.amount")} name="amount"><Input name="amount" inputMode="decimal" required /></Field>
            </div>
            <SubmitButton>{t("platform.createInvoice")}</SubmitButton>
          </ActionForm>
          <div className="mt-4">
            <Table head={[t("ledger.number"), t("platform.organisation"), t("common.amount"), t("common.status"), ""]}>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <Td>{i.number}</Td><Td className="text-xs">{orgName(i.organizationId)}</Td><Td className="amount text-right">{formatAmount(i.amount.toString(), i.currency, locale)}</Td>
                  <Td><Badge tone={i.status === "PAID" ? "success" : i.status === "OPEN" ? "warning" : "neutral"}>{t(`saas.invoiceStatuses.${i.status}`)}</Badge>{i.paymentReference && <span className="block text-xs">{i.paymentReference}</span>}</Td>
                  <Td>{i.status === "OPEN" && (
                    <ActionForm action={invoiceStepAction} className="flex flex-wrap items-center gap-1 space-y-0">
                      <input type="hidden" name="invoiceId" value={i.id} />
                      <Input name="reference" placeholder={t("platform.paymentReference")} aria-label={t("platform.paymentReference")} className="h-7 w-32 text-xs" />
                      <Checkbox name="reactivate" label={t("platform.reactivate")} defaultChecked />
                      <button name="step" value="pay" className="h-7 rounded-md border border-border px-2 text-xs">{t("platform.confirmPayment")}</button>
                      <button name="step" value="void" className="h-7 rounded-md px-2 text-xs text-muted-foreground">{t("platform.void")}</button>
                    </ActionForm>
                  )}</Td>
                </tr>
              ))}
            </Table>
          </div>
        </Card>
      </div>
    </>
  );
}
