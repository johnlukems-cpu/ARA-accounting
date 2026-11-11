import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";

const uid = () => randomBytes(4).toString("hex");

test("workflow 7 (UI): start the year-end, run checks, post a period-13 adjustment, complete items, submit is guarded", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Naam organisatie").fill(`Jaar ${uid()}`);
  await page.getByLabel("Uw naam").fill("Jaar Test");
  await page.getByLabel("E-mailadres").fill(`j-${uid()}@example.test`);
  await page.getByLabel("Wachtwoord").fill("een lang test wachtwoord");
  await page.getByRole("button", { name: "Account aanmaken" }).click();
  await page.getByLabel("Naam", { exact: true }).fill("Jaarbedrijf NV");
  await page.getByRole("button", { name: "Volgende" }).click();
  await page.getByLabel("Eerste boekjaar").fill("2026");
  await page.getByRole("button", { name: "Administratie aanmaken" }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.getByRole("link", { name: "Jaarafsluiting" }).click();
  await expect(page.getByRole("heading", { name: "Jaarafsluiting 2026" })).toBeVisible();
  await page.getByRole("button", { name: "Jaarafsluiting starten" }).click();
  await expect(page.getByRole("row", { name: /Periodes 1–12 afgesloten/ })).toContainText("open periodes (12)");
  await expect(page.getByRole("row", { name: /Proefbalans in evenwicht/ })).toContainText("in orde");

  // A manual item needs nothing but a click; an automatic item whose check fails is refused.
  await page.getByRole("row", { name: /Kas geteld en aangesloten/ }).getByRole("button", { name: "Afronden" }).click();
  await expect(page.getByRole("row", { name: /Kas geteld en aangesloten/ })).toContainText("Afgerond");
  await page.getByRole("row", { name: /Periodes 1–12 afgesloten/ }).getByRole("button", { name: "Afronden" }).click();
  await expect(page.getByText(/De automatische controle slaagt nog niet/)).toBeVisible();

  await page.getByLabel("Debet", { exact: true }).selectOption({ label: "4900 · Overige bedrijfskosten" });
  await page.getByLabel("Credit", { exact: true }).selectOption({ label: "1910 · Vraagposten" });
  await page.getByLabel("Bedrag", { exact: true }).fill("125");
  await page.getByLabel("Omschrijving", { exact: true }).fill("Nagekomen kosten");
  await page.getByRole("button", { name: "Correctie boeken" }).click();
  await expect(page.getByText("Correctie geboekt.")).toBeVisible();
  await expect(page.getByRole("row", { name: /Tussen- en vraagposten nul/ })).toContainText("saldo niet nul");

  await page.getByRole("button", { name: "Indienen ter goedkeuring" }).click();
  await expect(page.getByText(/verplicht\(e\) punt\(en\) open\./).first()).toBeVisible();
});
