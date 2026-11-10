import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requestPasswordResetAction } from "@/actions/auth";
import { ActionForm, Field, Input, SubmitButton } from "@/components/ui/form";


export default async function ForgotPasswordPage() {
  const t = await getTranslations();
  return (
    <>
      <h1 className="text-xl font-semibold">{t("auth.forgotTitle")}</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">{t("auth.forgotIntro")}</p>
      <ActionForm action={requestPasswordResetAction}>
        <Field label={t("auth.email")} name="email">
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
        <SubmitButton className="w-full">{t("auth.sendResetLink")}</SubmitButton>
      </ActionForm>
      <p className="mt-6 text-sm">
        <Link className="text-accent hover:underline" href="/login">{t("auth.backToLogin")}</Link>
      </p>
    </>
  );
}
