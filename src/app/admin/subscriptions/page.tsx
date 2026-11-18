import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { systemDb } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { requireAdmin, adminCan } from "@/modules/admin/guard";
import { changeSubscriptionAction, createSubscriptionAction, runBillingAction, subscriptionStatusAction } from "@/actions/admin";
import { formatAmount } from "@/lib/format";
import { ActionForm, Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { Badge, Card, EmptyState, PageHeader, Table, Td } from "@/components/ui/misc";

const STATUSES = ["TRIAL", "ACTIVE", "SUSPENDED", "CANCELLED"] as const;

export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<{ status?: string; customer?: string }> }) {
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const a = await requireAdmin("billing.view");
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status);
  const { subs, customers, products } = await withTenant(a.access, async (tx) => ({
    subs: await tx.araSubscription.findMany({ where: { ...(status ? { status } : {}), ...(sp.customer ? { customerId: sp.customer } : {}) }, orderBy: [{ status: "asc" }, { nextBillingDate: "asc" }], include: { customer: { select: { name: true } }, events: { orderBy: { createdAt: "desc" }, take: 5 } } }),
    customers: await tx.crmCustomer.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } }),
    products: await tx.product.findMany({ where: { status: "ACTIVE", billingType: "RECURRING" }, orderBy: { name: "asc" } }),
  }));
  const plans = await systemDb.plan.findMany({ where: { status: "ACTIVE" }, orderBy: { code: "asc" } });
  const date = (d: Date | null) => (d ? format.dateTime(d, { dateStyle: "short" }) : "—");
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  return (
    <>
      <PageHeader title={t("admin.nav.subscriptions")} description={t("admin.subscription.intro")} />
      {adminCan(a, "billing.create") && (
        <Card title={t("admin.billing.title")} description={t("admin.billing.intro")}>
          <ActionForm action={runBillingAction} className="flex flex-wrap items-end gap-2 space-y-0" dataLabels={{ result: t("admin.billing.result") }}>
            <Field label={t("admin.billing.asOf")} name="asOf"><Input type="date" name="asOf" defaultValue={today.toISOString().slice(0, 10)} /></Field>
            <SubmitButton>{t("admin.billing.run")}</SubmitButton>
          </ActionForm>
        </Card>
      )}
      <form className="my-4 flex flex-wrap gap-2">
        <select name="status" defaultValue={sp.status ?? ""} aria-label={t("common.status")} className="h-9 rounded-lg border border-border bg-surface px-2 text-sm"><option value="">{t("admin.subscription.all")}</option>{STATUSES.map((s) => <option key={s} value={s}>{t(`admin.subscriptionStatuses.${s}`)}</option>)}</select>
        <button className="h-9 rounded-lg border border-border px-3 text-sm">{t("common.filter")}</button>
      </form>
      <Card>
        {subs.length === 0 ? <EmptyState title={t("admin.subscription.none")} /> : (
          <Table head={[t("admin.subscription.number"), t("admin.quote.customer"), t("admin.subscription.product"), t("admin.subscription.price"), t("common.status"), t("admin.subscription.nextBilling"), ""]}>
            {subs.map((s) => (
              <tr key={s.id}>
                <Td className="font-mono text-xs">{s.number}</Td>
                <Td><Link href={`/admin/customers/${s.customerId}`} className="hover:underline">{s.customer.name}</Link></Td>
                <Td>{products.find((p) => p.id === s.productId)?.name ?? "—"}{s.planId && <span className="block text-xs text-muted-foreground">{t("admin.subscription.plan")}: {plans.find((p) => p.id === s.planId)?.name}</span>}</Td>
                <Td className="amount text-right">{formatAmount(s.unitPrice.toString(), s.currency, locale)}{!s.quantity.equals(1) && ` × ${s.quantity.toString()}`} / {t(`admin.intervals.${s.interval}`)}</Td>
                <Td><Badge tone={s.status === "ACTIVE" ? "success" : s.status === "TRIAL" ? "info" : s.status === "SUSPENDED" ? "warning" : "neutral"}>{t(`admin.subscriptionStatuses.${s.status}`)}</Badge>{s.status === "TRIAL" && s.trialEndsAt && <span className={`block text-xs ${s.trialEndsAt < today ? "text-danger" : "text-muted-foreground"}`}>{t("admin.subscription.trialUntil", { date: date(s.trialEndsAt) })}</span>}</Td>
                <Td>{s.status === "ACTIVE" ? date(s.nextBillingDate) : "—"}</Td>
                <Td>
                  {s.status !== "CANCELLED" && adminCan(a, "billing.edit") && (
                    <details>
                      <summary className="cursor-pointer text-sm text-accent">{t("admin.subscription.manage")}</summary>
                      <div className="mt-3 min-w-[22rem] space-y-4">
                        {adminCan(a, "billing.approve") && (
                          <ActionForm action={subscriptionStatusAction}>
                            <input type="hidden" name="id" value={s.id} />
                            <Field label={t("admin.subscription.reason")} name="reason"><Input name="reason" required /></Field>
                            <div className="flex flex-wrap gap-2">
                              {s.status === "TRIAL" && <button name="step" value="ACTIVATE" className="h-8 rounded-md bg-primary px-2 text-xs text-primary-foreground">{t("admin.subscription.activate")}</button>}
                              {s.status === "SUSPENDED" && <button name="step" value="REACTIVATE" className="h-8 rounded-md border border-border px-2 text-xs">{t("admin.subscription.reactivate")}</button>}
                              {(s.status === "ACTIVE" || s.status === "TRIAL") && <button name="step" value="SUSPEND" className="h-8 rounded-md border border-border px-2 text-xs">{t("admin.subscription.suspend")}</button>}
                              <button name="step" value="CANCEL" className="h-8 rounded-md border border-danger/40 px-2 text-xs text-danger">{t("admin.subscription.cancel")}</button>
                            </div>
                          </ActionForm>
                        )}
                        <ActionForm action={changeSubscriptionAction}>
                          <input type="hidden" name="subscriptionId" value={s.id} />
                          <div className="grid grid-cols-2 gap-2">
                            <Field label={t("admin.subscription.product")} name="productId"><Select name="productId" defaultValue={s.productId}>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
                            <Field label={t("admin.subscription.plan")} name="planId"><Select name="planId" defaultValue={s.planId ?? ""}>{[<option key="" value="">—</option>, ...plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)]}</Select></Field>
                            <Field label={t("admin.subscription.price")} name="unitPrice"><Input name="unitPrice" inputMode="decimal" defaultValue={s.unitPrice.toString()} /></Field>
                            <Field label={t("admin.subscription.interval")} name="interval"><Select name="interval" defaultValue={s.interval}>{["MONTHLY", "QUARTERLY", "ANNUAL"].map((i) => <option key={i} value={i}>{t(`admin.intervals.${i}`)}</option>)}</Select></Field>
                            <Field label={t("admin.subscription.quantity")} name="quantity"><Input name="quantity" inputMode="decimal" defaultValue={s.quantity.toString()} /></Field>
                            <Field label={t("admin.subscription.reason")} name="reason"><Input name="reason" required /></Field>
                          </div>
                          <p className="text-xs text-muted-foreground">{t("admin.subscription.changeNote")}</p>
                          <SubmitButton variant="secondary">{t("admin.subscription.change")}</SubmitButton>
                        </ActionForm>
                        <ul className="text-xs text-muted-foreground">{s.events.map((e) => <li key={e.id}>{date(e.createdAt)} · {t(`admin.subscriptionEvents.${e.type}` as never)}</li>)}</ul>
                      </div>
                    </details>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {adminCan(a, "billing.create") && (
        <Card title={t("admin.subscription.new")} description={t("admin.subscription.newIntro")} className="mt-6">
          <ActionForm action={createSubscriptionAction} resetOnSuccess>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label={t("admin.quote.customer")} name="customerId"><Select name="customerId" defaultValue={sp.customer ?? ""} required>{[<option key="" value="">—</option>, ...customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)]}</Select></Field>
              <Field label={t("admin.subscription.product")} name="productId"><Select name="productId" required defaultValue="">{[<option key="" value="">—</option>, ...products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.defaultPrice ? ` (${formatAmount(p.defaultPrice.toString(), p.currency, locale)})` : ""}</option>)]}</Select></Field>
              <Field label={t("admin.subscription.interval")} name="interval"><Select name="interval" defaultValue="MONTHLY">{["MONTHLY", "QUARTERLY", "ANNUAL"].map((i) => <option key={i} value={i}>{t(`admin.intervals.${i}`)}</option>)}</Select></Field>
              <Field label={t("admin.subscription.price")} name="unitPrice" hint={t("admin.subscription.priceHint")}><Input name="unitPrice" inputMode="decimal" /></Field>
              <Field label={t("admin.subscription.currency")} name="currency" hint={t("admin.subscription.currencyHint")}><Input name="currency" maxLength={3} /></Field>
              <Field label={t("admin.subscription.quantity")} name="quantity"><Input name="quantity" inputMode="decimal" defaultValue="1" /></Field>
              <Field label={t("admin.subscription.start")} name="startDate"><Input type="date" name="startDate" defaultValue={today.toISOString().slice(0, 10)} required /></Field>
              <Field label={t("admin.subscription.trialDays")} name="trialDays"><Input type="number" min={0} max={365} name="trialDays" defaultValue={0} /></Field>
              <Field label={t("admin.subscription.plan")} name="planId" hint={t("admin.subscription.planHint")}><Select name="planId" defaultValue="">{[<option key="" value="">—</option>, ...plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)]}</Select></Field>
            </div>
            <SubmitButton>{t("admin.subscription.create")}</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
