import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <p className="text-sm font-semibold text-accent">404</p>
      <h1 className="mt-2 text-2xl font-semibold">{t("notFound.title")}</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{t("notFound.body")}</p>
      <Link href="/app" className="mt-6 text-sm font-medium text-accent hover:underline">{t("notFound.back")}</Link>
    </div>
  );
}
