import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, TIME_ZONE, isLocale } from "./config";

/** Locale per request: signed-in user's preference → language cookie → Dutch. */
export default getRequestConfig(async () => {
  let userLocale: string | undefined;
  if (process.env.DATABASE_URL) {
    const { readSession } = await import("@/core/auth/session");
    userLocale = (await readSession().catch(() => null))?.user.locale;
  }
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(userLocale) ? userLocale : isLocale(fromCookie) ? fromCookie : DEFAULT_LOCALE;
  return {
    locale,
    timeZone: TIME_ZONE,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
