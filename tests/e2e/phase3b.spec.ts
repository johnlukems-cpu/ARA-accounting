import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";

const uid = () => randomBytes(4).toString("hex");

test("bank statement: profile, CSV import, duplicate refused, match suggestion, reconciliation", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Naam organisatie").fill(`Bank ${uid()}`);
  await page.getByLabel("Uw naam").fill("Bank Test");
  await page.getByLabel("E-mailadres").fill(`b-${uid()}@example.test`);
  await page.getByLabel("Wachtwoord").fill("een lang test wachtwoord");
  await page.getByRole("button", { name: "Account aanmaken" }).click();
  await page.getByLabel("Naam", { exact: true }).fill("Bankklant NV");
  await page.getByRole("button", { name: "Volgende" }).click();
  await page.getByLabel("Eerste boekjaar").fill("2026");
  await page.getByRole("button", { name: "Administratie aanmaken" }).click();
  await expect(page).toHaveURL(/\/app$/);

  // Customer + posted invoice of SRD 1.100,00
  await page.goto("/app/relations/new");
  await page.getByLabel("Code", { exact: true }).fill("K001");
  await page.getByLabel("Naam", { exact: true }).fill("Klant Commewijne NV");
  await page.getByLabel("Standaard BTW-code").selectOption({ label: "BTW10 · BTW algemeen tarief 10%" });
  await page.getByLabel("Standaard omzetrekening").selectOption({ label: "8010 · Omzet BTW 10%" });
  await page.getByRole("button", { name: "Relatie opslaan" }).click();
  await page.goto("/app/sales/new");
  await page.getByLabel("Klant").selectOption({ index: 1 });
  await page.getByLabel("Factuurdatum").fill("2026-03-02");
  await page.getByLabel("Omschrijving 1").fill("Advies");
  await page.getByLabel("Prijs 1").fill("1000");
  await page.getByRole("button", { name: "Opslaan en boeken" }).click();
  await expect(page.getByRole("heading", { name: "Factuur VF2026-00001" })).toBeVisible();

  // Bank account
  await page.goto("/app/banking");
  await page.getByLabel("Naam", { exact: true }).fill("DSB zakelijk");
  await page.getByLabel("Bank", { exact: true }).selectOption("DSB");
  await page.getByLabel("Rekeningnummer").fill(`${Date.now()}`.slice(-7));
  await page.getByRole("button", { name: "Toevoegen" }).click();
  await expect(page.getByText("Rekening aangemaakt.")).toBeVisible();
  await page.getByRole("link", { name: "DSB zakelijk" }).click();

  // Column layout: Datum;Omschrijving;Bedrag;Tegenpartij;Referentie
  await page.getByLabel("Kolom tegenpartij").fill("4");
  await page.getByLabel("Kolom referentie").fill("5");
  await page.getByRole("button", { name: "Indeling opslaan" }).click();
  await expect(page.getByLabel("CSV-bestand")).toBeVisible();

  const csv = "Datum;Omschrijving;Bedrag;Tegenpartij;Referentie\n15-03-2026;Betaling VF2026-00001;1.100,00;KLANT COMMEWIJNE;R1\n16-03-2026;Bankkosten;-12,50;;R2\n";
  const file = { name: "dsb-maart.csv", mimeType: "text/csv", buffer: Buffer.from(csv) };
  await page.getByLabel("CSV-bestand").setInputFiles(file);
  await page.getByRole("button", { name: "Importeren" }).click();
  await expect(page.getByText("Afschrift geïmporteerd.")).toBeVisible();
  await page.reload();
  await page.getByLabel("CSV-bestand").setInputFiles(file);
  await page.getByRole("button", { name: "Importeren" }).click();
  await expect(page.getByText("Dit bestand is al geïmporteerd.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("2 te verwerken")).toBeVisible();

  // Match the receipt via the suggestion (100%)
  const receipt = page.locator("li", { hasText: "Betaling VF2026-00001" }).first();
  await receipt.getByText(/^Verwerken/).click();
  await expect(receipt.getByText("100%")).toBeVisible();
  await receipt.getByRole("button", { name: "Toewijzen" }).click();
  await expect(page.getByText("1 te verwerken")).toBeVisible();

  // Book the bank charges
  const fee = page.locator("li", { hasText: "Bankkosten" }).first();
  await fee.getByText(/^Verwerken/).click();
  await fee.getByLabel("Boeken op rekening").selectOption({ label: "9020 · Rentelasten en bankkosten" });
  await fee.getByRole("button", { name: "Boeken", exact: true }).click();
  await expect(page.getByText("Alles is verwerkt.")).toBeVisible();

  // Reconcile: statement 1.087,50 = ledger
  await page.getByLabel("Per datum").fill("2026-03-31");
  await page.getByLabel(/Saldo volgens afschrift/).fill("1087,50");
  await page.getByRole("button", { name: "Aansluiting vastleggen" }).click();
  await expect(page.getByText("Aansluiting vastgelegd.")).toBeVisible();

  await page.goto("/app/sales");
  await expect(page.getByRole("row", { name: /VF2026-00001/ })).toContainText("Betaald");
});
