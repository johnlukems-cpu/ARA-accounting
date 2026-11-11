import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";

const uid = () => randomBytes(4).toString("hex");

async function invoicePdf(no: string) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  ["Kantoorhandel Wanica N.V.", "FACTUUR", `Factuurnummer: ${no}`, "Factuurdatum: 05-03-2026", "Subtotaal: SRD 500,00", "BTW 10%: SRD 50,00", "Totaal te betalen: SRD 550,00"]
    .forEach((l, i) => page.drawText(l, { x: 50, y: 790 - i * 18, size: 11, font }));
  return Buffer.from(await pdf.save());
}

test("workflow 2 (scan): upload a PDF invoice, review the suggestions, create the purchase invoice; automation page", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Naam organisatie").fill(`Scan ${uid()}`);
  await page.getByLabel("Uw naam").fill("Scan Test");
  await page.getByLabel("E-mailadres").fill(`s-${uid()}@example.test`);
  await page.getByLabel("Wachtwoord").fill("een lang test wachtwoord");
  await page.getByRole("button", { name: "Account aanmaken" }).click();
  await page.getByLabel("Naam", { exact: true }).fill("Scanklant NV");
  await page.getByRole("button", { name: "Volgende" }).click();
  await page.getByLabel("Eerste boekjaar").fill("2026");
  await page.getByRole("button", { name: "Administratie aanmaken" }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/app/relations/new");
  await page.getByLabel("Code", { exact: true }).fill("L-KW");
  await page.getByLabel("Naam", { exact: true }).fill("Kantoorhandel Wanica N.V.");
  await page.getByLabel("Klant").uncheck();
  await page.getByLabel("Leverancier").check();
  await page.getByRole("button", { name: "Relatie opslaan" }).click();
  await expect(page.getByRole("heading", { name: "Kantoorhandel Wanica N.V." })).toBeVisible();

  await page.getByRole("link", { name: "ARA Scan" }).click();
  await page.getByLabel("Bestanden kiezen").setInputFiles({ name: "factuur-kw.pdf", mimeType: "application/pdf", buffer: await invoicePdf("KW-77") });
  await expect(page.getByText("1 bestand(en) gekozen")).toBeVisible();
  await page.getByRole("button", { name: "Uploaden" }).click();
  await expect(page.getByRole("heading", { name: "factuur-kw.pdf" })).toBeVisible();

  await expect(page.getByRole("row", { name: /Factuurnummer KW-77/ })).toBeVisible();
  await expect(page.getByLabel("Factuurnummer leverancier")).toHaveValue("KW-77");
  await expect(page.getByLabel("Bedrag excl. BTW")).toHaveValue("500,00");
  await expect(page.getByLabel("Leverancier", { exact: true })).not.toHaveValue(""); // recognised by name
  await page.getByLabel("Rekening", { exact: true }).selectOption({ label: "4200 · Kantoorkosten" });
  await page.getByLabel("BTW", { exact: true }).selectOption({ label: "BTW10 · BTW algemeen tarief 10%" });
  await page.getByRole("button", { name: "Inkoopfactuur maken" }).click();
  await expect(page).toHaveURL(/\/app\/purchase\/[a-z0-9]+$/);
  await expect(page.getByText("550,00").first()).toBeVisible();

  await page.goto("/app/scan?status=PROCESSED");
  await expect(page.getByRole("link", { name: "factuur-kw.pdf" })).toBeVisible();

  await page.getByRole("link", { name: "Automatisering en AI" }).click();
  await expect(page.getByText("niet ingesteld (geen API-sleutel)")).toBeVisible();
  await page.getByLabel("Naam", { exact: true }).fill("Kantoorartikelen");
  await page.getByLabel("Leverancier", { exact: true }).selectOption({ index: 1 });
  await page.getByLabel("Rekening", { exact: true }).selectOption({ label: "4200 · Kantoorkosten" });
  await page.getByLabel("Modus").selectOption("DRAFT");
  await page.getByRole("button", { name: "Regel opslaan" }).click();
  await expect(page.getByText("Regel opgeslagen.")).toBeVisible();
  await expect(page.getByRole("row", { name: /Kantoorartikelen/ })).toContainText("Concept ter goedkeuring");
});
