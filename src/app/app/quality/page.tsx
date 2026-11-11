import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { scanAction, issueAction } from "@/actions/quality";
import { buttonClass } from "@/components/ui/button-class";
import { ActionForm, Input, Select, SubmitButton } from "@/components/ui/form";
import { Badge, Card, EmptyState, PageHeader, Table, Td } from "@/components/ui/misc";

const VIEWS = ["open", "closed"] as const;

export default async function QualityPage({ searchParams }: { searchParams: Promise<{ view?: string; severity?: string }> }) {
  const sp = await searchParams;
  const t = await getTranslations();
  const format = await getFormatter();
  const ctx = await requireApp("quality.view", { needCompany: true });
  if (!ctx.administration) redirect("/onboarding");
  const admin = ctx.administration;
  const view = sp.view === "closed" ? "closed" : "open";
  const severity = ["ERROR", "WARNING", "INFO"].includes(sp.severity ?? "") ? (sp.severity as "ERROR" | "WARNING" | "INFO") : undefined;
  const data = await withTenant(ctx.access, async (tx) => {
    const lastScan = await tx.qualityScan.findFirst({ where: { administrationId: admin.id }, orderBy: { startedAt: "desc" } });
    const issues = await tx.qualityIssue.findMany({
      where: { administrationId: admin.id, status: view === "open" ? { in: ["OPEN", "IN_PROGRESS"] } : { in: ["RESOLVED", "ACCEPTED", "FALSE_POSITIVE"] }, ...(severity ? { severity } : {}) },
      orderBy: [{ severity: "asc" }, { firstSeenAt: "desc" }], take: 200,
    });
    const members = await tx.organizationMembership.findMany({ where: { organizationId: ctx.access.organizationId, status: "ACTIVE" }, include: { user: { select: { id: true, name: true } } } });
    const history = await tx.qualityScan.findMany({ where: { administrationId: admin.id }, orderBy: { startedAt: "desc" }, take: 10 });
    return { lastScan, issues, members, history };
  });
  const { lastScan, issues, members, history } = data;
  const tone = { ERROR: "warning", WARNING: "info", INFO: "neutral" } as const;
  const mayEdit = can(ctx.access, "quality.edit", admin.companyId);
  const userName = (id: string | null) => members.find((m) => m.userId === id)?.user.name ?? "—";
  const text = (i: (typeof issues)[number]) => t(`quality.checks.${i.checkCode}.message` as never, i.params as never);

  return (
    <>
      <PageHeader title={t("quality.title")} description={t("quality.intro")} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={t("quality.score")}>
          <p className="text-4xl font-semibold">{lastScan ? lastScan.score : "—"}<span className="text-base text-muted-foreground">/100</span></p>
          <p className="mt-1 text-sm text-muted-foreground">{lastScan ? t("quality.lastScan", { date: format.dateTime(lastScan.startedAt, { dateStyle: "medium", timeStyle: "short" }), trigger: t(`quality.triggers.${lastScan.trigger}` as never) }) : t("quality.neverScanned")}</p>
          <ActionForm action={scanAction} className="mt-4"><input type="hidden" name="administrationId" value={admin.id} /><SubmitButton>{t("quality.scan")}</SubmitButton></ActionForm>
          <p className="mt-2 text-xs text-muted-foreground">{t("quality.scheduleNote")}</p>
        </Card>
        <Card title={t("quality.history")} className="lg:col-span-2">
          {history.length === 0 ? <p className="text-sm text-muted-foreground">{t("quality.neverScanned")}</p> : (
            <Table head={[t("common.date"), t("quality.trigger"), t("quality.findings"), t("quality.newIssues"), t("quality.score")]}>
              {history.map((h) => <tr key={h.id}><Td>{format.dateTime(h.startedAt, { dateStyle: "short", timeStyle: "short" })}</Td><Td>{t(`quality.triggers.${h.trigger}` as never)}</Td><Td>{h.findings}</Td><Td>{h.newIssues}</Td><Td>{h.score}</Td></tr>)}
            </Table>
          )}
        </Card>
      </div>

      <Card title={t("quality.issues")} className="mt-6" actions={
        <div className="flex flex-wrap gap-2 text-sm">
          {VIEWS.map((v) => <Link key={v} href={`/app/quality?view=${v}`} className={buttonClass(view === v ? "primary" : "secondary", "sm")}>{t(`quality.views.${v}`)}</Link>)}
          {["ERROR", "WARNING", "INFO"].map((s) => <Link key={s} href={`/app/quality?view=${view}&severity=${s}`} className={buttonClass(severity === s ? "primary" : "ghost", "sm")}>{t(`quality.severities.${s}`)}</Link>)}
        </div>
      }>
        {issues.length === 0 ? <EmptyState title={t(view === "open" ? "quality.noOpen" : "quality.noClosed")} /> : (
          <Table head={[t("quality.severity"), t("quality.issue"), t("quality.seen"), t("quality.assignee"), ""]}>
            {issues.map((i) => {
              const stale = lastScan && i.lastSeenAt < lastScan.startedAt;
              return (
                <tr key={i.id}>
                  <Td><Badge tone={tone[i.severity]}>{t(`quality.severities.${i.severity}`)}</Badge></Td>
                  <Td><span className="font-medium">{t(`quality.checks.${i.checkCode}.title` as never)}</span><span className="block text-sm">{text(i)}</span><span className="block text-xs text-muted-foreground">{t(`quality.checks.${i.checkCode}.action` as never)}</span>{i.resolutionNote && <span className="block text-xs text-muted-foreground">{t(`quality.statuses.${i.status}`)}: {i.resolutionNote}</span>}</Td>
                  <Td className="text-xs">{format.dateTime(i.firstSeenAt, { dateStyle: "short" })} · {i.timesSeen}×{stale && <span className="block text-amber-700 dark:text-amber-400">{t("quality.notSeenLastScan")}</span>}</Td>
                  <Td className="text-sm">{userName(i.assigneeId)}</Td>
                  <Td>{mayEdit && view === "open" && (
                    <ActionForm action={issueAction} className="flex flex-wrap items-center gap-1 space-y-0">
                      <input type="hidden" name="issueId" value={i.id} />
                      <Select name="assigneeId" defaultValue={i.assigneeId ?? ""} aria-label={t("quality.assignee")} className="h-7 w-32 text-xs">{[<option key="" value="">—</option>, ...members.map((m) => <option key={m.userId} value={m.userId}>{m.user.name}</option>)]}</Select>
                      <Select name="status" defaultValue={i.status} aria-label={t("common.status")} className="h-7 w-36 text-xs">{["OPEN", "IN_PROGRESS", "RESOLVED", "ACCEPTED", "FALSE_POSITIVE"].map((s) => <option key={s} value={s}>{t(`quality.statuses.${s}`)}</option>)}</Select>
                      <Input name="note" placeholder={t("quality.note")} aria-label={t("quality.note")} className="h-7 w-40 text-xs" />
                      <SubmitButton variant="secondary" className="h-7 px-2 text-xs">{t("common.save")}</SubmitButton>
                    </ActionForm>
                  )}</Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </>
  );
}
