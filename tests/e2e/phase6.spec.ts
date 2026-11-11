import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";

const uid = () => randomBytes(4).toString("hex");

test("workflow 5: budget created, amounts entered and distributed, budget versus actual with alert", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Naam organisatie").fill(`Budget ${uid()}`);
  await page.getByLabel("Uw naam").fill("Budget Test");
  await page.getByLabel("E-mailadres").fill(`b-${uid()}@example.test`);
  await page.getByLabel("Wachtwoord").fill("een lang test wachtwoord");
  await page.getByRole("button", { name: "Account aanmaken" }).click();
  await page.getByLabel("Naam", { exact: true }).fill("Planbedrijf NV");
  await page.getByRole("button", { name: "Volgende" }).click();
  await page.getByLabel("Eerste boekjaar").fill("2026");
  await page.getByRole("button", { name: "Administratie aanmaken" }).click();
  await expect(page).toHaveURL(/\/app$/);

  // An actual cost in January: rent SRD 2.500 (memorial entry against suspense).
  await page.goto("/app/ledger/entries/new");
  await page.getByLabel("Boekdatum").fill("2026-01-31");
  await page.getByLabel("Omschrijving", { exact: true }).fill("Huur januari");
  await page.getByLabel("Rekening 1").selectOption({ label: "4100 · Huur" });
  await page.getByLabel("Debet 1").fill("2500");
  await page.getByLabel("Rekening 2").selectOption({ label: "1910 · Vraagposten" });
  await page.getByLabel("Credit 2").fill("2500");
  await page.getByRole("button", { name: "Opslaan en boeken" }).click();
  await expect(page).toHaveURL(/\/app\/ledger\/entries\/(?!new)[a-z0-9]+$/);

  await page.getByRole("link", { name: "Budgetten" }).click();
  await page.getByLabel("Naam", { exact: true }).fill("Budget 2026");
  await page.getByRole("button", { name: "Budget maken" }).click();
  await expect(page.getByRole("heading", { name: "Budget 2026 · 2026" })).toBeVisible();

  await page.getByLabel("4100 jan").fill("2.000");
  await page.getByRole("button", { name: "Opslaan", exact: true }).click();
  await expect(page.getByText("Opgeslagen.").first()).toBeVisible();
  await page.getByLabel("Rekening", { exact: true }).selectOption({ label: "8010 · Omzet BTW 10%" });
  await page.getByLabel("Jaarbedrag").fill("120.000");
  await page.getByRole("button", { name: "Verdelen" }).click();
  await expect(page.getByLabel("8010 dec")).toHaveValue("10000,00");

  await page.getByRole("link", { name: "Budget vs. werkelijk" }).click();
  await page.getByLabel("Van").selectOption("1");
  await page.getByLabel("Tot en met").selectOption("1");
  await page.getByRole("button", { name: "Tonen" }).click();
  const rent = page.getByRole("row", { name: /4100 Huur/ });
  await expect(rent).toContainText("2.500,00");
  await expect(rent).toContainText("25,0%");
  await expect(rent).toContainText("ongunstig");
  await expect(page.getByText(/rekening\(en\) wijken ongunstig 10% of meer af/)).toBeVisible();

  await page.getByRole("link", { name: "Prognose" }).click();
  await expect(page.getByRole("row", { name: /8010/ })).toContainText("120.000,00");
});
