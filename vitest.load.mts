import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Load test (Phase 12): a separate database so the volume never touches the integration test database.
const url = process.env.LOAD_DATABASE_URL ?? "postgresql://ara:ara_dev@localhost:5432/ara_accounting_load";
process.env.TEST_DATABASE_URL = url; // read by the shared global setup (migrate + seed)

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/load/**/*.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    env: {
      TEST_DATABASE_URL: url,
      DATABASE_URL: url,
      DATABASE_URL_UNPOOLED: url,
      ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
      SESSION_SECRET: "load-session-secret",
    },
    fileParallelism: false,
    testTimeout: 3_600_000,
    hookTimeout: 3_600_000,
  },
});
