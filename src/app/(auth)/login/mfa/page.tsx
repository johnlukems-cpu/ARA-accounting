import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { logoutAction, verifyMfaAction } from "@/actions/auth";
import { getContext } from "@/core/auth/context";
import { ActionForm, Field, Input, SubmitButton } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/button-class";


export default async function MfaPage() {
  const t = await getTranslations();
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  if (!ctx.user.mfaEnabled || ctx.session.mfaVerifiedAt) redirect("/app");
  return (
    <>
      <h1 className="text-xl font-semibold">{t("auth.mfaTitle")}</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">{t("auth.mfaIntro")}</p>
      <ActionForm action={verifyMfaAction}>
        <Field label={t("auth.mfaCode")} name="code" hint={t("auth.mfaRecoveryHint")}>
          <Input name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required />
        </Field>
        <SubmitButton className="w-full">{t("auth.verify")}</SubmitButton>
      </ActionForm>
      <form action={logoutAction} className="mt-4">
        <button className={buttonClass("ghost", "sm")}>{t("auth.logout")}</button>
      </form>
    </>
  );
}
