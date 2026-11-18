import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

/** ARA Admin Portal through the real UI (workflows 1–7 + customer portal) and a walk over every admin page. */
const uid = () => randomBytes(4).toString("hex");
const dbUrl = process.env.TEST_DATABASE_URL ?? "postgresql://ara:ara_dev@localhost:5432/ara_accounting_test";

async function register(page: Page, org: string) {
  const email = `adm-${uid()}@example.test`;
  await page.goto("/register");
  await page.getByLabel("Naam organisatie").fill(org);
  await page.getByLabel("Uw naam").fill("ARA Medewerker");
  await page.getByLabel("E-mailadres").fill(email);
  await page.getByLabel("Wachtwoord").fill("een lang test wachtwoord");
  await page.getByRole("button", { name: "Account aanmaken" }).click();
  await page.getByLabel("Naam", { exact: true }).fill(`${org} NV`);
  await page.getByRole("button", { name: "Volgende" }).click();
  await page.getByLabel("Eerste boekjaar").fill(String(new Date().getUTCFullYear()));
  await page.getByRole("button", { name: "Administratie aanmaken" }).click();
  await expect(page).toHaveURL(/\/app$/);
  return email;
}

/** Makes the user platform admin; sets up ARA's organisation through the UI if it does not exist yet, else joins it. */
async function becomeStaff(page: Page, email: string) {
  const db = new PrismaClient({ datasourceUrl: dbUrl });
  const user = await db.user.update({ where: { email }, data: { isPlatformAdmin: true } });
  const home = await db.platformSetting.findUnique({ where: { key: "araHome" } });
  if (!home) {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/setup$/);
    await page.getByLabel("Rechtsvorm").selectOption("NV");
    await page.getByRole("button", { name: "ARA-organisatie inrichten" }).click();
    await expect(page).toHaveURL(/\/admin$/);
  } else {
    const role = await db.role.findFirstOrThrow({ where: { code: "ARA_SUPER_ADMIN", organizationId: null } });
    await db.organizationMembership.create({ data: { organizationId: (home.value as { organizationId: string }).organizationId, userId: user.id, roleId: role.id, status: "ACTIVE" } });
  }
  const org = await db.organizationMembership.findFirstOrThrow({ where: { userId: user.id, organization: { name: { startsWith: "Klant" } } } }).catch(() => null);
  await db.$disconnect();
  return org?.organizationId ?? null;
}

test("ARA Admin: lead → customer → quotation → invoice; customer portal shows it; every admin page renders", async ({ page }) => {
  test.setTimeout(240_000);
  const email = await register(page, `Klant ${uid()}`);
  const customerOrgId = await becomeStaff(page, email);

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Gefactureerd", { exact: true }).first()).toBeVisible();

  // 1–2. Lead, then customer (same record)
  const name = `E2E Handel ${uid()}`;
  await page.goto("/admin/customers?new=1");
  await page.getByLabel("Naam", { exact: true }).fill(name);
  await page.getByLabel("E-mail").first().fill("info@e2e-handel.example");
  await page.getByRole("button", { name: "Aanmaken" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  const stage = page.locator("form").filter({ has: page.getByText("Naar 'Klant' zetten") });
  await stage.getByRole("combobox").selectOption("CUSTOMER");
  await stage.getByRole("button", { name: "Opslaan" }).click();
  await expect(page.getByText(/· debiteur/)).toBeVisible();
  const customerUrl = page.url();

  // Link the customer to the user's own ARA Accounting organisation (for the portal)
  if (customerOrgId) {
    const link = page.locator("form").filter({ has: page.getByLabel("Organisatie-ID") });
    await link.getByLabel("Organisatie-ID").fill(customerOrgId);
    await link.getByRole("button", { name: "Opslaan" }).click();
    await expect(page.getByText(/\(Proefperiode\)|\(Actief\)/)).toBeVisible();
  }

  // 4. Quotation with a custom line
  await page.goto(`/admin/quotations/new?customer=${customerUrl.split("/").pop()}`);
  await page.getByLabel("Omschrijving").first().fill("Implementatie en training");
  await page.getByLabel("Aantal").first().fill("2");
  await page.getByLabel("Prijs").first().fill("1250");
  await page.getByRole("button", { name: "Offerte aanmaken" }).click();
  await expect(page.getByRole("heading", { name: /^Offerte OFF-/ })).toBeVisible();
  await expect(page.getByText("SRD 2.500,00").first()).toBeVisible();
  // 5. Hand over manually (no SMTP in tests), 6. accept, 7. convert
  await page.getByRole("button", { name: "Handmatig overhandigd" }).click();
  await expect(page.getByText("Verstuurd").first()).toBeVisible();
  await page.getByLabel("Beslist door (naam klant)").fill("J. Klant");
  await page.getByRole("button", { name: "Geaccepteerd" }).click();
  await page.getByRole("button", { name: "Omzetten naar conceptfactuur" }).click();
  await expect(page).toHaveURL(/\/admin\/invoices\//);
  await page.getByRole("button", { name: "Boeken" }).click();
  await expect(page.getByRole("heading", { name: /^Factuur VF\d{4}-\d+/ })).toBeVisible();

  // Customer portal (the customer's own organisation)
  if (customerOrgId) {
    await page.goto("/app/ara");
    await expect(page.getByRole("heading", { name: "Mijn ARA-account" })).toBeVisible();
    await expect(page.getByRole("cell", { name: /^OFF-/ })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Open", exact: true }).or(page.getByText("Open", { exact: true })).first()).toBeVisible();
  }

  // Every admin page renders without an error page or horizontal overflow
  for (const path of ["/admin", "/admin/crm", "/admin/customers", "/admin/products", "/admin/quotations", "/admin/invoices", "/admin/subscriptions", "/admin/payments", "/admin/receivables", "/admin/purchases", "/admin/expenses", "/admin/banking", "/admin/finance", "/admin/reports", "/admin/reports?kind=churn", "/admin/employees", "/admin/support", "/admin/settings"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBeLessThan(400);
    await expect(page.locator("main h1").first(), path).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), path).toBeLessThanOrEqual(1);
  }
  const csv = await page.request.get("/api/admin/reports?kind=revenueMonthly&year=" + new Date().getUTCFullYear() + "&format=csv");
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain("Gefactureerd");
});

test("ARA Admin is not reachable for ordinary customers", async ({ page }) => {
  await register(page, `Gewoon ${uid()}`);
  const res = await page.goto("/admin/customers");
  expect(res?.status()).toBe(404);
  expect((await page.request.get("/api/admin/reports?kind=revenueMonthly&format=csv")).status()).toBe(403);
});
