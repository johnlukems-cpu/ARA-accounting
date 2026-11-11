/**
 * Validates the environment (presence and format only; values are never printed).
 * Exit code 1 on errors. Run by scripts/vercel-build.mjs before migrations.
 */
import { checkEnvironment } from "../src/core/ops/env";

const icon = { error: "✗", warning: "!", ok: "✓", info: "·" } as const;
const checks = checkEnvironment();
for (const c of checks) console.log(`${icon[c.level]} ${c.level.padEnd(7)} ${c.key.padEnd(24)} ${c.code}${c.hint ? ` — ${c.hint}` : ""}`);
const errors = checks.filter((c) => c.level === "error").length;
console.log(errors ? `\n${errors} configuration error(s).` : "\nConfiguration OK.");
process.exit(errors ? 1 : 0);
