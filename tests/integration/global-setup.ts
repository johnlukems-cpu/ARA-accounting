import { execFileSync } from "node:child_process";

/**
 * Integration tests run against a real PostgreSQL 16 database (TEST_DATABASE_URL, default: local ara_accounting_test).
 * Migrations and the reference seed are applied first. Tests create uniquely named data and never truncate:
 * the audit log is append-only by design.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://ara:ara_dev@localhost:5432/ara_accounting_test";
  const env = { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url };
  execFileSync("npx", ["prisma", "migrate", "deploy"], { env, stdio: "pipe" });
  execFileSync("npx", ["tsx", "scripts/seed.ts"], { env, stdio: "pipe" });
}
