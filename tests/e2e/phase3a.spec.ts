import { expect, test, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";

const uid = () => randomBytes(4).toString("hex");

async function setup(page: Page) {
  await page.goto("/register");
  await page.getByLabel("Naam organisatie").fill(`Handel ${uid()}`);
  await page.getByLabel("Uw naam").fill("Verkoper Test");
  await page.getByLabel("E-mailadres").fill(`s-${uid()}@example.test`);
  await page.getByLabel("Wachtwoord").fill("een lang test wachtwoord");
  await page.getByRole("button", { name: "Account aanmaken" }).click();
  await page.getByLabel("Naam", { exact: true }).fill("Paramaribo Groothandel NV");
  await page.getByLabel("BTW-nummer").fill("BTW-123456");
  await page.getByRole("button", { name: "Volgende" }).click();
  await page.getByLabel("Eerste boekjaar").fill("2026");
  await page.getByRole("button", { name: "Administratie aanmaken" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function addRelation(page: Page, name: string, supplier = false) {
  await page.goto("/app/relations/new");
  if (supplier) {
    await page.getByLabel("Klant", { exact: true }).uncheck();
    await page.getByLabel("Leverancier", { exact: true }).check();
  }
  await page.getByLabel("Code", { exact: true }).fill(`R${uid().slice(0, 5)}`);
  await page.getByLabel("Naam", { exact: true }).fill(name);
  await page.getByLabel("Standaard BTW-code").selectOption({ label: "BTW10 · BTW algemeen tarief 10%" });
  if (!supplier) await page.getByLabel("Standaard omzetrekening").selectOption({ label: "8010 · Omzet BTW 10%" });
  else await page.getByLabel("Standaard kostenrekening").selectOption({ label: "4200 · Kantoorkosten" });
  await page.getByRole("button", { name: "Relatie opslaan" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

test("sales invoice with BTW: post, PDF, partial payment, aging", async ({ page }) => {
  await setup(page);
  await addRelation(page, "Klant Wanica NV");

  await page.goto("/app/sales/new");
  await page.getByLabel("Klant").selectOption({ index: 1 });
  await page.getByLabel("Factuurdatum").fill("2026-03-10");
  await page.getByLabel("Omschrijving 1").fill("Levering rijst 50 zakken");
  await page.getByLabel("Aantal 1").fill("50");
  await page.getByLabel("Prijs 1").fill("120");
  await expect(page.getByText("SRD 6.600,00")).toBeVisible(); // 6.000 + 10% BTW
  await page.getByRole("button", { name: "Opslaan en boeken" }).click();
  await expect(page.getByRole("heading", { name: "Factuur VF2026-00001" })).toBeVisible();
  await expect(page.getByText("Geboekt", { exact: true })).toBeVisible();

  const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "PDF downloaden" }).click()]);
  expect(pdf.suggestedFilename()).toBe("VF2026-00001.pdf");
  const bytes = await (await pdf.createReadStream()).toArray();
  expect(Buffer.concat(bytes).subarray(0, 5).toString()).toBe("%PDF-");

  // Partial payment in cash.
  await page.getByLabel("Bedrag").fill("2600");
  await page.getByLabel("Betaaldatum").fill("2026-03-20");
  await page.getByRole("button", { name: "Betaling registreren" }).click();
  await expect(page.getByText("Betaling geregistreerd en geboekt.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Deels betaald")).toBeVisible();
  await expect(page.getByText("Openstaand: SRD 4.000,00")).toBeVisible();

  await page.goto("/app/receivables?asOf=2026-05-15");
  await expect(page.getByText("Sluit aan op grootboek")).toBeVisible();
  await expect(page.getByRole("row", { name: /Klant Wanica NV/ })).toContainText("4.000,00");

  // Sending without SMTP is refused honestly.
  await page.goto("/app/sales");
  await page.getByRole("link", { name: "VF2026-00001" }).click();
  await page.getByLabel("E-mailadres").fill("klant@example.test");
  await page.getByRole("button", { name: "Versturen" }).click();
  await expect(page.getByText("E-mail versturen is niet ingesteld.", { exact: false })).toBeVisible();
});

test("purchase invoice: register, duplicate refused, submit for approval", async ({ page }) => {
  await setup(page);
  await addRelation(page, "Kantoorhuis Suriname NV", true);
  const fill = async () => {
    await page.goto("/app/purchase/new");
    await page.getByLabel("Leverancier", { exact: true }).selectOption({ index: 1 });
    await page.getByLabel("Factuurnummer leverancier").fill("KH-2026-0042");
    await page.getByLabel("Factuurdatum").fill("2026-04-02");
    await page.getByLabel("Omschrijving 1").fill("Printpapier");
    await page.getByLabel("Prijs 1").fill("850");
    await page.getByRole("button", { name: "Opslaan als concept" }).click();
  };
  await fill();
  await expect(page.getByRole("heading", { name: "Factuur Concept" })).toBeVisible();
  await page.getByRole("button", { name: "Indienen" }).click();
  await expect(page.getByText("Ter controle", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Goedkeuren" })).toBeVisible();
  await fill();
  await expect(page.getByText("Dit factuurnummer van deze leverancier is al geregistreerd.")).toBeVisible();
});
