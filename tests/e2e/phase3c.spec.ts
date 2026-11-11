import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";

const uid = () => randomBytes(4).toString("hex");

test("fixed asset: register, depreciation proposal and withdrawal; current account movement and confirmation", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Naam organisatie").fill(`Activa ${uid()}`);
  await page.getByLabel("Uw naam").fill("Activa Test");
  await page.getByLabel("E-mailadres").fill(`a-${uid()}@example.test`);
  await page.getByLabel("Wachtwoord").fill("een lang test wachtwoord");
  await page.getByRole("button", { name: "Account aanmaken" }).click();
  await page.getByLabel("Naam", { exact: true }).fill("Activaklant NV");
  await page.getByRole("button", { name: "Volgende" }).click();
  await page.getByLabel("Eerste boekjaar").fill("2026");
  await page.getByRole("button", { name: "Administratie aanmaken" }).click();
  await expect(page).toHaveURL(/\/app$/);

  // Fixed asset
  await page.getByRole("link", { name: "Vaste activa" }).click();
  await expect(page.getByRole("heading", { name: "Vaste activa" })).toBeVisible();
  await page.getByLabel("Nummer").fill("VA001");
  await page.getByLabel("Naam", { exact: true }).fill("Pick-up Toyota Hilux");
  await page.getByLabel("Categorie").selectOption({ index: 4 });
  await page.getByLabel("Aanschafdatum").fill("2026-01-10");
  await page.getByLabel("Aanschafwaarde (SRD)").fill("600000");
  await page.getByLabel("Gebruiksduur (maanden)").fill("60");
  await page.getByRole("button", { name: "Registreren" }).click();
  await expect(page.getByText("Activum geregistreerd.")).toBeVisible();
  const row = page.getByRole("row", { name: /VA001/ });
  await expect(row).toContainText("600.000,00");

  await page.getByLabel("Maand", { exact: true }).fill("2026-02");
  await page.getByRole("button", { name: "Voorstel maken" }).click();
  await expect(page.getByText("Afschrijvingsvoorstel aangemaakt")).toBeVisible();
  await expect(page.getByRole("row", { name: /Afschrijvingen 02-2026/ })).toContainText("10.000,00");
  await page.getByRole("button", { name: "Intrekken" }).click();
  await expect(page.getByRole("row", { name: /Afschrijvingen 02-2026/ })).toHaveCount(0);

  await page.getByRole("link", { name: "VA001" }).click();
  await expect(page.getByRole("heading", { name: "VA001 · Pick-up Toyota Hilux" })).toBeVisible();
  await expect(page.getByRole("row", { name: /02-2026/ })).toContainText("10.000,00");

  // Current account
  await page.goto("/app/current-accounts");
  await page.getByLabel("Tegenpartij").fill("Directeur S. Jagroep");
  await page.getByRole("button", { name: "Toevoegen" }).click();
  await expect(page.getByText("Rekening-courant aangemaakt.")).toBeVisible();
  await page.getByRole("link", { name: "Directeur S. Jagroep" }).click();
  await page.getByLabel("Datum", { exact: true }).first().fill("2026-03-05");
  await page.getByLabel("Bedrag", { exact: true }).fill("2500");
  await page.getByLabel("Tegenrekening").selectOption({ label: "1010 · Kas SRD" });
  await page.getByLabel("Omschrijving").fill("Opname uit kas");
  await page.getByRole("button", { name: "Boeken" }).click();
  await expect(page.getByText("Mutatie geboekt.")).toBeVisible();
  await expect(page.getByRole("row", { name: /Opname uit kas/ })).toContainText("2.500,00");

  await page.getByLabel("Bevestigd saldo").fill("2400");
  await page.getByRole("button", { name: "Bevestiging vastleggen" }).click();
  await expect(page.getByText("Bevestiging vastgelegd.")).toBeVisible();
  await expect(page.getByRole("row", { name: /2\.400,00/ })).toContainText("-100,00");
});
