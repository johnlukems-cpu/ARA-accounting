import { expect, test, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { totp } from "../../src/core/auth/totp";

const uid = () => randomBytes(4).toString("hex");
const PASSWORD = "een lang test wachtwoord";

async function register(page: Page, org: string, email: string, kind: "BUSINESS" | "ACCOUNTING_FIRM" = "BUSINESS") {
  await page.goto("/register");
  await page.getByLabel("Soort organisatie").selectOption(kind);
  await page.getByLabel("Naam organisatie").fill(org);
  await page.getByLabel("Uw naam").fill("Test Eigenaar");
  await page.getByLabel("E-mailadres").fill(email);
  await page.getByLabel("Wachtwoord").fill(PASSWORD);
  await page.getByRole("button", { name: "Account aanmaken" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
}

async function onboard(page: Page, company: string) {
  await page.getByLabel("Naam", { exact: true }).fill(company);
  await page.getByLabel("KKF-nummer").fill(`KKF-${uid()}`);
  await page.getByLabel("District").selectOption("PARAMARIBO");
  await page.getByRole("button", { name: "Volgende" }).click();
  await expect(page.getByRole("heading", { name: "Administratie en boekjaar" })).toBeVisible();
  await page.getByLabel("Eerste boekjaar").fill("2026");
  await page.getByRole("button", { name: "Administratie aanmaken" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

test("register → company → administration → dashboard, switch administration, invite, audit", async ({ page }) => {
  const email = `e2e-${uid()}@example.test`;
  await register(page, `Handel ${uid()} NV`, email);
  await onboard(page, "Paramaribo Handel NV");

  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Periodes boekjaar 2026")).toBeVisible();
  await expect(page.getByText("0 · Opening")).toBeVisible();
  await expect(page.getByText("13 · Jaarafsluiting")).toBeVisible();

  // A second administration in USD with a deviating fiscal year; switching loads its own environment.
  await page.getByRole("link", { name: "Bedrijven" }).first().click();
  await page.getByRole("link", { name: "Paramaribo Handel NV" }).click();
  await page.getByText("Administratie toevoegen").click();
  await page.getByLabel("Naam administratie").fill("USD-administratie");
  await page.getByLabel("Code").first().fill("USD");
  await page.getByLabel("Basisvaluta").selectOption("USD");
  await page.getByLabel("Boekjaar begint in").selectOption("7");
  await page.getByRole("button", { name: "Administratie aanmaken" }).click();
  await expect(page.getByRole("heading", { name: "USD · USD-administratie" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Boekjaar 2026/2027" })).toBeVisible();

  const switched = page.waitForResponse((r) => r.request().method() === "POST" && r.status() === 200);
  await page.getByLabel("Administratie", { exact: true }).selectOption({ label: "HOOFD · Hoofdadministratie (SRD)" });
  await switched;
  await page.goto("/app");
  await expect(page.getByText("Periodes boekjaar 2026", { exact: true })).toBeVisible();

  // Close January, then reopening requires a reason.
  await page.getByRole("link", { name: "Beheren" }).click();
  const jan = page.getByRole("row", { name: /Periode 1\b/ });
  await jan.getByLabel("Status").selectOption("CLOSED");
  await jan.getByRole("button", { name: "Toepassen" }).click();
  await expect(jan.locator("span", { hasText: /^Afgesloten$/ })).toBeVisible();
  await jan.getByLabel("Status").selectOption("OPEN");
  await jan.getByRole("button", { name: "Toepassen" }).click();
  await expect(jan.getByText("Geef een reden op voor het heropenen.")).toBeVisible();

  // Invite a bookkeeper: without e-mail configuration a one-time activation link is shown.
  await page.goto("/app/users");
  await page.getByLabel("Naam", { exact: true }).fill("Boekhouder Test");
  await page.getByLabel("E-mailadres").fill(`bk-${uid()}@example.test`);
  await page.getByLabel("Rol").last().selectOption("BOOKKEEPER");
  await page.getByRole("button", { name: "Uitnodigen" }).click();
  await expect(page.getByText("Activeringslink")).toBeVisible();

  await page.goto("/app/audit");
  await expect(page.getByText(/Keten intact/)).toBeVisible();
  await expect(page.getByText("administration.created").first()).toBeVisible();
});

test("two-step verification: set up, then required at sign-in", async ({ page }) => {
  const email = `mfa-${uid()}@example.test`;
  await register(page, `MFA ${uid()}`, email);
  await onboard(page, "MFA Bedrijf NV");
  // Owners must set up 2FA (organisation default): the app shows the requirement.
  await expect(page.getByText("Uw organisatie vereist verificatie in twee stappen")).toBeVisible();

  await page.goto("/app/account");
  await page.getByRole("button", { name: "Instellen" }).click();
  const secret = (await page.locator("code").first().textContent())!.trim();
  await page.getByLabel("Verificatiecode").fill(totp(secret));
  await page.getByRole("button", { name: "Activeren" }).click();
  await expect(page.getByText("Herstelcodes", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Uitloggen" }).first().click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("E-mailadres").fill(email);
  await page.getByLabel("Wachtwoord").fill(PASSWORD);
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(page).toHaveURL(/\/login\/mfa/);
  await page.getByLabel("Verificatiecode").fill("000000");
  await page.getByRole("button", { name: "Bevestigen" }).click();
  await expect(page.getByText("De code is onjuist of verlopen.")).toBeVisible();
  await page.getByLabel("Verificatiecode").fill(totp(secret));
  await page.getByRole("button", { name: "Bevestigen" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Uw organisatie vereist verificatie in twee stappen")).toHaveCount(0);
});

test("another organisation cannot open a company by URL", async ({ browser }) => {
  const a = await browser.newPage();
  await register(a, `Org A ${uid()}`, `a-${uid()}@example.test`);
  await onboard(a, "Bedrijf van A");
  await a.goto("/app/companies");
  await a.getByRole("link", { name: "Bedrijf van A" }).click();
  await a.waitForURL(/\/app\/companies\/[a-z0-9]+$/);
  const companyUrl = a.url();

  const b = await browser.newPage();
  await register(b, `Org B ${uid()}`, `b-${uid()}@example.test`);
  await onboard(b, "Bedrijf van B");
  const response = await b.goto(companyUrl);
  expect(response?.status()).toBe(404);
  await expect(b.getByText("Bedrijf van A")).toHaveCount(0);
  await expect(b.getByText("Deze pagina bestaat niet")).toBeVisible();
});

test("wrong password is refused and the language can be switched", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mailadres").fill(`nobody-${uid()}@example.test`);
  await page.getByLabel("Wachtwoord").fill("verkeerd wachtwoord");
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(page.getByText("E-mailadres of wachtwoord is onjuist.")).toBeVisible();

  await page.goto("/");
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByText("Release candidate")).toBeVisible();
  await page.getByRole("button", { name: "Nederlands" }).click();
  await expect(page.getByText("Release-kandidaat")).toBeVisible();
});
