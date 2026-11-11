import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";

const uid = () => randomBytes(4).toString("hex");

test("workflow 10 (UI): practice dashboard with tasks; subscription page shows the trial and usage", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Naam organisatie").fill(`Kantoor ${uid()}`);
  await page.getByLabel("Uw naam").fill("Kantoor Test");
  await page.getByLabel("E-mailadres").fill(`k-${uid()}@example.test`);
  await page.getByLabel("Wachtwoord").fill("een lang test wachtwoord");
  await page.getByRole("button", { name: "Account aanmaken" }).click();
  await page.getByLabel("Naam", { exact: true }).fill("Klant Coronie NV");
  await page.getByRole("button", { name: "Volgende" }).click();
  await page.getByLabel("Eerste boekjaar").fill(String(new Date().getUTCFullYear()));
  await page.getByRole("button", { name: "Administratie aanmaken" }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.getByRole("link", { name: "Kantoordashboard" }).click();
  await expect(page.getByRole("row", { name: /Klant Coronie NV/ })).toBeVisible();
  await page.getByLabel("Taak", { exact: true }).fill("Jaarrekening Coronie voorbereiden");
  await page.getByLabel("Klant", { exact: true }).selectOption({ label: "Klant Coronie NV" });
  await page.getByRole("button", { name: "Taak toevoegen" }).click();
  await expect(page.getByRole("row", { name: /Jaarrekening Coronie voorbereiden/ })).toBeVisible();
  await page.getByRole("row", { name: /Jaarrekening Coronie voorbereiden/ }).getByRole("button", { name: "Gereed" }).click();
  await expect(page.getByRole("row", { name: /Jaarrekening Coronie voorbereiden/ }).getByRole("button", { name: "Heropenen" })).toBeVisible();

  await page.getByRole("link", { name: "Abonnement" }).click();
  await expect(page.getByText("Proefperiode", { exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: /Bedrijven/ })).toContainText("onbeperkt");
  // Platform administration is hidden for ordinary users.
  await expect(page.getByRole("link", { name: "Platformbeheer" })).toHaveCount(0);
  await page.goto("/app/platform");
  await expect(page.getByRole("heading", { name: "Platformbeheer" })).toHaveCount(0);
});
