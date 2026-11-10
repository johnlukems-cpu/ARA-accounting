import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { verifyEmail } from "@/actions/auth";


export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const t = await getTranslations();
  const { token } = await searchParams;
  const ok = token ? await verifyEmail(token) : false;
  return (
    <>
      <h1 className="text-xl font-semibold">{t("auth.verifyTitle")}</h1>
      <p className="mt-2 text-sm">{ok ? t("auth.verifyOk") : t("errors.invalidToken")}</p>
      <p className="mt-6 text-sm">
        <Link className="text-accent hover:underline" href="/app">{t("auth.toApp")}</Link>
      </p>
    </>
  );
}
