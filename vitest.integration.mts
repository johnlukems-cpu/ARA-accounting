import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://ara:ara_dev@localhost:5432/ara_accounting_test";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    env: {
      DATABASE_URL: url,
      DATABASE_URL_UNPOOLED: url,
      ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
      SESSION_SECRET: "test-session-secret",
    },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
