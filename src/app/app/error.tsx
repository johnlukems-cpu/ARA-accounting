"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

/**
 * Error boundary for the application area. Shows a translated message and the server's error digest (a reference
 * the operator can find in the logs) — never the error message or stack trace itself.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("appError");
  return (
    <div role="alert" className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{t("body")}</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-muted-foreground">{t("reference", { digest: error.digest })}</p>}
      <div className="mt-6 flex gap-4 text-sm font-medium">
        <button type="button" onClick={reset} className="text-accent hover:underline">{t("retry")}</button>
        <Link href="/app" className="text-accent hover:underline">{t("back")}</Link>
      </div>
    </div>
  );
}
