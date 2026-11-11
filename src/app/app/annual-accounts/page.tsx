import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { FRAMEWORKS } from "@/modules/annual-accounts/service";
import { annualStepAction, generateAnnualAction, saveNoteAction } from "@/actions/annual-accounts";
import { formatAmount } from "@/lib/format";
import { buttonClass } from "@/components/ui/button-class";
import { ActionForm, Field, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { Badge, Card, Dl, PageHeader, Table, Td } from "@/components/ui/misc";

const defaultFramework = (legalForm: string) =>
  ["EENMANSZAAK", "VOF", "CV"].includes(legalForm) ? "SOLE_PROPRIETOR" : ["STICHTING", "VERENIGING", "KERKGENOOTSCHAP"].includes(legalForm) ? "FOUNDATION" : "NV_IFRS_SME";

type Snap = { pl: { totals: { revenue: string; netResult: string } }; bs: { balanced: boolean; totals: { assets: string; equity: string } }; assets: { category: string; costClosing: string; depClosing: string; bookValue: string }[] };

export default async function AnnualAccountsPage() {
  const t = await getTranslations();
  const locale = await getLocale();
  const ctx = await requireApp("annualAccounts.view", { needCompany: true });
  if (!ctx.administration || !ctx.fiscalYear || !ctx.company) redirect("/onboarding");
  const admin = ctx.administration;
  const fyId = ctx.fiscalYear.id;
  const data = await withTenant(ctx.access, async (tx) => ({
    fy: await tx.fiscalYear.findUniqueOrThrow({ where: { id: fyId } }),
    aa: await tx.annualAccount.findUnique({ where: { fiscalYearId: fyId }, include: { disclosures: { orderBy: { sortOrder: "asc" } } } }),
    company: await tx.company.findUniqueOrThrow({ where: { id: admin.companyId } }),
  }));
  const { fy, aa, company } = data;
  const money = (v: string) => formatAmount(v, admin.baseCurrency, locale);
  const companyId = admin.companyId;
  const snap = aa?.snapshot as Snap | undefined;
  const draft = aa?.status === "DRAFT";
  const mayEdit = can(ctx.access, "annualAccounts.edit", companyId);
  const mayApprove = can(ctx.access, "annualAccounts.approve", companyId);
  const step = (s: string, label: string, variant: "primary" | "secondary" | "ghost" = "primary") => (
    <ActionForm action={annualStepAction} className="space-y-0"><input type="hidden" name="annualAccountId" value={aa!.id} /><input type="hidden" name="step" value={s} /><SubmitButton variant={variant}>{label}</SubmitButton></ActionForm>
  );

  return (
    <>
      <PageHeader title={t("annual.pageTitle", { year: fy.code })} description={t("annual.intro")} actions={aa && <Badge tone={aa.status === "FINAL" ? "success" : aa.status === "DRAFT" ? "warning" : "info"}>{t(`annual.statuses.${aa.status}`)}</Badge>} />
      {fy.status !== "CLOSED" && <div role="note" className="mb-6 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">{t("annual.yearOpenNote")}</div>}

      {(!aa || draft) && mayEdit && (
        <Card title={aa ? t("annual.regenerateTitle") : t("annual.generateTitle")} description={t("annual.generateIntro")} className="mb-6">
          <ActionForm action={generateAnnualAction} className="flex flex-wrap items-end gap-3 space-y-0">
            <input type="hidden" name="administrationId" value={admin.id} /><input type="hidden" name="fiscalYearId" value={fy.id} />
            <Field label={t("annual.framework")} name="framework"><Select name="framework" defaultValue={aa?.framework ?? defaultFramework(company.legalForm)}>{FRAMEWORKS.map((f) => <option key={f} value={f}>{t(`annual.frameworks.${f}`)}</option>)}</Select></Field>
            <SubmitButton>{aa ? t("annual.regenerate") : t("annual.generate")}</SubmitButton>
          </ActionForm>
        </Card>
      )}

      {aa && snap && (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title={t("annual.summary")} description={t(`annual.frameworks.${aa.framework}`)}>
              <Dl items={[[t("reports.lines.REVENUE"), money(snap.pl.totals.revenue)], [t("reports.totals.netResult"), money(snap.pl.totals.netResult)], [t("reports.totals.assets"), money(snap.bs.totals.assets)], [t("reports.totals.equity"), money(snap.bs.totals.equity)], [t("reports.fingerprint"), `${aa.fingerprint.slice(0, 16)} (${aa.entryCount} ${t("reports.entries")})`]]} />
              <p className="mt-3 flex flex-wrap gap-2">
                {snap.bs.balanced ? <Badge tone="success">{t("reports.balanced")}</Badge> : <Badge tone="warning">{t("reports.notBalanced")}</Badge>}
                {can(ctx.access, "annualAccounts.export", companyId) && <a className={buttonClass("secondary", "sm")} href={`/api/annual-accounts/${aa.id}/pdf`}>{t("annual.downloadPdf")}</a>}
              </p>
            </Card>
            <Card title={t("annual.assetSchedule")}>
              {snap.assets.length === 0 ? <p className="text-sm text-muted-foreground">{t("annual.noAssets")}</p> : (
                <Table head={[t("assets.category"), t("annual.costClosing"), t("annual.depClosing"), t("annual.bookValue")]}>
                  {snap.assets.map((a) => <tr key={a.category}><Td>{a.category}</Td><Td className="amount text-right">{money(a.costClosing)}</Td><Td className="amount text-right">{money(a.depClosing)}</Td><Td className="amount text-right">{money(a.bookValue)}</Td></tr>)}
                </Table>
              )}
            </Card>
          </div>

          <Card title={t("annual.notes")} description={t("annual.notesIntro")} className="mt-6">
            <div className="space-y-6">
              {aa.disclosures.map((d) => draft && mayEdit ? (
                <ActionForm key={d.id} action={saveNoteAction} className="space-y-2 border-b border-border pb-4">
                  <input type="hidden" name="annualAccountId" value={aa.id} /><input type="hidden" name="code" value={d.code} />
                  <Field label={t("annual.noteTitle")} name="title"><Input name="title" defaultValue={d.title} aria-label={`${t("annual.noteTitle")} ${d.code}`} /></Field>
                  <Textarea name="body" rows={4} defaultValue={d.body} aria-label={d.title} />
                  <div className="flex items-center gap-3"><SubmitButton variant="secondary">{t("common.save")}</SubmitButton>{d.auto && <span className="text-xs text-muted-foreground">{t("annual.autoNote")}</span>}</div>
                </ActionForm>
              ) : (
                <div key={d.id}><h3 className="font-semibold">{d.title}</h3><p className="whitespace-pre-line text-sm">{d.body}</p></div>
              ))}
              {draft && mayEdit && (
                <ActionForm action={saveNoteAction} resetOnSuccess className="space-y-2">
                  <input type="hidden" name="annualAccountId" value={aa.id} />
                  <div className="grid gap-3 sm:grid-cols-2"><Field label={t("annual.noteCode")} name="code"><Input name="code" /></Field><Field label={t("annual.noteTitle")} name="title"><Input name="title" /></Field></div>
                  <Textarea name="body" rows={3} aria-label={t("annual.noteBody")} />
                  <SubmitButton variant="ghost">{t("annual.addNote")}</SubmitButton>
                </ActionForm>
              )}
            </div>
          </Card>

          <Card title={t("annual.workflow")} className="mt-6">
            <div className="flex flex-wrap gap-2">
              {draft && mayEdit && step("submit", t("annual.submit"))}
              {aa.status === "REVIEW" && mayApprove && aa.submittedById !== ctx.user.id && <>{step("approve", t("annual.approve"))}{step("return", t("budgets.return"), "ghost")}</>}
              {aa.status === "APPROVED" && mayApprove && <>{step("finalize", t("annual.finalize"))}{step("return", t("budgets.return"), "ghost")}</>}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{t(`annual.help.${aa.status}`)}</p>
          </Card>
        </>
      )}
    </>
  );
}
