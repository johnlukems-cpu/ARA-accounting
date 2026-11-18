import { createTranslator } from "next-intl";
import { DEFAULT_LOCALE, isLocale, TIME_ZONE } from "@/i18n/config";

/**
 * Translator for code that runs outside a Next.js request scope (PDF rendering, e-mails, jobs, tests).
 * Same messages as the UI; use getTranslations() in pages and server actions as usual.
 */
export async function translatorFor(locale: string) {
  const l = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const messages = (await import(`../../messages/${l}.json`)).default;
  return createTranslator({ locale: l, messages, timeZone: TIME_ZONE });
}
