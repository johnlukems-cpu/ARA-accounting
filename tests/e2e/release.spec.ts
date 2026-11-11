import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";

/**
 * Release check (Phase 12): in both languages, on desktop and on a phone, a fresh organisation can register,
 * complete onboarding and open every page in the navigation without an error, an untranslated key, or a page
 * that is wider than the screen.
 */
const uid = () => randomBytes(4).toString("hex");
const LABELS = {
  nl: { org: "Naam organisatie", name: "Uw naam", email: "E-mailadres", password: "Wachtwoord", register: "Account aanmaken", company: "Naam", next: "Volgende", year: "Eerste boekjaar", finish: "Administratie aanmaken", nav: "Hoofdmenu" },
  en: { org: "Organisation name", name: "Your name", email: "E-mail address", password: "Password", register: "Create account", company: "Name", next: "Next", year: "First fiscal year", finish: "Create administration", nav: "Main menu" },
} as const;
// A message key rendered as text (next-intl's fallback for a missing translation) looks like "namespace.key".
const RAW_KEY = /\b(?:nav|common|shell|auth|ledger|reports|tax|errors|validation|organization|onboarding|quality|saas|yearEnd|annual|assets|budgets|currency|scan|practice|sales|purchase|banking)\.[a-z][A-Za-z]+\b/;

for (const locale of ["nl", "en"] as const) {
  test(`release walk-through (${locale})`, async ({ page, context, baseURL }, info) => {
    test.setTimeout(240_000);
    await context.addCookies([{ name: "ARA_ACC_LOCALE", value: locale, url: baseURL! }]);
    const L = LABELS[locale];
    await page.goto("/register");
    await page.getByLabel(L.org).fill(`Release ${uid()}`);
    await page.getByLabel(L.name).fill("Release Test");
    await page.getByLabel(L.email).fill(`rel-${uid()}@example.test`);
    await page.getByLabel(L.password).fill("een lang test wachtwoord");
    await page.getByRole("button", { name: L.register }).click();
    await page.getByLabel(L.company, { exact: true }).fill("Release Wanica NV");
    await page.getByRole("button", { name: L.next }).click();
    await page.getByLabel(L.year).fill(String(new Date().getUTCFullYear()));
    await page.getByRole("button", { name: L.finish }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.locator("html")).toHaveAttribute("lang", locale === "nl" ? "nl-SR" : "en");

    // Every link in the visible navigation (sidebar on desktop, scrolling bar on a phone).
    const nav = page.getByRole("navigation", { name: L.nav }).filter({ visible: true });
    const hrefs = [...new Set(await nav.getByRole("link").evaluateAll((as) => as.map((a) => a.getAttribute("href")!)))];
    expect(hrefs.length).toBeGreaterThan(20);
    const problems: string[] = [];
    for (const href of hrefs) {
      const res = await page.goto(href);
      if (!res || res.status() >= 400) { problems.push(`${href}: HTTP ${res?.status()}`); continue; }
      if (await page.getByRole("alert").filter({ hasText: locale === "nl" ? "Er is iets misgegaan" : "Something went wrong" }).count()) problems.push(`${href}: error boundary`);
      // Technical identifiers (audit action codes, account numbers) are shown in <code> on purpose: not translations.
      const text = await page.locator("main").first().evaluate((el) => { const c = el.cloneNode(true) as HTMLElement; c.querySelectorAll("code").forEach((n) => n.remove()); return c.innerText; });
      const raw = text.match(RAW_KEY);
      if (raw) problems.push(`${href}: untranslated key ${raw[0]}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) problems.push(`${href}: page ${overflow}px wider than the ${info.project.name} viewport`);
    }
    expect(problems).toEqual([]);
  });
}
