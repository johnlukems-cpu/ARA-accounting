import { test } from "@playwright/test";
import { randomBytes } from "node:crypto";

/**
 * Screenshots for docs/USER_MANUAL_NL.md (Dutch interface, desktop). Not part of the regular e2e run:
 *   MANUAL_SCREENSHOTS=1 npx playwright test tests/e2e/manual.spec.ts --project desktop --trace off
 * (or `npm run manual:screenshots` after `npm run build`).
 */
test.skip(!process.env.MANUAL_SCREENSHOTS, "set MANUAL_SCREENSHOTS=1 to regenerate the manual's screenshots");
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: "nl-NL" });

const uid = () => randomBytes(4).toString("hex");
const shot = (page: import("@playwright/test").Page, name: string) => page.screenshot({ path: `docs/manual/${name}.png` });

test("manual screenshots", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/register");
  await page.getByLabel("Naam organisatie").fill("Handelmaatschappij Saramacca NV");
  await page.getByLabel("Uw naam").fill("A. Handleiding");
  await page.getByLabel("E-mailadres").fill(`handleiding-${uid()}@example.test`);
  await page.getByLabel("Wachtwoord").fill("een lang voorbeeld wachtwoord");
  await shot(page, "02-registreren");
  await page.getByRole("button", { name: "Account aanmaken" }).click();
  await page.getByLabel("Naam", { exact: true }).fill("Handelmaatschappij Saramacca NV");
  await shot(page, "04-inrichting");
  await page.getByRole("button", { name: "Volgende" }).click();
  await page.getByLabel("Eerste boekjaar").fill(String(new Date().getUTCFullYear()));
  await page.getByRole("button", { name: "Administratie aanmaken" }).click();
  await page.waitForURL(/\/app$/);
  await shot(page, "05-dashboard");
  for (const [path, name] of [
    ["/app/ledger/entries/new", "09-journaalpost"],
    ["/app/scan", "13-scan"],
    ["/app/banking", "15-bank"],
    ["/app/reports", "20-rapportage"],
    ["/app/tax", "21-belastingen"],
    ["/app/year-end", "22-jaarafsluiting"],
  ] as const) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await shot(page, name);
  }
});
