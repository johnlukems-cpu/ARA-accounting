import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";

const uid = () => randomBytes(4).toString("hex");

test("workflow 1: new administration from the construction template; own template built, published and exported", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Naam organisatie").fill(`Bouw ${uid()}`);
  await page.getByLabel("Uw naam").fill("Bouw Test");
  await page.getByLabel("E-mailadres").fill(`w-${uid()}@example.test`);
  await page.getByLabel("Wachtwoord").fill("een lang test wachtwoord");
  await page.getByRole("button", { name: "Account aanmaken" }).click();
  await page.getByLabel("Naam", { exact: true }).fill("Bouwbedrijf Wanica NV");
  await page.getByRole("button", { name: "Volgende" }).click();
  await page.getByLabel("Eerste boekjaar").fill("2026");
  await page.getByLabel("Branchesjabloon").selectOption({ label: "Bouw en aannemerij" });
  await page.getByRole("button", { name: "Administratie aanmaken" }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/app/ledger/accounts");
  await expect(page.getByText("Opbrengst aanneming")).toBeVisible();
  await expect(page.getByText("Retentievorderingen")).toBeVisible();

  // The administration shows which template version it was built from.
  await page.getByRole("link", { name: "Administratie", exact: true }).click();
  await expect(page.getByRole("link", { name: /Bouw en aannemerij · v1/ })).toBeVisible();

  // Own template
  await page.getByRole("link", { name: "Branchesjablonen" }).click();
  await expect(page.getByRole("link", { name: "Visserij" })).toBeVisible();
  await page.getByLabel("Code").fill("BOUWPLUS");
  await page.getByLabel("Naam", { exact: true }).fill("Bouw plus eigen rekeningen");
  await page.getByLabel("Gebaseerd op").selectOption({ label: "Bouw en aannemerij (v1)" });
  await page.getByRole("button", { name: "Sjabloon maken" }).click();
  await expect(page.getByRole("heading", { name: "Bouw plus eigen rekeningen" })).toBeVisible();

  await page.getByLabel("Nummer").fill("8145");
  await page.getByLabel("Naam", { exact: true }).fill("Opbrengst meerwerk");
  await page.getByRole("button", { name: "Toevoegen aan concept" }).click();
  await expect(page.getByRole("row", { name: /8145/ })).toBeVisible();
  await page.getByLabel("Wijzigingen").fill("Meerwerk toegevoegd");
  await page.getByRole("button", { name: "Versie publiceren" }).click();
  await expect(page.getByRole("row", { name: /v1.*Meerwerk toegevoegd/ })).toContainText("Gepubliceerd");

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Exporteren" }).first().click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("BOUWPLUS-v1.json");
});
