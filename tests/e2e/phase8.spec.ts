import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";

const uid = () => randomBytes(4).toString("hex");

test("workflow 6: P&L, balance sheet, cash flow, KPIs and forecast; PDF and CSV export", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Naam organisatie").fill(`Rapport ${uid()}`);
  await page.getByLabel("Uw naam").fill("Rapport Test");
  await page.getByLabel("E-mailadres").fill(`r-${uid()}@example.test`);
  await page.getByLabel("Wachtwoord").fill("een lang test wachtwoord");
  await page.getByRole("button", { name: "Account aanmaken" }).click();
  await page.getByLabel("Naam", { exact: true }).fill("Rapportbedrijf NV");
  await page.getByRole("button", { name: "Volgende" }).click();
  await page.getByLabel("Eerste boekjaar").fill("2026");
  await page.getByRole("button", { name: "Administratie aanmaken" }).click();
  await expect(page).toHaveURL(/\/app$/);

  const book = async (date: string, debit: string, credit: string, amount: string, text: string) => {
    await page.goto("/app/ledger/entries/new");
    await page.getByLabel("Boekdatum").fill(date);
    await page.getByLabel("Omschrijving", { exact: true }).fill(text);
    await page.getByLabel("Rekening 1").selectOption({ label: debit });
    await page.getByLabel("Debet 1").fill(amount);
    await page.getByLabel("Rekening 2").selectOption({ label: credit });
    await page.getByLabel("Credit 2").fill(amount);
    await page.getByRole("button", { name: "Opslaan en boeken" }).click();
    await expect(page).toHaveURL(/\/app\/ledger\/entries\/(?!new)[a-z0-9]+$/);
  };
  await book("2026-01-15", "1340 · Overige vorderingen", "8010 · Omzet BTW 10%", "8000", "Omzet januari");
  await book("2026-01-20", "4100 · Huur", "1620 · Nog te betalen kosten", "2000", "Huur januari");

  await page.getByRole("link", { name: "Rapportage" }).click();
  await expect(page.getByRole("heading", { name: "Financiële rapportage" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Netto-omzet/ })).toContainText("8.000,00");
  await expect(page.getByRole("row", { name: /Netto resultaat/ })).toContainText("6.000,00");

  await page.getByRole("link", { name: "Balans", exact: true }).click();
  await expect(page.getByText("Balans sluit", { exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: /Resultaat lopend boekjaar/ })).toContainText("6.000,00");

  await page.getByRole("link", { name: "Kasstroomoverzicht" }).click();
  await expect(page.getByText("Sluit aan op de mutatie liquide middelen")).toBeVisible();

  await page.getByRole("link", { name: "Kengetallen" }).click();
  await expect(page.getByRole("row", { name: /Nettomarge/ })).toContainText("75,0%");
  await expect(page.getByRole("row", { name: /Omloopsnelheid voorraad/ })).toContainText("n.v.t.");

  await page.getByRole("link", { name: "Winst-en-verliesrekening" }).click();
  await expect(page).toHaveURL(/view=pl/);
  const pdf = page.waitForEvent("download");
  await page.getByRole("link", { name: "PDF", exact: true }).click();
  expect((await pdf).suggestedFilename()).toMatch(/^pl-HOOFD-2026-p1-12\.pdf$/);
  const csv = page.waitForEvent("download");
  await page.getByRole("link", { name: "CSV", exact: true }).click();
  expect((await csv).suggestedFilename()).toMatch(/\.csv$/);

  await page.getByRole("link", { name: "Liquiditeitsprognose" }).click();
  await expect(page.getByText("Kas en bank vandaag (werkelijk)")).toBeVisible();
});
