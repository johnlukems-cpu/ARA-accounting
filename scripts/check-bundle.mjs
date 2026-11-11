/**
 * After `next build`: proves no secret reached the browser bundle. Scans every file under .next/static for the VALUES
 * of the secret environment variables present at build time (and for server-only variable names). Prints only names.
 * Exit code 1 when anything is found.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SECRET_KEYS = ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "ENCRYPTION_KEY", "CRON_SECRET", "SESSION_SECRET", "SMTP_PASSWORD", "SMTP_USER", "ANTHROPIC_API_KEY", "ERROR_REPORT_URL"];
const values = SECRET_KEYS.map((k) => [k, process.env[k]]).filter(([, v]) => typeof v === "string" && v.length >= 8);
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const files = walk(".next/static").filter((f) => /\.(js|css|json|html|txt|map)$/.test(f));
const found = new Set();
for (const f of files) {
  const s = readFileSync(f, "utf8");
  for (const [k, v] of values) if (s.includes(v)) found.add(`${k} (value)`);
  for (const k of SECRET_KEYS) if (s.includes(`process.env.${k}`)) found.add(`${k} (reference)`);
}
console.log(`Scanned ${files.length} browser files for ${values.length} secret value(s).`);
if (found.size) {
  console.error(`✗ Secrets in the browser bundle: ${[...found].join(", ")}`);
  process.exit(1);
}
console.log("✓ No secrets in the browser bundle.");
