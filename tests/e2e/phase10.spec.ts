import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";

const uid = () => randomBytes(4).toString("hex");

test("quality monitor: a suspense balance is found, assigned and closed with a note", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Naam organisatie").fill(`Kwal ${uid()}`);
  await page.getByLabel("Uw naam").fill("Kwaliteit Test");
  await page.getByLabel("E-mailadres").fill(`q-${uid()}@example.test`);
  await page.getByLabel("Wachtwoord").fill("een lang test wachtwoord");
  await page.getByRole("button", { name: "Account aanmaken" }).click();
  await page.getByLabel("Naam", { exact: true }).fill("Kwaliteit NV");
  await page.getByRole("button", { name: "Volgende" }).click();
  await page.getByLabel("Eerste boekjaar").fill(String(new Date().getUTCFullYear()));
  await page.getByRole("button", { name: "Administratie aanmaken" }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/app/ledger/entries/new");
  await page.getByLabel("Omschrijving", { exact: true }).fill("Onbekende ontvangst");
  await page.getByLabel("Rekening 1").selectOption({ label: "1910 · Vraagposten" });
  await page.getByLabel("Debet 1").fill("75");
  await page.getByLabel("Rekening 2").selectOption({ label: "8090 · Overige opbrengsten" });
  await page.getByLabel("Credit 2").fill("75");
  await page.getByRole("button", { name: "Opslaan en boeken" }).click();
  await expect(page).toHaveURL(/\/app\/ledger\/entries\/(?!new)[a-z0-9]+$/);

  await page.getByRole("link", { name: "Kwaliteitsmonitor" }).click();
  await page.getByRole("button", { name: "Nu controleren" }).click();
  await expect(page.getByText(/Controle uitgevoerd/)).toBeVisible();
  const row = page.getByRole("row", { name: /Vraagpost niet nul/ });
  await expect(row).toContainText("1910 Vraagposten heeft een saldo van 75.00.");
  await row.getByLabel("Status").selectOption("FALSE_POSITIVE");
  await row.getByRole("button", { name: "Opslaan" }).click();
  await expect(page.getByText("Geef een toelichting bij het afsluiten.")).toBeVisible();
  await row.getByLabel("Status").selectOption("FALSE_POSITIVE"); // the form resets after a failed submit
  await row.getByLabel("Toelichting").fill("Bewust tijdelijk geparkeerd");
  await row.getByRole("button", { name: "Opslaan" }).click();
  await expect(page.getByRole("row", { name: /Vraagpost niet nul/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Afgesloten" }).click();
  await expect(page.getByRole("row", { name: /Vraagpost niet nul/ })).toContainText("Bewust tijdelijk geparkeerd");
});
