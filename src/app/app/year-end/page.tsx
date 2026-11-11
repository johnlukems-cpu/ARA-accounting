import { redirect } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { CHECKLIST, autoChecks } from "@/modules/year-end/service";
import { adjustmentAction, checklistItemAction, startYearEndAction, yearEndStepAction } from "@/actions/year-end";
import { ActionForm, Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { Badge, Card, PageHeader, Table, Td, TextLink } from "@/components/ui/misc";

export default async function YearEndPage() {
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const ctx = await requireApp("yearEnd.view", { needCompany: true });
  if (!ctx.administration || !ctx.fiscalYear) redirect("/onboarding");
  const admin = ctx.administration;
  const fyId = ctx.fiscalYear.id;
  const data = await withTenant(ctx.access, async (tx) => {
    const fy = await tx.fiscalYear.findUniqueOrThrow({ where: { id: fyId } });
    const closing = await tx.yearEndClosing.findUnique({ where: { fiscalYearId: fyId }, include: { items: { orderBy: { sortOrder: "asc" } } } });
    return {
      fy, closing,
      checks: closing && closing.status !== "CLOSED" ? await autoChecks(tx, admin.id, fyId) : {},
      accounts: await tx.account.findMany({ where: { administrationId: admin.id, type: "DETAIL", status: "ACTIVE", controlType: { in: ["NONE", "SUSPENSE", "TAX", "RETAINED_EARNINGS"] } }, orderBy: { number: "asc" } }),
      users: await tx.user.findMany({ where: { id: { in: [closing?.submittedById, closing?.approvedById, closing?.closedById].filter(Boolean) as string[] } }, select: { id: true, name: true } }),
    };
  });
  const { fy, closing, checks, accounts } = data;
  const companyId = admin.companyId;
  const user = (id: string | null) => data.users.find((u) => u.id === id)?.name ?? "—";
  const tone = { IN_PROGRESS: "warning", REVIEW: "info", APPROVED: "info", CLOSED: "success" } as const;
  const mayEdit = can(ctx.access, "yearEnd.edit", companyId) && closing?.status === "IN_PROGRESS";
  const hidden = closing ? <input type="hidden" name="closingId" value={closing.id} /> : null;
  const mandatoryOpen = closing?.items.filter((i) => i.mandatory && i.status !== "COMPLETED").length ?? 0;

  return (
    <>
      <PageHeader title={t("yearEnd.title", { year: fy.code })} description={t("yearEnd.intro")} actions={closing && <Badge tone={tone[closing.status]}>{t(`yearEnd.statuses.${closing.status}`)}</Badge>} />
      {!closing && (
        <Card>
          <p className="mb-4 text-sm">{t("yearEnd.startIntro")}</p>
          {can(ctx.access, "yearEnd.edit", companyId) && fy.status !== "CLOSED" && (
            <ActionForm action={startYearEndAction}><input type="hidden" name="fiscalYearId" value={fy.id} /><SubmitButton>{t("yearEnd.start")}</SubmitButton></ActionForm>
          )}
        </Card>
      )}
      {closing && (
        <>
          <Card title={t("yearEnd.checklist")} description={t("yearEnd.checklistIntro", { open: mandatoryOpen })}>
            <Table head={["#", t("yearEnd.item"), t("yearEnd.check"), t("common.status"), ""]}>
              {closing.items.map((i) => {
                const auto = CHECKLIST.find((x) => x.code === i.code)?.auto;
                const result = (checks as Record<string, true | string>)[i.code];
                return (
                  <tr key={i.id}>
                    <Td>{i.sortOrder}</Td>
                    <Td>{t(`yearEnd.items.${i.code}`)}{!i.mandatory && <span className="ml-1 text-xs text-muted-foreground">({t("yearEnd.optional")})</span>}{i.comment && <span className="block text-xs text-muted-foreground">{i.comment}</span>}</Td>
                    <Td>{auto ? (result === true ? <Badge tone="success">{t("yearEnd.checkOk")}</Badge> : result ? <Badge tone="warning">{t(`yearEnd.reasons.${result.split(":")[0]}` as never)}{result.includes(":") ? ` (${result.split(":")[1]})` : ""}</Badge> : "—") : <span className="text-xs text-muted-foreground">{t("yearEnd.manual")}</span>}</Td>
                    <Td><Badge tone={i.status === "COMPLETED" ? "success" : i.status === "NOT_APPLICABLE" ? "neutral" : "warning"}>{t(`yearEnd.itemStatuses.${i.status}`)}</Badge>{i.completedAt && <span className="block text-xs text-muted-foreground">{format.dateTime(i.completedAt, { dateStyle: "short" })}</span>}</Td>
                    <Td>{mayEdit && (
                      i.status === "OPEN" ? (
                        <ActionForm action={checklistItemAction} className="flex flex-wrap items-center gap-1 space-y-0">
                          <input type="hidden" name="itemId" value={i.id} />
                          <Input name="comment" placeholder={t("yearEnd.comment")} aria-label={`${t("yearEnd.comment")} ${i.sortOrder}`} className="h-7 w-40 text-xs" />
                          <button name="status" value="COMPLETED" className="h-7 rounded-md border border-border px-2 text-xs">{t("yearEnd.complete")}</button>
                          {!i.mandatory && <button name="status" value="NOT_APPLICABLE" className="h-7 rounded-md px-2 text-xs text-muted-foreground">{t("yearEnd.notApplicable")}</button>}
                        </ActionForm>
                      ) : (
                        <ActionForm action={checklistItemAction} className="space-y-0"><input type="hidden" name="itemId" value={i.id} /><input type="hidden" name="status" value="OPEN" /><SubmitButton variant="ghost" className="h-7 px-2 text-xs">{t("yearEnd.reopenItem")}</SubmitButton></ActionForm>
                      )
                    )}</Td>
                  </tr>
                );
              })}
            </Table>
          </Card>

          {mayEdit && (
            <Card title={t("yearEnd.adjustmentTitle")} description={t("yearEnd.adjustmentIntro")} className="mt-6">
              <ActionForm action={adjustmentAction} resetOnSuccess>
                {hidden}<input type="hidden" name="locale" value={locale} />
                <div className="grid gap-4 sm:grid-cols-4">
                  <Field label={t("ledger.debit")} name="debitAccountId"><Select name="debitAccountId" defaultValue="">{[<option key="" value="">—</option>, ...accounts.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)]}</Select></Field>
                  <Field label={t("ledger.credit")} name="creditAccountId"><Select name="creditAccountId" defaultValue="">{[<option key="" value="">—</option>, ...accounts.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)]}</Select></Field>
                  <Field label={t("common.amount")} name="amount"><Input name="amount" inputMode="decimal" required /></Field>
                  <Field label={t("ledger.description")} name="description"><Input name="description" required /></Field>
                </div>
                <SubmitButton variant="secondary">{t("yearEnd.postAdjustment")}</SubmitButton>
              </ActionForm>
            </Card>
          )}

          <Card title={t("yearEnd.workflow")} className="mt-6">
            <div className="space-y-1 text-sm">
              <p>{t("yearEnd.submittedBy")}: {user(closing.submittedById)}</p>
              <p>{t("yearEnd.approvedBy")}: {user(closing.approvedById)}</p>
              {closing.closedAt && <p>{t("yearEnd.closedBy")}: {user(closing.closedById)} · {format.dateTime(closing.closedAt, { dateStyle: "medium" })}</p>}
              {closing.closingEntryId && <p><TextLink href={`/app/ledger/entries/${closing.closingEntryId}`}>{t("yearEnd.closingEntry")}</TextLink> · {closing.openingEntryId && <TextLink href={`/app/ledger/entries/${closing.openingEntryId}`}>{t("yearEnd.openingEntry")}</TextLink>}</p>}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {closing.status === "IN_PROGRESS" && can(ctx.access, "yearEnd.edit", companyId) && <ActionForm action={yearEndStepAction} className="space-y-0">{hidden}<input type="hidden" name="step" value="submit" /><SubmitButton>{t("yearEnd.submit")}</SubmitButton></ActionForm>}
              {closing.status === "REVIEW" && can(ctx.access, "yearEnd.approve", companyId) && closing.submittedById !== ctx.user.id && <>
                <ActionForm action={yearEndStepAction} className="space-y-0">{hidden}<input type="hidden" name="step" value="approve" /><SubmitButton>{t("yearEnd.approve")}</SubmitButton></ActionForm>
                <ActionForm action={yearEndStepAction} className="flex gap-2 space-y-0">{hidden}<input type="hidden" name="step" value="return" /><Input name="reason" placeholder={t("periods.reasonPlaceholder")} aria-label={t("periods.reason")} className="h-9 w-56" /><SubmitButton variant="ghost">{t("budgets.return")}</SubmitButton></ActionForm>
              </>}
              {closing.status === "APPROVED" && can(ctx.access, "yearEnd.close", companyId) && <ActionForm action={yearEndStepAction} className="space-y-0">{hidden}<input type="hidden" name="step" value="close" /><SubmitButton variant="danger">{t("yearEnd.close")}</SubmitButton></ActionForm>}
              {closing.status === "CLOSED" && can(ctx.access, "yearEnd.close", companyId) && <ActionForm action={yearEndStepAction} className="flex gap-2 space-y-0">{hidden}<input type="hidden" name="step" value="reopen" /><Input name="reason" placeholder={t("yearEnd.reopenReason")} aria-label={t("yearEnd.reopenReason")} className="h-9 w-64" /><SubmitButton variant="ghost">{t("yearEnd.reopen")}</SubmitButton></ActionForm>}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{t(`yearEnd.help.${closing.status}`)}</p>
          </Card>
        </>
      )}
    </>
  );
}
