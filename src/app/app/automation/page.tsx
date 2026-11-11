import { redirect } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { aiConfigured, aiSettingsOf, automationStats } from "@/modules/scan/service";
import { AI_MODEL } from "@/modules/scan/extractors";
import { saveRuleAction, setAiAction, toggleRuleAction } from "@/actions/scan";
import { formatAmount } from "@/lib/format";
import { ActionForm, Checkbox, Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { Badge, Card, EmptyState, PageHeader, Table, Td, TextLink } from "@/components/ui/misc";

/** Start of the monitor window (request time; evaluated outside render). */
const monitorSince = () => new Date(Date.now() - 30 * 86_400_000);

export default async function AutomationPage() {
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const ctx = await requireApp("automation.view", { needCompany: true });
  if (!ctx.administration) redirect("/onboarding");
  const admin = ctx.administration;
  const since = monitorSince();
  const data = await withTenant(ctx.access, async (tx) => ({
    org: await tx.organization.findUniqueOrThrow({ where: { id: ctx.access.organizationId } }),
    rules: await tx.automationRule.findMany({ where: { administrationId: admin.id }, orderBy: { createdAt: "desc" } }),
    parties: await tx.party.findMany({ where: { administrationId: admin.id, isSupplier: true, status: "ACTIVE" }, orderBy: { name: "asc" } }),
    accounts: await tx.account.findMany({ where: { administrationId: admin.id, type: "DETAIL", status: "ACTIVE", controlType: "NONE", category: { in: ["OPERATING_EXPENSE", "COST_OF_SALES", "ASSET", "FINANCIAL_EXPENSE"] } }, orderBy: { number: "asc" } }),
    taxCodes: await tx.taxCode.findMany({ where: { administrationId: admin.id, status: "ACTIVE", direction: { in: ["BOTH", "PURCHASE"] } }, orderBy: { code: "asc" } }),
    stats: await automationStats(tx, admin.id, since),
    recent: await tx.automationExecution.findMany({ where: { administrationId: admin.id }, orderBy: { createdAt: "desc" }, take: 20 }),
  }));
  const ai = aiSettingsOf(data.org.settings);
  const name = (list: { id: string; name: string }[], id: string | null) => list.find((x) => x.id === id)?.name ?? "—";
  const total = data.stats.reduce((s, r) => s + r.count, 0);
  const automated = data.stats.filter((r) => r.outcome === "DRAFTED" || r.outcome === "POSTED").reduce((s, r) => s + r.count, 0);
  const mayEdit = can(ctx.access, "automation.edit", admin.companyId);

  return (
    <>
      <PageHeader title={t("scan.automationTitle")} description={t("scan.automationIntro")} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={t("scan.monitor")} description={t("scan.last30")}>
          <p className="text-3xl font-semibold">{total ? Math.round((automated / total) * 100) : 0}%</p>
          <p className="text-sm text-muted-foreground">{t("scan.automatedShare", { automated, total })}</p>
          <ul className="mt-3 space-y-1 text-sm">{data.stats.map((s) => <li key={s.outcome} className="flex justify-between"><span>{t(`scan.outcomes.${s.outcome}`)}</span><span>{s.count} · ⌀ {s.avgMs} ms</span></li>)}</ul>
        </Card>
        <Card title={t("scan.aiTitle")} className="lg:col-span-2">
          <p className="text-sm">{t("scan.aiIntro")}</p>
          <p className="mt-2 text-sm">{t("scan.aiProvider")}: {aiConfigured() ? <Badge tone="success">{t("scan.aiConfigured", { model: AI_MODEL })}</Badge> : <Badge>{t("scan.aiNotConfigured")}</Badge>}</p>
          <p className="mt-1 text-sm">{t("scan.aiStatus")}: {ai.enabled ? <Badge tone="success">{t("scan.aiOnBadge")}</Badge> : <Badge>{t("scan.aiOffBadge")}</Badge>}{ai.consentAt && <span className="ml-2 text-xs text-muted-foreground">{t("scan.consentAt", { date: format.dateTime(new Date(ai.consentAt), { dateStyle: "medium" }) })}</span>}</p>
          {can(ctx.access, "organization.manageSettings") && (
            <ActionForm action={setAiAction} className="mt-4">
              <input type="hidden" name="enabled" value={ai.enabled ? "false" : "true"} />
              {!ai.enabled && <Checkbox name="consent" label={t("scan.consent")} />}
              <SubmitButton variant={ai.enabled ? "ghost" : "secondary"}>{ai.enabled ? t("scan.aiDisable") : t("scan.aiEnable")}</SubmitButton>
            </ActionForm>
          )}
        </Card>
      </div>

      <Card title={t("scan.rules")} description={t("scan.rulesIntro")} className="mt-6">
        {data.rules.length === 0 ? <EmptyState title={t("scan.noRules")} /> : (
          <Table head={[t("company.name"), t("invoicing.supplier"), t("ledger.account"), t("scan.mode"), t("scan.minConfidence"), t("scan.maxAmount"), t("common.status")]}>
            {data.rules.map((r) => (
              <tr key={r.id}>
                <Td>{r.name}{r.descriptionContains && <span className="block text-xs text-muted-foreground">“{r.descriptionContains}”</span>}</Td>
                <Td>{name(data.parties, r.partyId)}</Td>
                <Td>{data.accounts.find((a) => a.id === r.accountId)?.number ?? "—"} {data.taxCodes.find((c) => c.id === r.taxCodeId)?.code ?? ""}</Td>
                <Td>{t(`scan.modes.${r.mode}`)}</Td>
                <Td>{Math.round(Number(r.minConfidence) * 100)}%</Td>
                <Td className="amount text-right">{r.maxAmount ? formatAmount(r.maxAmount.toString(), admin.baseCurrency, locale) : "—"}</Td>
                <Td>{mayEdit ? (
                  <ActionForm action={toggleRuleAction} className="space-y-0"><input type="hidden" name="ruleId" value={r.id} /><input type="hidden" name="enabled" value={r.enabled ? "false" : "true"} /><SubmitButton variant="ghost" className="h-7 px-2 text-xs">{r.enabled ? t("scan.disable") : t("scan.enable")}</SubmitButton></ActionForm>
                ) : <Badge tone={r.enabled ? "success" : "neutral"}>{r.enabled ? t("scan.enabled") : t("scan.disabled")}</Badge>}</Td>
              </tr>
            ))}
          </Table>
        )}
        {mayEdit && (
          <ActionForm action={saveRuleAction} resetOnSuccess className="mt-6 border-t border-border pt-4">
            <input type="hidden" name="administrationId" value={admin.id} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("company.name")} name="name"><Input name="name" required /></Field>
              <Field label={t("invoicing.supplier")} name="partyId"><Select name="partyId" defaultValue="">{[<option key="" value="">—</option>, ...data.parties.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)]}</Select></Field>
              <Field label={t("scan.descriptionContains")} name="descriptionContains" hint={t("scan.descriptionContainsHint")}><Input name="descriptionContains" /></Field>
              <Field label={t("ledger.account")} name="accountId"><Select name="accountId" defaultValue="">{[<option key="" value="">—</option>, ...data.accounts.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)]}</Select></Field>
              <Field label={t("invoicing.taxCode")} name="taxCodeId"><Select name="taxCodeId" defaultValue="">{[<option key="" value="">—</option>, ...data.taxCodes.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)]}</Select></Field>
              <Field label={t("scan.mode")} name="mode" hint={t("scan.modeHint")}><Select name="mode" defaultValue="SUGGEST">{["SUGGEST", "DRAFT", "AUTO_POST"].map((m) => <option key={m} value={m}>{t(`scan.modes.${m}`)}</option>)}</Select></Field>
              <Field label={t("scan.minConfidence")} name="minConfidence"><Select name="minConfidence" defaultValue="0.9">{["0.8", "0.85", "0.9", "0.95"].map((v) => <option key={v} value={v}>{Math.round(Number(v) * 100)}%</option>)}</Select></Field>
              <Field label={t("scan.maxAmount")} name="maxAmount" hint={t("scan.maxAmountHint")}><Input name="maxAmount" inputMode="decimal" /></Field>
            </div>
            <SubmitButton>{t("scan.saveRule")}</SubmitButton>
          </ActionForm>
        )}
      </Card>

      <Card title={t("scan.recent")} className="mt-6">
        {data.recent.length === 0 ? <EmptyState title={t("scan.noRuns")} /> : (
          <Table head={[t("common.date"), t("scan.document"), t("scan.outcome"), t("scan.reasonsTitle")]}>
            {data.recent.map((r) => (
              <tr key={r.id}>
                <Td>{format.dateTime(r.createdAt, { dateStyle: "short", timeStyle: "short" })}</Td>
                <Td>{r.documentId ? <TextLink href={`/app/scan/${r.documentId}`}>{t("common.open")}</TextLink> : "—"}</Td>
                <Td>{t(`scan.outcomes.${r.outcome}`)}</Td>
                <Td className="text-xs">{(r.reasons as string[]).map((x) => t(`scan.reasons.${x.split(":")[0]}` as never)).join(", ") || "—"}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
