import { getTranslations } from "next-intl/server";
import { requireUser } from "@/core/auth/context";
import { changePasswordAction, disableMfaAction, updateProfileAction } from "@/actions/account";
import { ActionForm, Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { Badge, Card, PageHeader } from "@/components/ui/misc";
import { MfaSetup } from "@/components/finance/mfa-setup";

/** Reachable without satisfied MFA (so users can set it up when their organisation requires it). */
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ mfa?: string }> }) {
  const t = await getTranslations();
  const ctx = await requireUser();
  const { mfa } = await searchParams;
  const user = ctx.user;

  return (
    <>
      <PageHeader title={t("account.title")} description={user.email} />
      {mfa === "required" && !user.mfaEnabled && <p role="alert" className="mb-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm">{t("account.mfaRequiredBanner")}</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t("account.profile")}>
          <ActionForm action={updateProfileAction}>
            <Field label={t("auth.name")} name="name"><Input name="name" defaultValue={user.name} required /></Field>
            <Field label={t("language.label")} name="locale">
              <Select name="locale" defaultValue={user.locale}>
                <option value="nl">{t("language.nl")}</option>
                <option value="en">{t("language.en")}</option>
              </Select>
            </Field>
            <SubmitButton>{t("common.save")}</SubmitButton>
          </ActionForm>
        </Card>

        <Card title={t("account.mfaTitle")} actions={user.mfaEnabled ? <Badge tone="success">{t("account.mfaOn")}</Badge> : <Badge tone="warning">{t("account.mfaOff")}</Badge>}>
          <p className="mb-4 text-sm text-muted-foreground">{t("account.mfaIntro")}</p>
          {user.mfaEnabled ? (
            <ActionForm action={disableMfaAction}>
              <Field label={t("account.currentPassword")} name="password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
              <Field label={t("auth.mfaCode")} name="code"><Input name="code" inputMode="numeric" required className="max-w-40" /></Field>
              <SubmitButton variant="danger">{t("account.disableMfa")}</SubmitButton>
            </ActionForm>
          ) : (
            <MfaSetup labels={{
              start: t("account.setUpMfa"), scan: t("account.mfaScan"), secret: t("account.mfaSecret"), code: t("auth.mfaCode"),
              confirm: t("account.mfaConfirm"), recovery: t("account.recoveryCodes"), error: t("errors.generic"),
            }} />
          )}
        </Card>

        <Card title={t("account.passwordTitle")}>
          <ActionForm action={changePasswordAction} resetOnSuccess>
            <Field label={t("account.currentPassword")} name="current"><Input name="current" type="password" autoComplete="current-password" required /></Field>
            <Field label={t("auth.newPassword")} name="password" hint={t("auth.passwordHint")}><Input name="password" type="password" autoComplete="new-password" minLength={12} required /></Field>
            <SubmitButton>{t("auth.savePassword")}</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
