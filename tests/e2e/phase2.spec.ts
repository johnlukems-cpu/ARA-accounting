import { expect, test, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";

const uid = () => randomBytes(4).toString("hex");

async function setup(page: Page) {
  await page.goto("/register");
  await page.getByLabel("Naam organisatie").fill(`Boek ${uid()}`);
  await page.getByLabel("Uw naam").fill("Boekhouder Test");
  await page.getByLabel("E-mailadres").fill(`gl-${uid()}@example.test`);
  await page.getByLabel("Wachtwoord").fill("een lang test wachtwoord");
  await page.getByRole("button", { name: "Account aanmaken" }).click();
  await page.getByLabel("Naam", { exact: true }).fill("Grootboek NV");
  await page.getByRole("button", { name: "Volgende" }).click();
  await page.getByLabel("Eerste boekjaar").fill("2026");
  await page.getByRole("button", { name: "Administratie aanmaken" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

test("enter and post a journal entry, see it in the trial balance and general ledger, then reverse it", async ({ page }) => {
  await setup(page);
  await page.getByRole("link", { name: "Journaalposten" }).first().click();
  await page.getByRole("link", { name: "Nieuwe post" }).click();

  await page.getByLabel("Boekdatum").fill("2026-03-15");
  await page.getByLabel("Omschrijving", { exact: true }).fill("Huur maart");
  await page.getByLabel("Rekening 1").selectOption({ label: "4100 · Huur" });
  await page.getByLabel("Debet 1").fill("4500");
  await page.getByLabel("Rekening 2").selectOption({ label: "1910 · Vraagposten" });
  await page.getByLabel("Credit 2").fill("4000");
  await expect(page.getByText("Verschil: SRD 500,00")).toBeVisible();
  await page.getByLabel("Credit 2").fill("4500");
  await expect(page.getByText("De post is in balans.")).toBeVisible();

  await page.getByRole("button", { name: "Opslaan en boeken" }).click();
  await expect(page.getByRole("heading", { name: /^MEM-2026-00001$/ })).toBeVisible();
  await expect(page.getByText("Geboekt", { exact: true }).first()).toBeVisible();

  await page.goto("/app/ledger/trial-balance");
  await expect(page.getByText("In balans")).toBeVisible();
  const rent = page.getByRole("row", { name: /4100 Huur/ });
  await expect(rent).toContainText("4.500,00");
  await rent.getByRole("link", { name: "4100" }).click();
  await expect(page.getByRole("heading", { name: "Grootboekkaart" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Eindsaldo/ })).toContainText("4.500,00 D");

  // Reverse from the entry page.
  await page.getByRole("link", { name: "MEM-2026-00001" }).click();
  await page.getByLabel("Datum tegenboeking").fill("2026-03-31");
  await page.getByLabel("Reden").fill("Dubbel geboekt");
  await page.getByRole("button", { name: "Uitvoeren" }).click();
  await expect(page.getByRole("heading", { name: "MEM-2026-00002" })).toBeVisible();
  await expect(page.getByText("Tegenboeking van")).toBeVisible();

  // After the reversal the movements remain visible, but the balance is zero.
  await page.goto("/app/ledger/trial-balance");
  await expect(page.getByText("In balans")).toBeVisible();
  await page.getByRole("row", { name: /4100 Huur/ }).getByRole("link", { name: "4100" }).click();
  await expect(page.getByRole("row", { name: /Eindsaldo/ })).toContainText("0,00");

  // Export works and is a CSV file.
  await page.goto("/app/ledger/trial-balance?hideZero=0");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Exporteren (CSV)" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^proefbalans-HOOFD-2026/);
});

test("an unbalanced entry is refused with a clear message", async ({ page }) => {
  await setup(page);
  await page.goto("/app/ledger/entries/new");
  await page.getByLabel("Boekdatum").fill("2026-02-10");
  await page.getByLabel("Omschrijving", { exact: true }).fill("Fout");
  await page.getByLabel("Rekening 1").selectOption({ label: "4200 · Kantoorkosten" });
  await page.getByLabel("Debet 1").fill("100");
  await page.getByLabel("Rekening 2").selectOption({ label: "1910 · Vraagposten" });
  await page.getByLabel("Credit 2").fill("90");
  await page.getByRole("button", { name: "Opslaan als concept" }).click();
  await expect(page.getByText(/De post is niet in balans/)).toBeVisible();
});
