import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";

const uid = () => randomBytes(4).toString("hex");

test("workflow 8 (UI): BTW return from a posted invoice, reconciled, with the verification warning and four-eyes approval", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Naam organisatie").fill(`BTW ${uid()}`);
  await page.getByLabel("Uw naam").fill("BTW Test");
  await page.getByLabel("E-mailadres").fill(`t-${uid()}@example.test`);
  await page.getByLabel("Wachtwoord").fill("een lang test wachtwoord");
  await page.getByRole("button", { name: "Account aanmaken" }).click();
  await page.getByLabel("Naam", { exact: true }).fill("BTW Bedrijf NV");
  await page.getByRole("button", { name: "Volgende" }).click();
  await page.getByLabel("Eerste boekjaar").fill("2026");
  await page.getByRole("button", { name: "Administratie aanmaken" }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/app/relations/new");
  await page.getByLabel("Code", { exact: true }).fill("K001");
  await page.getByLabel("Naam", { exact: true }).fill("Klant Saramacca NV");
  await page.getByLabel("Standaard BTW-code").selectOption({ label: "BTW10 · BTW algemeen tarief 10%" });
  await page.getByLabel("Standaard omzetrekening").selectOption({ label: "8010 · Omzet BTW 10%" });
  await page.getByRole("button", { name: "Relatie opslaan" }).click();
  await expect(page.getByRole("heading", { name: "Klant Saramacca NV" })).toBeVisible();
  await page.goto("/app/sales/new");
  await page.getByLabel("Klant").selectOption({ index: 1 });
  await page.getByLabel("Factuurdatum").fill("2026-03-02");
  await page.getByLabel("Omschrijving 1").fill("Advies");
  await page.getByLabel("Prijs 1").fill("2000");
  await page.getByRole("button", { name: "Opslaan en boeken" }).click();
  await expect(page.getByRole("heading", { name: /Factuur VF2026-00001/ })).toBeVisible();

  await page.getByRole("link", { name: "Belastingen" }).click();
  await expect(page.getByText(/Geen van de belastingregels is al geverifieerd/)).toBeVisible();
  await page.getByLabel("Maand", { exact: true }).fill("2026-03");
  await page.getByRole("button", { name: "BTW-aangifte opstellen" }).click();
  await expect(page.getByRole("heading", { name: /BTW-aangifte/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /BTW10/ })).toContainText("200,00");
  await expect(page.getByText("Sluit aan", { exact: true })).toBeVisible();
  await expect(page.getByText(/Let op: deze berekening gebruikt een regel/)).toBeVisible();
  await expect(page.getByText("Een collega met goedkeuringsrecht moet deze aangifte goedkeuren.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Goedkeuren en boeken" })).toHaveCount(0);
});
