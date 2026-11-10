import { defineConfig, globalIgnores } from "eslint/config";
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

/** Only the accounting engine may write journal entries and lines (docs/ACCOUNTING_RULES.md, rule "one engine"). */
const LEDGER_WRITE = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany", "createManyAndReturn", "updateManyAndReturn"]
  .map((m) => `CallExpression[callee.property.name='${m}'][callee.object.property.name=/^(journalEntry|journalLine)$/]`)
  .join(", ");

export default defineConfig([
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/core/ledger/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: LEDGER_WRITE, message: "Journal entries and lines may only be written by src/core/ledger (the accounting engine)." },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "next-env.d.ts", "test-results/**", "playwright-report/**"]),
]);
