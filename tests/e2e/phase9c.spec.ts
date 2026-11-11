import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";

const uid = () => randomBytes(4).toString("hex");

test("workflow 9 (UI): draft annual accounts with notes and PDF", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Naam organisatie").fill(`JR ${uid()}`);
  await page.getByLabel("Uw naam").fill("JR Test");
  await page.getByLabel("E-mailadres").fill(`a-${uid()}@example.test`);
  await page.getByLabel("Wachtwoord").fill("een lang test wachtwoord");
  await page.getByRole("button", { name: "Account aanmaken" }).click();
  await page.getByLabel("Naam", { exact: true }).fill("Jaarrekening NV");
  await page.getByRole("button", { name: "Volgende" }).click();
  await page.getByLabel("Eerste boekjaar").fill("2026");
  await page.getByRole("button", { name: "Administratie aanmaken" }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/app/ledger/entries/new");
  await page.getByLabel("Boekdatum").fill("2026-02-10");
  await page.getByLabel("Omschrijving", { exact: true }).fill("Omzet");
  await page.getByLabel("Rekening 1").selectOption({ label: "1340 · Overige vorderingen" });
  await page.getByLabel("Debet 1").fill("4000");
  await page.getByLabel("Rekening 2").selectOption({ label: "8010 · Omzet BTW 10%" });
  await page.getByLabel("Credit 2").fill("4000");
  await page.getByRole("button", { name: "Opslaan en boeken" }).click();
  await expect(page).toHaveURL(/\/app\/ledger\/entries\/(?!new)[a-z0-9]+$/);

  await page.getByRole("link", { name: "Jaarrekening", exact: true }).click();
  await expect(page.getByText(/Het boekjaar is nog niet afgesloten/)).toBeVisible();
  await page.getByRole("button", { name: "Genereren" }).click();
  await expect(page.getByText("Jaarrekening gegenereerd.")).toBeVisible();
  await expect(page.getByText("Balans sluit", { exact: true })).toBeVisible();

  const subsequent = page.getByLabel("Gebeurtenissen na balansdatum");
  await subsequent.fill("Na balansdatum is een nieuwe vestiging in Nickerie geopend.");
  await subsequent.locator("xpath=ancestor::form").getByRole("button", { name: "Opslaan" }).click();
  await expect(page.getByText("Opgeslagen.").first()).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "PDF downloaden" }).click();
  expect((await download).suggestedFilename()).toBe("jaarrekening-HOOFD-2026-concept.pdf");
});
