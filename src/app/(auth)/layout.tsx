import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { isDatabaseConfigured } from "@/core/db/client";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-navy-950 px-4 py-10">
      <Link href="/" className="mb-6 rounded-md bg-white px-3 py-1.5">
        <Image src="/brand/ara-accounting-logo.png" alt={t("brand.product")} width={110} height={48} priority />
      </Link>
      <main className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl sm:p-8">
        {isDatabaseConfigured() ? children : <p className="text-sm">{t("auth.notConfigured")}</p>}
      </main>
      <p className="mt-6 text-xs text-white/50">{t("footer", { year: new Date().getFullYear() })}</p>
    </div>
  );
}
