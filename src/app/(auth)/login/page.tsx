import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { loginAction } from "@/actions/auth";
import { getContext } from "@/core/auth/context";
import { ActionForm, Field, Input, SubmitButton } from "@/components/ui/form";


export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const t = await getTranslations();
  if (await getContext()) redirect("/app");
  const { reset } = await searchParams;
  return (
    <>
      <h1 className="text-xl font-semibold">{t("auth.loginTitle")}</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">{t("auth.loginIntro")}</p>
      {reset && <p className="mb-4 rounded-lg bg-accent-soft px-3 py-2 text-sm">{t("auth.passwordWasReset")}</p>}
      <ActionForm action={loginAction}>
        <Field label={t("auth.email")} name="email">
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label={t("auth.password")} name="password">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        <SubmitButton className="w-full">{t("auth.login")}</SubmitButton>
      </ActionForm>
      <div className="mt-6 flex flex-wrap justify-between gap-2 text-sm">
        <Link className="text-accent hover:underline" href="/forgot-password">{t("auth.forgotPassword")}</Link>
        <Link className="text-accent hover:underline" href="/register">{t("auth.noAccount")}</Link>
      </div>
    </>
  );
}
