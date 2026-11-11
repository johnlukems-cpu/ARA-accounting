import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

/** Platform administration (production readiness): plans with preview, compliance, bank formats, readiness dashboard. */
const uid = () => randomBytes(4).toString("hex");

test("platform admin configures a plan, sees the customer preview and the readiness dashboard", async ({ page }) => {
  const email = `pa-${uid()}@example.test`;
  await page.goto("/register");
  await page.getByLabel("Naam organisatie").fill(`Platform ${uid()}`);
  await page.getByLabel("Uw naam").fill("Platform Beheerder");
  await page.getByLabel("E-mailadres").fill(email);
  await page.getByLabel("Wachtwoord").fill("een lang test wachtwoord");
  await page.getByRole("button", { name: "Account aanmaken" }).click();
  await page.getByLabel("Naam", { exact: true }).fill("Platform NV");
  await page.getByRole("button", { name: "Volgende" }).click();
  await page.getByLabel("Eerste boekjaar").fill(String(new Date().getUTCFullYear()));
  await page.getByRole("button", { name: "Administratie aanmaken" }).click();
  await expect(page).toHaveURL(/\/app$/);
  const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL ?? "postgresql://ara:ara_dev@localhost:5432/ara_accounting_test" });
  await db.user.update({ where: { email }, data: { isPlatformAdmin: true } });
  await db.$disconnect();

  await page.goto("/app/platform/plans");
  await expect(page.getByRole("heading", { name: "Voorbeeld voor klanten" })).toBeVisible();
  const code = `E2E${uid().slice(0, 4).toUpperCase()}`;
  const form = page.locator("details").filter({ hasText: "Pakket toevoegen" }).last();
  await form.locator("summary").click();
  await form.getByLabel("Code").fill(code);
  await form.getByLabel("Naam", { exact: true }).fill(`Pakket ${code}`);
  await form.getByLabel("Prijs per jaar (USD)").fill("480");
  await form.getByRole("button", { name: "Pakket toevoegen" }).click();
  await expect(page.getByRole("row", { name: new RegExp(code) })).toBeVisible();
  const card = page.locator("article").filter({ hasText: `Pakket ${code}` });
  await expect(card).toContainText("Prijs op aanvraag"); // no monthly price set → never invented
  await expect(card).toContainText("per jaar");

  for (const [path, heading] of [["/app/platform/compliance", "Complianceregister"], ["/app/platform/bank-formats", "Dekking per bank"], ["/app/platform/readiness", "Configuratiecontrole"]] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  }
  await expect(page.getByRole("status").filter({ hasText: "Algemene beschikbaarheid" })).toContainText("Niet gereed");
});
