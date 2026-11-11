import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { depreciationSchedule } from "@/modules/assets/schedule";
import { disposeAssetAction, transferAssetAction } from "@/actions/assets";
import { formatAmount } from "@/lib/format";
import { ActionForm, Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { Badge, Card, Dl, PageHeader, Table, Td, TextLink } from "@/components/ui/misc";

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const ctx = await requireApp();
  const data = await withTenant(ctx.access, async (tx) => {
    const asset = await tx.asset.findUnique({ where: { id }, include: { category: true, history: { orderBy: { createdAt: "asc" } }, depreciation: true } });
    if (!asset) return null;
    const admin = await tx.administration.findUniqueOrThrow({ where: { id: asset.administrationId } });
    const entries = await tx.journalEntry.findMany({ where: { id: { in: asset.depreciation.map((d) => d.entryId) } }, select: { id: true, status: true } });
    const counters = await tx.account.findMany({ where: { administrationId: admin.id, type: "DETAIL", status: "ACTIVE", controlType: { in: ["NONE", "SUSPENSE", "CURRENT_ACCOUNT", "RECEIVABLE"] }, category: { in: ["ASSET", "LIABILITY"] } }, select: { id: true, number: true, name: true }, orderBy: { number: "asc" } });
    return { asset, admin, status: new Map(entries.map((e) => [e.id, e.status])), counters };
  });
  if (!data || !can(ctx.access, "assets.view", data.admin.companyId)) notFound();
  const { asset, admin, status, counters } = data;
  const money = (v: { toString(): string }) => formatAmount(v.toString(), admin.baseCurrency, locale);
  const date = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeZone: "UTC" });
  const schedule = depreciationSchedule({ cost: asset.acquisitionCost.toString(), residual: asset.residualValue.toString(), usefulLifeMonths: asset.usefulLifeMonths, method: asset.method, decliningRatePct: asset.decliningRatePct?.toString(), start: asset.depreciationStart });
  const lineFor = (y: number, m: number) => asset.depreciation.find((d) => d.year === y && d.month === m);
  const active = asset.status === "ACTIVE";
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title={`${asset.number} · ${asset.name}`} description={asset.category.name} actions={<Badge tone={active ? "success" : "neutral"}>{t(`assets.statuses.${asset.status}`)}</Badge>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t("assets.details")}>
          <Dl items={[
            [t("assets.acquired"), date(asset.acquisitionDate)],
            [t("assets.cost"), money(asset.acquisitionCost)],
            [t("assets.residual"), money(asset.residualValue)],
            [t("assets.method"), `${t(`assets.methods.${asset.method}`)}${asset.decliningRatePct ? ` · ${asset.decliningRatePct.toString()}%` : ""}`],
            [t("assets.lifeMonths"), String(asset.usefulLifeMonths)],
            [t("assets.start"), date(asset.depreciationStart)],
            [t("assets.location"), asset.location ?? "—"],
            ...(asset.acquisitionEntryId ? [[t("assets.acquisitionEntry"), <TextLink key="e" href={`/app/ledger/entries/${asset.acquisitionEntryId}`}>{t("common.open")}</TextLink>] as [string, React.ReactNode]] : []),
            ...(asset.disposedAt ? [[t("assets.disposedAt"), `${date(asset.disposedAt)} · ${money(asset.disposalProceeds ?? 0)}`] as [string, string]] : []),
          ]} />
        </Card>
        <Card title={t("assets.history")}>
          <Table head={[t("common.date"), t("common.type"), t("common.amount"), ""]}>
            {asset.history.map((h) => (
              <tr key={h.id}>
                <Td>{date(h.date)}</Td>
                <Td>{t(`assets.tx.${h.type}`)}</Td>
                <Td className="amount text-right">{h.amount ? money(h.amount) : "—"}</Td>
                <Td>{h.entryId ? <TextLink href={`/app/ledger/entries/${h.entryId}`}>{t("common.open")}</TextLink> : null}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      {active && can(ctx.access, "assets.post", admin.companyId) && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card title={t("assets.disposeTitle")} description={t("assets.disposeIntro")}>
            <ActionForm action={disposeAssetAction}>
              <input type="hidden" name="assetId" value={asset.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("common.date")} name="date"><Input type="date" name="date" defaultValue={today} required /></Field>
                <Field label={t("assets.proceeds")} name="proceeds"><Input name="proceeds" inputMode="decimal" placeholder="0" /></Field>
                <Field label={t("assets.proceedsAccount")} name="counterAccountId" className="sm:col-span-2">
                  <Select name="counterAccountId" defaultValue="">{[<option key="" value="">—</option>, ...counters.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)]}</Select>
                </Field>
              </div>
              <SubmitButton variant="danger">{t("assets.dispose")}</SubmitButton>
            </ActionForm>
          </Card>
          <Card title={t("assets.transferTitle")}>
            <ActionForm action={transferAssetAction}>
              <input type="hidden" name="assetId" value={asset.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("common.date")} name="date"><Input type="date" name="date" defaultValue={today} required /></Field>
                <Field label={t("assets.location")} name="location"><Input name="location" defaultValue={asset.location ?? ""} /></Field>
              </div>
              <SubmitButton variant="secondary">{t("common.save")}</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      )}

      <Card title={t("assets.schedule")} className="mt-6">
        <Table head={[t("assets.month"), t("common.amount"), t("assets.bookValue"), t("common.status")]}>
          {schedule.map((l) => {
            const line = lineFor(l.year, l.month);
            const st = line ? status.get(line.entryId) : undefined;
            return (
              <tr key={`${l.year}-${l.month}`}>
                <Td>{`${String(l.month).padStart(2, "0")}-${l.year}`}</Td>
                <Td className="amount text-right">{money(l.amount)}</Td>
                <Td className="amount text-right">{money(l.bookValueAfter)}</Td>
                <Td>{line ? <TextLink href={`/app/ledger/entries/${line.entryId}`}>{t(`ledger.status.${st ?? "DRAFT"}`)}</TextLink> : <span className="text-muted-foreground">{t("assets.planned")}</span>}</Td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
