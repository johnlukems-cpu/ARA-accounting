import Image from "next/image";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { createAdministrationAction, createCompanyAction } from "@/actions/organization";
import { logoutAction } from "@/actions/auth";
import { requireUser } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/button-class";
import { AdministrationFields, CompanyFields } from "@/components/finance/org-fields";
import { templateChoices } from "@/modules/industry/queries";

export default async function OnboardingPage() {
  const t = await getTranslations();
  const ctx = await requireUser();
  if (ctx.company && ctx.administration) redirect("/app");

  const step = !ctx.company ? "company" : "administration";
  const mayCreateCompany = !!ctx.access && can(ctx.access, "companies.create");
  const mayCreateAdmin = !!ctx.access && !!ctx.company && can(ctx.access, "administrations.create", ctx.company.id);
  const templates = mayCreateAdmin && step === "administration" ? await templateChoices(ctx.access!, await getLocale()) : [];

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-navy-950">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <span className="rounded-md bg-white px-2 py-1">
            <Image src="/brand/ara-accounting-logo.png" alt={t("brand.product")} width={90} height={39} />
          </span>
          <form action={logoutAction}>
            <button className="text-sm text-white/70 hover:text-white">{t("auth.logout")}</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm font-medium text-accent">{t("onboarding.step", { n: step === "company" ? 1 : 2, total: 2 })}</p>
        <h1 className="mt-1 text-2xl font-semibold">{t(step === "company" ? "onboarding.companyTitle" : "onboarding.administrationTitle")}</h1>
        <p className="mb-6 mt-2 text-sm text-muted-foreground">
          {t(step === "company" ? "onboarding.companyIntro" : "onboarding.administrationIntro", { org: ctx.organization?.name ?? "" })}
        </p>
        <div className="rounded-xl border border-border bg-surface p-6">
          {step === "company" && mayCreateCompany && (
            <ActionForm action={createCompanyAction}>
              <input type="hidden" name="redirectTo" value="onboarding" />
              <CompanyFields />
              <SubmitButton>{t("onboarding.next")}</SubmitButton>
            </ActionForm>
          )}
          {step === "administration" && mayCreateAdmin && ctx.company && (
            <ActionForm action={createAdministrationAction}>
              <input type="hidden" name="redirectTo" value="dashboard" />
              <AdministrationFields companyId={ctx.company.id} templates={templates} />
              <SubmitButton>{t("onboarding.finish")}</SubmitButton>
            </ActionForm>
          )}
          {((step === "company" && !mayCreateCompany) || (step === "administration" && !mayCreateAdmin)) && (
            <div className="space-y-3 text-sm">
              <p>{t("onboarding.waitForAccess")}</p>
              {ctx.company && <a className={buttonClass("secondary", "sm")} href="/app">{t("onboarding.toApp")}</a>}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
