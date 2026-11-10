import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Decimal from "decimal.js";
import { requireApp } from "@/core/auth/context";
import { withTenant } from "@/core/tenancy/tenant";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui/misc";

/** BTW codes of the administration with their legal verification status (rates are data, never code). */
export default async function TaxCodesPage() {
  const t = await getTranslations();
  const ctx = await requireApp("tax.view", { needCompany: true });
  if (!ctx.administration) redirect("/onboarding");
  const admin = ctx.administration;
  const codes = await withTenant(ctx.access, async (tx) => {
    const list = await tx.taxCode.findMany({ where: { administrationId: admin.id }, orderBy: { code: "asc" } });
    const accounts = new Map((await tx.account.findMany({ where: { id: { in: list.flatMap((c) => [c.outputAccountId, c.inputAccountId]).filter(Boolean) as string[] } } })).map((a) => [a.id, a.number]));
    return list.map((c) => ({ ...c, out: c.outputAccountId ? accounts.get(c.outputAccountId) : null, in: c.inputAccountId ? accounts.get(c.inputAccountId) : null }));
  });
  const tone = { VERIFIED: "success", SOURCE_FOUND: "info", PENDING_VERIFICATION: "warning" } as const;

  return (
    <>
      <PageHeader title={t("tax.codesTitle")} description={t("tax.codesIntro")} />
      <Card>
        <Table head={[t("administration.code"), t("company.name"), t("tax.rate"), t("tax.direction"), t("tax.accounts"), t("tax.legalStatus")]}>
          {codes.map((c) => (
            <tr key={c.id}>
              <Td className="font-medium">{c.code}</Td>
              <Td>{c.name}{c.legalSource && <span className="block text-xs text-muted-foreground">{c.legalSource}</span>}</Td>
              <Td className="amount">{new Decimal(c.rate.toString()).toString()}%</Td>
              <Td className="text-xs">{t(`tax.directions.${c.direction}`)}</Td>
              <Td className="text-xs">{[c.out && `${t("tax.output")} ${c.out}`, c.in && `${t("tax.input")} ${c.in}`].filter(Boolean).join(" · ")}</Td>
              <Td><Badge tone={tone[c.legalStatus]}>{t(`tax.legalStatuses.${c.legalStatus}`)}</Badge></Td>
            </tr>
          ))}
        </Table>
        <p className="mt-4 text-xs text-muted-foreground">{t("tax.verificationNote")}</p>
      </Card>
    </>
  );
}
