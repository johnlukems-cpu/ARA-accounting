import { defineConfig, devices } from "@playwright/test";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://ara:ara_dev@localhost:5432/ara_accounting_test";
const PORT = 3200;

/** End-to-end tests against a production build and a real PostgreSQL database (migrated by `npm run test:integration`). */
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, locale: "nl-SR", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath: process.env.PW_CHROMIUM ?? undefined } } },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      DATABASE_URL: url,
      DATABASE_URL_UNPOOLED: url,
      ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
      SESSION_SECRET: "e2e-session-secret",
      APP_URL: `http://localhost:${PORT}`,
    },
  },
});
