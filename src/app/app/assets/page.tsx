import { redirect } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Decimal from "decimal.js";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { assetRegister } from "@/modules/assets/service";
import { cancelDepreciationAction, proposeDepreciationAction, registerAssetAction } from "@/actions/assets";
import { formatAmount } from "@/lib/format";
import { ActionForm, Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { Badge, Card, EmptyState, PageHeader, Table, Td, TextLink } from "@/components/ui/misc";

export default async function AssetsPage({ searchParams }: { searchParams: Promise<{ asOf?: string }> }) {
  const sp = await searchParams;
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const ctx = await requireApp("assets.view", { needCompany: true });
  if (!ctx.administration) redirect("/onboarding");
  const admin = ctx.administration;
  const asOf = sp.asOf && /^\d{4}-\d{2}-\d{2}$/.test(sp.asOf) ? sp.asOf : new Date().toISOString().slice(0, 10);
  const data = await withTenant(ctx.access, async (tx) => ({
    register: await assetRegister(tx, admin.id, new Date(`${asOf}T00:00:00Z`)),
    categories: await tx.assetCategory.findMany({ where: { administrationId: admin.id, status: "ACTIVE" }, orderBy: { code: "asc" } }),
    proposals: await tx.journalEntry.findMany({ where: { administrationId: admin.id, sourceType: "DEPRECIATION", status: { not: "POSTED" } }, include: { lines: { select: { debitBase: true } } }, orderBy: { entryDate: "asc" } }),
    counters: await tx.account.findMany({ where: { administrationId: admin.id, type: "DETAIL", status: "ACTIVE", controlType: { in: ["NONE", "SUSPENSE", "CURRENT_ACCOUNT"] }, category: { in: ["ASSET", "LIABILITY", "EQUITY"] } }, select: { id: true, number: true, name: true }, orderBy: { number: "asc" } }),
  }));
  const base = admin.baseCurrency;
  const money = (v: { toString(): string }) => formatAmount(v.toString(), base, locale);
  const date = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeZone: "UTC" });
  const totals = data.register.reduce((s, a) => ({ cost: a.disposedAsOf ? s.cost : s.cost.plus(a.acquisitionCost.toString()), acc: s.acc.plus(a.accumulated), nbv: s.nbv.plus(a.bookValue) }), { cost: new Decimal(0), acc: new Decimal(0), nbv: new Decimal(0) });
  const mayCreate = can(ctx.access, "assets.create", admin.companyId);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const today = new Date().toISOString().slice(0, 10);
  const clearing = data.counters.find((a) => a.number === "0090");

  return (
    <>
      <PageHeader title={t("assets.title")} description={`${admin.code} · ${admin.name}`} />
      <Card title={t("assets.register")} actions={
        <form className="flex items-center gap-2 text-sm"><label htmlFor="asOf" className="text-muted-foreground">{t("assets.asOf")}</label><input id="asOf" type="date" name="asOf" defaultValue={asOf} className="h-8 rounded-md border border-border bg-background px-2" /><button className="h-8 rounded-md border border-border px-3">{t("common.show")}</button></form>
      }>
        {data.register.length === 0 ? <EmptyState title={t("assets.none")} /> : (
          <Table head={[t("assets.number"), t("company.name"), t("assets.category"), t("assets.acquired"), t("assets.cost"), t("assets.accumulated"), t("assets.bookValue"), t("common.status")]}>
            {data.register.map((a) => (
              <tr key={a.id}>
                <Td><TextLink href={`/app/assets/${a.id}`}>{a.number}</TextLink></Td>
                <Td>{a.name}</Td>
                <Td>{a.category.name}</Td>
                <Td>{date(a.acquisitionDate)}</Td>
                <Td className="amount text-right">{money(a.acquisitionCost)}</Td>
                <Td className="amount text-right">{money(a.accumulated)}</Td>
                <Td className="amount text-right font-medium">{money(a.bookValue)}</Td>
                <Td><Badge tone={a.status === "ACTIVE" ? "success" : "neutral"}>{t(`assets.statuses.${a.status}`)}</Badge></Td>
              </tr>
            ))}
            <tr className="border-t-2 border-border font-medium">
              <Td colSpan={4}>{t("common.total")}</Td>
              <Td className="amount text-right">{money(totals.cost)}</Td>
              <Td className="amount text-right">{money(totals.acc)}</Td>
              <Td className="amount text-right">{money(totals.nbv)}</Td>
              <Td />
            </tr>
          </Table>
        )}
      </Card>

      <Card title={t("assets.depreciationTitle")} description={t("assets.depreciationIntro")} className="mt-6">
        {data.proposals.length > 0 && (
          <Table head={[t("ledger.entryDate"), t("ledger.description"), t("common.amount"), t("common.status"), ""]}>
            {data.proposals.map((p) => (
              <tr key={p.id}>
                <Td>{date(p.entryDate)}</Td>
                <Td><TextLink href={`/app/ledger/entries/${p.id}`}>{p.description}</TextLink></Td>
                <Td className="amount text-right">{money(p.lines.reduce((s, l) => s.plus(l.debitBase.toString()), new Decimal(0)))}</Td>
                <Td><Badge tone="warning">{t(`ledger.status.${p.status}`)}</Badge></Td>
                <Td>{mayCreate && (
                  <ActionForm action={cancelDepreciationAction} className="space-y-0"><input type="hidden" name="entryId" value={p.id} /><SubmitButton variant="ghost">{t("assets.cancelProposal")}</SubmitButton></ActionForm>
                )}</Td>
              </tr>
            ))}
          </Table>
        )}
        {mayCreate && (
          <ActionForm action={proposeDepreciationAction} className="mt-4 flex flex-wrap items-end gap-3 space-y-0">
            <input type="hidden" name="administrationId" value={admin.id} />
            <Field label={t("assets.month")} name="period"><Input type="month" name="period" defaultValue={thisMonth} required /></Field>
            <SubmitButton>{t("assets.propose")}</SubmitButton>
          </ActionForm>
        )}
      </Card>

      {mayCreate && (
        <Card title={t("assets.addTitle")} description={t("assets.addIntro")} className="mt-6">
          <ActionForm action={registerAssetAction} resetOnSuccess>
            <input type="hidden" name="administrationId" value={admin.id} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("assets.number")} name="number"><Input name="number" required maxLength={20} /></Field>
              <Field label={t("company.name")} name="name" className="sm:col-span-2"><Input name="name" required /></Field>
              <Field label={t("assets.category")} name="categoryId">
                <Select name="categoryId" defaultValue="">{[<option key="" value="">—</option>, ...data.categories.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name} ({c.defaultUsefulLifeMonths} {t("assets.monthsShort")})</option>)]}</Select>
              </Field>
              <Field label={t("assets.acquired")} name="acquisitionDate"><Input type="date" name="acquisitionDate" defaultValue={today} required /></Field>
              <Field label={t("assets.costBase", { base })} name="acquisitionCost"><Input name="acquisitionCost" inputMode="decimal" required /></Field>
              <Field label={t("assets.residual")} name="residualValue"><Input name="residualValue" inputMode="decimal" placeholder="0" /></Field>
              <Field label={t("assets.lifeMonths")} name="usefulLifeMonths"><Input type="number" name="usefulLifeMonths" min={1} max={1200} defaultValue={60} required /></Field>
              <Field label={t("assets.method")} name="method">
                <Select name="method" defaultValue="STRAIGHT_LINE"><option value="STRAIGHT_LINE">{t("assets.methods.STRAIGHT_LINE")}</option><option value="DECLINING_BALANCE">{t("assets.methods.DECLINING_BALANCE")}</option></Select>
              </Field>
              <Field label={t("assets.decliningRate")} name="decliningRatePct" hint={t("assets.decliningRateHint")}><Input name="decliningRatePct" inputMode="decimal" /></Field>
              <Field label={t("assets.start")} name="depreciationStart" hint={t("assets.startHint")}><Input type="date" name="depreciationStart" /></Field>
              <Field label={t("assets.location")} name="location"><Input name="location" /></Field>
              <Field label={t("assets.counterAccount")} name="counterAccountId" hint={t("assets.counterAccountHint")} className="sm:col-span-3">
                <Select name="counterAccountId" defaultValue={clearing?.id ?? ""}>
                  {[<option key="NONE" value="NONE">{t("assets.alreadyBooked")}</option>, ...data.counters.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)]}
                </Select>
              </Field>
            </div>
            <SubmitButton>{t("assets.add")}</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
