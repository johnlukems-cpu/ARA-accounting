import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { registerAction } from "@/actions/auth";
import { ActionForm, Field, Input, Select, SubmitButton } from "@/components/ui/form";


export default async function RegisterPage() {
  const t = await getTranslations();
  return (
    <>
      <h1 className="text-xl font-semibold">{t("auth.registerTitle")}</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">{t("auth.registerIntro")}</p>
      <ActionForm action={registerAction}>
        <Field label={t("auth.kind")} name="kind">
          <Select name="kind" defaultValue="BUSINESS">
            <option value="BUSINESS">{t("auth.kindBusiness")}</option>
            <option value="ACCOUNTING_FIRM">{t("auth.kindFirm")}</option>
          </Select>
        </Field>
        <Field label={t("auth.organizationName")} name="organizationName">
          <Input name="organizationName" autoComplete="organization" required />
        </Field>
        <Field label={t("auth.name")} name="name">
          <Input name="name" autoComplete="name" required />
        </Field>
        <Field label={t("auth.email")} name="email">
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label={t("auth.password")} name="password" hint={t("auth.passwordHint")}>
          <Input name="password" type="password" autoComplete="new-password" minLength={12} required />
        </Field>
        <SubmitButton className="w-full">{t("auth.register")}</SubmitButton>
      </ActionForm>
      <p className="mt-6 text-sm">
        <Link className="text-accent hover:underline" href="/login">{t("auth.haveAccount")}</Link>
      </p>
    </>
  );
}
