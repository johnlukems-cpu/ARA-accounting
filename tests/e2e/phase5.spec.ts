import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const uid = () => randomBytes(4).toString("hex");

test("rates: CBvS import and manual closing rate; USD invoice takes the policy rate; revaluation proposal", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Naam organisatie").fill(`Valuta ${uid()}`);
  await page.getByLabel("Uw naam").fill("Valuta Test");
  await page.getByLabel("E-mailadres").fill(`v-${uid()}@example.test`);
  await page.getByLabel("Wachtwoord").fill("een lang test wachtwoord");
  await page.getByRole("button", { name: "Account aanmaken" }).click();
  await page.getByLabel("Naam", { exact: true }).fill("Exporteur NV");
  await page.getByRole("button", { name: "Volgende" }).click();
  await page.getByLabel("Eerste boekjaar").fill("2026");
  await page.getByRole("button", { name: "Administratie aanmaken" }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.getByRole("link", { name: "Valuta en koersen" }).click();
  const dir = mkdtempSync(join(tmpdir(), "cbvs-"));
  const file = join(dir, "cbvs-maart.csv");
  writeFileSync(file, "datum;valuta;aankoop;verkoop\n02-03-2026;USD;37,8500;38,1500\n");
  await page.getByLabel("Bestand").setInputFiles(file);
  await page.getByRole("button", { name: "Importeren" }).click();
  await expect(page.getByText("Koersen geïmporteerd.")).toBeVisible();
  await expect(page.getByRole("row", { name: /CBvS aankoopkoers/ })).toContainText("37,8500");

  await page.getByLabel("Datum", { exact: true }).fill("2026-03-31");
  await page.locator("form").filter({ has: page.getByRole("button", { name: "Koers opslaan" }) }).getByLabel("Soort koers").selectOption("CLOSING");
  await page.getByLabel("Koers in SRD").fill("38,90");
  await page.getByRole("button", { name: "Koers opslaan" }).click();
  await expect(page.getByText("Koers opgeslagen.")).toBeVisible();

  // USD customer and invoice without a typed rate → CBvS buying rate of 2 March.
  await page.goto("/app/relations/new");
  await page.getByLabel("Code", { exact: true }).fill("K-USD");
  await page.getByLabel("Naam", { exact: true }).fill("Buyer Inc");
  await page.getByLabel("Valuta").selectOption("USD");
  await page.getByLabel("Standaard BTW-code").selectOption({ label: "BTW0 · BTW nultarief (bijlage 1)" });
  await page.getByLabel("Standaard omzetrekening").selectOption({ label: "8030 · Omzet 0% en export" });
  await page.getByRole("button", { name: "Relatie opslaan" }).click();
  await expect(page.getByRole("heading", { name: "Buyer Inc" })).toBeVisible();
  await page.goto("/app/sales/new");
  await page.getByLabel("Klant").selectOption({ index: 1 });
  await page.getByLabel("Factuurdatum").fill("2026-03-04");
  await page.getByLabel("Valuta").selectOption("USD");
  await page.getByLabel("Omschrijving 1").fill("Export hout");
  await page.getByLabel("Prijs 1").fill("1000");
  await page.getByRole("button", { name: "Opslaan en boeken" }).click();
  await expect(page.getByRole("heading", { name: /Factuur VF2026-00001/ })).toBeVisible();
  await expect(page.getByText("37,85", { exact: false }).first()).toBeVisible();

  // Revaluation preview for March: 1,000 USD × (38.90 − 37.85) = SRD 1,050.
  await page.goto("/app/currency");
  await page.getByRole("combobox", { name: /Periode/ }).selectOption({ index: 3 });
  await page.getByRole("button", { name: "Berekenen" }).click();
  await expect(page.getByRole("row", { name: /1310/ })).toContainText("1.050,00");
  await page.getByRole("button", { name: "Voorstel maken" }).click();
  await expect(page.getByRole("row", { name: /Voorstel/ })).toContainText("1.050,00");
});
