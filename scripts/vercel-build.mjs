/**
 * Vercel build: applies database migrations and reference data when a database is configured,
 * then builds Next.js. Without DATABASE_URL the site still builds (public pages only).
 */
import { execFileSync } from "node:child_process";

const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit", env: process.env });

run("npx", ["prisma", "generate"]);
if (process.env.DATABASE_URL) {
  // Fail the deploy on invalid configuration (missing/short secrets, non-TLS database, bad APP_URL …) before
  // touching the database. Values are never printed.
  run("npx", ["tsx", "scripts/check-env.ts"]);
  if (!process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL_UNPOOLED = process.env.DATABASE_URL;
  run("npx", ["prisma", "migrate", "deploy"]);
  // Verify: every migration in the repository is applied and none is failed or pending.
  run("npx", ["prisma", "migrate", "status"]);
  run("npx", ["tsx", "scripts/seed.ts"]);
} else {
  console.warn("DATABASE_URL is not set: skipping migrations. Sign-in and the application stay unavailable until a database is added.");
}
run("npx", ["next", "build"]);
// Fails the deploy if a secret value or server-only variable reached the browser bundle.
run("node", ["scripts/check-bundle.mjs"]);
