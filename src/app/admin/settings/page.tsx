import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/modules/admin/guard";
import { activeBackend } from "@/integrations/storage";
import { getEmailSender } from "@/integrations/email";
import { OpenBooks } from "@/components/admin/open-books";
import { Card, Dl, PageHeader, TextLink } from "@/components/ui/misc";

/** Settings overview: where ARA's own books and the portal's integrations are configured. */
export default async function AdminSettings() {
  const t = await getTranslations();
  const a = await requireAdmin("organization.view");
  return (
    <>
      <PageHeader title={t("admin.nav.settings")} description={t("admin.settings.intro")} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t("admin.settings.books")}>
          <Dl items={[[t("admin.settings.organization"), a.home.organizationId], [t("admin.settings.administration"), a.home.administrationId]]} />
          <div className="mt-3 flex flex-col gap-2">
            <OpenBooks to={`/app/administrations/${a.home.administrationId}`} label={t("admin.settings.administrationSettings")} />
            <OpenBooks to="/app/ledger/accounts" label={t("nav.accounts")} />
            <OpenBooks to="/app/ledger/tax-codes" label={t("nav.taxCodes")} />
            <OpenBooks to="/app/organization" label={t("admin.settings.company")} />
          </div>
        </Card>
        <Card title={t("admin.settings.integrations")}>
          <Dl items={[
            [t("admin.settings.storage"), activeBackend() === "SUPABASE" ? "Supabase Storage (private bucket)" : t("admin.storage.database")],
            [t("admin.settings.email"), getEmailSender() ? t("admin.settings.configured") : t("admin.settings.notConfigured")],
          ]} />
          <p className="mt-3 text-xs text-muted-foreground">{t("admin.settings.integrationsNote")}</p>
          <div className="mt-3 flex flex-col gap-2">
            <TextLink href="/app/platform/plans">{t("admin.settings.plans")}</TextLink>
            <TextLink href="/app/platform/readiness">{t("platform.tabs.readiness")}</TextLink>
          </div>
        </Card>
      </div>
    </>
  );
}
