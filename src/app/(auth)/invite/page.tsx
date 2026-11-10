import { getTranslations } from "next-intl/server";
import { acceptInvitationAction } from "@/actions/auth";
import { ActionForm, Field, Input, SubmitButton } from "@/components/ui/form";


export default async function InvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const t = await getTranslations();
  const { token = "" } = await searchParams;
  return (
    <>
      <h1 className="text-xl font-semibold">{t("auth.inviteTitle")}</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">{t("auth.inviteIntro")}</p>
      <ActionForm action={acceptInvitationAction}>
        <input type="hidden" name="token" value={token} />
        <Field label={t("auth.name")} name="name">
          <Input name="name" autoComplete="name" required />
        </Field>
        <Field label={t("auth.newPassword")} name="password" hint={t("auth.passwordHint")}>
          <Input name="password" type="password" autoComplete="new-password" minLength={12} required />
        </Field>
        <SubmitButton className="w-full">{t("auth.activateAccount")}</SubmitButton>
      </ActionForm>
    </>
  );
}
