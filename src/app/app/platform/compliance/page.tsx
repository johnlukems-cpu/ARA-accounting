import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { complianceRegister } from "@/modules/compliance/service";
import { recordReviewAction } from "@/actions/platform";
import { ActionForm, Field, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui/misc";
import { PlatformTabs } from "@/components/platform/tabs";

/**
 * Suriname compliance register: every legally relevant parameter with its status and the evidence of external review.
 * Nothing here claims compliance; "verified" only follows from a recorded review by a qualified adviser.
 */
export default async function CompliancePage() {
  const t = await getTranslations();
  const format = await getFormatter();
  const ctx = await requireApp();
  if (!ctx.user.isPlatformAdmin) notFound();
  const items = await complianceRegister();
  const verified = items.filter((i) => i.status === "VERIFIED").length;
  const tone = (s: string) => (s === "VERIFIED" ? "success" : s === "SOURCE_FOUND" ? "info" : "warning") as "success" | "info" | "warning";

  return (
    <>
      <PageHeader title={t("platform.title")} description={t("compliance.intro")} />
      <PlatformTabs active="compliance" />
      <div role="note" className="mb-6 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
        <p className="font-medium">{t("compliance.disclaimerTitle")}</p>
        <p className="mt-1">{t("compliance.disclaimer", { verified, total: items.length })}</p>
      </div>
      <Card title={t("compliance.registerTitle")} description={t("compliance.registerIntro")}>
        <Table head={[t("compliance.subject"), t("compliance.item"), t("compliance.value"), t("compliance.status"), t("compliance.reviewer"), t("compliance.lastReview")]}>
          {items.map((i) => (
            <tr key={`${i.subject}|${i.key}`}>
              <Td className="text-xs">{t(`compliance.subjects.${i.subject}`)}</Td>
              <Td>{i.title}{i.source && <span className="block text-xs text-muted-foreground">{i.source}</span>}</Td>
              <Td className="max-w-xs break-words font-mono text-xs">{i.value}</Td>
              <Td><Badge tone={tone(i.status)}>{t(`compliance.statuses.${i.status}`)}</Badge></Td>
              <Td className="text-xs">{t(`compliance.reviewers.${i.subject}`)}</Td>
              <Td className="text-xs">{i.lastReview ? <>{t(`compliance.decisions.${i.lastReview.decision}`)} · {format.dateTime(i.lastReview.reviewedOn, { dateStyle: "short" })}<span className="block">{i.lastReview.reviewerName} — {i.lastReview.reference}</span></> : "—"}</Td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title={t("compliance.recordTitle")} description={t("compliance.recordIntro")} className="mt-6">
        <ActionForm action={recordReviewAction} resetOnSuccess>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("compliance.item")} name="item" className="sm:col-span-2">
              <Select name="item" required defaultValue="">{[<option key="" value="">—</option>, ...items.map((i) => <option key={`${i.subject}|${i.key}`} value={`${i.subject}|${i.key}`}>{t(`compliance.subjects.${i.subject}`)} · {i.title}</option>)]}</Select>
            </Field>
            <Field label={t("compliance.decision")} name="decision"><Select name="decision" defaultValue="APPROVED">{["APPROVED", "CHANGES_REQUIRED", "REJECTED"].map((d) => <option key={d} value={d}>{t(`compliance.decisions.${d}`)}</option>)}</Select></Field>
            <Field label={t("compliance.reviewedOn")} name="reviewedOn"><Input type="date" name="reviewedOn" required /></Field>
            <Field label={t("compliance.reviewerName")} name="reviewerName"><Input name="reviewerName" required /></Field>
            <Field label={t("compliance.reviewerQualification")} name="reviewerQualification" hint={t("compliance.qualificationHint")}><Input name="reviewerQualification" required /></Field>
            <Field label={t("compliance.reference")} name="reference" hint={t("compliance.referenceHint")} className="sm:col-span-2"><Input name="reference" required /></Field>
            <Field label={t("common.notes")} name="notes" hint={t("compliance.notesHint")} className="sm:col-span-2"><Textarea name="notes" rows={3} /></Field>
          </div>
          <SubmitButton>{t("compliance.record")}</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
