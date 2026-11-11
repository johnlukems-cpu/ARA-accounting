import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { uploadDocumentAction } from "@/actions/scan";
import { ScanUpload } from "@/components/finance/scan-upload";
import { Badge, Card, EmptyState, PageHeader, Table, Td, TextLink } from "@/components/ui/misc";

const STATUSES = ["REVIEW_REQUIRED", "PROCESSED", "REJECTED"] as const;

export default async function ScanPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const t = await getTranslations();
  const format = await getFormatter();
  const ctx = await requireApp("scan.view", { needCompany: true });
  if (!ctx.administration) redirect("/onboarding");
  const admin = ctx.administration;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as (typeof STATUSES)[number]) : "REVIEW_REQUIRED";
  const docs = await withTenant(ctx.access, async (tx) => {
    const list = await tx.document.findMany({ where: { administrationId: admin.id, kind: "PURCHASE", status }, orderBy: { createdAt: "desc" }, take: 100 });
    const runs = await tx.automationExecution.findMany({ where: { documentId: { in: list.map((d) => d.id) } }, orderBy: { createdAt: "desc" } });
    return list.map((d) => ({ ...d, run: runs.find((r) => r.documentId === d.id) }));
  });
  const tone = { REVIEW_REQUIRED: "warning", PROCESSED: "success", REJECTED: "neutral", UPLOADED: "info" } as const;

  return (
    <>
      <PageHeader title={t("scan.title")} description={t("scan.intro")} />
      {can(ctx.access, "scan.create", admin.companyId) && (
        <Card title={t("scan.uploadTitle")} description={t("scan.uploadIntro")} className="mb-6">
          <ScanUpload administrationId={admin.id} action={uploadDocumentAction} />
        </Card>
      )}
      <Card actions={
        <nav className="flex gap-2 text-sm">{STATUSES.map((s) => <TextLink key={s} href={`/app/scan?status=${s}`}>{s === status ? <strong>{t(`scan.statuses.${s}`)}</strong> : t(`scan.statuses.${s}`)}</TextLink>)}</nav>
      }>
        {docs.length === 0 ? <EmptyState title={t("scan.none")} /> : (
          <Table head={[t("scan.file"), t("scan.uploaded"), t("common.status"), t("scan.automation"), ""]}>
            {docs.map((d) => (
              <tr key={d.id}>
                <Td><TextLink href={`/app/scan/${d.id}`}>{d.fileName}</TextLink><span className="block text-xs text-muted-foreground">{d.mimeType === "application/pdf" ? "PDF" : "Foto"}{d.pageCount ? ` · ${d.pageCount} p.` : ""}</span></Td>
                <Td>{format.dateTime(d.createdAt, { dateStyle: "medium", timeStyle: "short" })}</Td>
                <Td><Badge tone={tone[d.status]}>{t(`scan.statuses.${d.status}`)}</Badge></Td>
                <Td className="text-xs">{d.run ? t(`scan.outcomes.${d.run.outcome}`) : "—"}</Td>
                <Td>{d.duplicateReason && <Badge tone="warning">{t("scan.duplicateBadge")}</Badge>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
