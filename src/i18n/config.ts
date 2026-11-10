export const LOCALES = ["nl", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** Dutch (as used in Suriname) is the default interface language. */
export const DEFAULT_LOCALE: Locale = "nl";
export const LOCALE_COOKIE = "ARA_ACC_LOCALE";
export const TIME_ZONE = "America/Paramaribo";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
