import { describe, expect, it } from "vitest";
import { checkEnvironment, envErrors } from "@/core/ops/env";
import { redact, scrubText } from "@/core/ops/log";
import { isAuthorizedCron } from "@/core/ops/cron";
import { filterPermissionsByPlan } from "@/modules/saas/service";
import { compareWithStatement, summariseSample } from "@/modules/banking/formats";
import type { ImportProfile } from "@/modules/banking/csv-import";

const KEY = Buffer.alloc(32, 7).toString("base64");
const prodBase = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://u:p@ep-cool-1-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require",
  DATABASE_URL_UNPOOLED: "postgresql://u:p@ep-cool-1.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ENCRYPTION_KEY: KEY,
  CRON_SECRET: "x".repeat(40),
  APP_URL: "https://app.example-ara.sr",
};
const level = (env: Record<string, string | undefined>, key: string) => checkEnvironment(env).filter((c) => c.key === key).map((c) => `${c.level}:${c.code}`);

describe("environment validation", () => {
  it("a complete Neon production configuration has no errors", () => {
    expect(envErrors(checkEnvironment(prodBase))).toEqual([]);
  });
  it("production refuses missing secrets, short cron secrets, wrong key length and http APP_URL", () => {
    expect(level({ ...prodBase, ENCRYPTION_KEY: undefined }, "ENCRYPTION_KEY")).toEqual(["error:missing"]);
    expect(level({ ...prodBase, ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") }, "ENCRYPTION_KEY")).toEqual(["error:invalidKey"]);
    expect(level({ ...prodBase, CRON_SECRET: undefined }, "CRON_SECRET")).toEqual(["error:missing"]);
    expect(level({ ...prodBase, CRON_SECRET: "short" }, "CRON_SECRET")).toEqual(["error:tooShort"]);
    expect(level({ ...prodBase, APP_URL: "http://app.example-ara.sr" }, "APP_URL")).toEqual(["error:httpsRequired"]);
    expect(level({ ...prodBase, APP_URL: "https://app.example-ara.sr/app" }, "APP_URL")).toEqual(["error:originOnly"]);
  });
  it("database: TLS required for remote hosts; the direct URL must not be the pooler and must be the same database", () => {
    expect(level({ ...prodBase, DATABASE_URL: prodBase.DATABASE_URL.replace("?sslmode=require", "") }, "DATABASE_URL")).toContain("error:sslRequired");
    expect(level({ ...prodBase, DATABASE_URL: prodBase.DATABASE_URL_UNPOOLED }, "DATABASE_URL")).toContain("warning:neonNotPooled");
    expect(level({ ...prodBase, DATABASE_URL_UNPOOLED: prodBase.DATABASE_URL }, "DATABASE_URL_UNPOOLED")).toEqual(["error:pooledDirect"]);
    expect(level({ ...prodBase, DATABASE_URL_UNPOOLED: prodBase.DATABASE_URL_UNPOOLED.replace("/neondb", "/other") }, "DATABASE_URL_UNPOOLED")).toEqual(["error:differentDatabase"]);
    expect(level({ NODE_ENV: "development", DATABASE_URL: "postgresql://a:b@localhost:5432/x" }, "DATABASE_URL")).toEqual(["ok:local"]);
  });
  it("SMTP is optional, but incomplete or placeholder settings are errors", () => {
    expect(level(prodBase, "SMTP_HOST")).toEqual(["warning:emailDisabled"]);
    expect(level({ ...prodBase, SMTP_HOST: "smtp.x.sr", SMTP_USER: "u", SMTP_FROM: "ARA <no-reply@example.sr>" }, "SMTP_HOST")).toEqual(["error:smtpIncomplete"]);
    expect(level({ ...prodBase, SMTP_HOST: "smtp.x.sr", SMTP_USER: "u", SMTP_PASSWORD: "p", SMTP_FROM: "ARA <no-reply@ara.sr>" }, "SMTP_HOST")).toEqual(["ok:ok"]);
  });
  it("secrets with a NEXT_PUBLIC_ prefix are refused; check results never contain values", () => {
    const checks = checkEnvironment({ ...prodBase, NEXT_PUBLIC_API_KEY: "sk-ant-secret-value" });
    expect(envErrors(checks).map((c) => c.code)).toContain("publicSecret");
    expect(JSON.stringify(checks)).not.toContain("sk-ant-secret-value");
    expect(JSON.stringify(checks)).not.toContain(KEY);
    expect(JSON.stringify(checks)).not.toContain("u:p@");
  });
});

describe("log redaction", () => {
  it("removes secrets, personal data and amounts by field name, keeps ids and codes", () => {
    const out = redact({ event: "x", organizationId: "org1", password: "hunter2", token: "abc", email: "a@b.sr", amount: "1500.00", details: { authorization: "Bearer zzz", count: 3 } }) as Record<string, unknown>;
    expect(out).toMatchObject({ organizationId: "org1", password: "[redacted]", token: "[redacted]", email: "[redacted]", amount: "[redacted]", details: { authorization: "[redacted]", count: 3 } });
  });
  it("scrubs free text: e-mail, bearer tokens, connection strings, API keys, long numbers", () => {
    const s = scrubText("user jan@firma.sr failed with Bearer abc.def at postgresql://u:pw@host/db key sk-ant-api03-abcdefghijk account 1234567890123");
    expect(s).not.toMatch(/jan@firma|abc\.def|u:pw|sk-ant-api03-abcdefghijk|1234567890123/);
  });
  it("errors keep their name; the message is scrubbed", () => {
    expect(redact(new Error("login failed for jan@firma.sr"))).toEqual({ errorName: "Error", message: "login failed for [email]" });
  });
});

describe("cron authentication", () => {
  const req = (h?: string) => new Request("https://x/api/cron/quality", { headers: h ? { authorization: h } : {} });
  const secret = "s".repeat(40);
  it("accepts only the exact bearer secret", () => {
    expect(isAuthorizedCron(req(`Bearer ${secret}`), secret)).toBe(true);
    expect(isAuthorizedCron(req(`Bearer ${secret}x`), secret)).toBe(false);
    expect(isAuthorizedCron(req(secret), secret)).toBe(false);
    expect(isAuthorizedCron(req(), secret)).toBe(false);
  });
  it("fails closed without a secret or with a short one", () => {
    expect(isAuthorizedCron(req("Bearer "), undefined)).toBe(false);
    expect(isAuthorizedCron(req("Bearer short"), "short")).toBe(false);
  });
});

describe("plan module access", () => {
  const perms = new Set(["ledger.view", "ledger.post", "tax.view", "tax.approve", "budgets.view", "scan.create", "organization.view"]);
  it("null keeps every permission", () => expect(filterPermissionsByPlan(perms, null)).toEqual(perms));
  it("removes optional modules that are not included, never core modules", () => {
    expect([...filterPermissionsByPlan(perms, ["budgets"])].sort()).toEqual(["budgets.view", "ledger.post", "ledger.view", "organization.view"]);
    expect([...filterPermissionsByPlan(perms, [])].sort()).toEqual(["ledger.post", "ledger.view", "organization.view"]);
  });
});

describe("bank sample validation", () => {
  // Synthetic file built in the test to exercise the parser — NOT a bank sample and not evidence of compatibility.
  const profile: ImportProfile = { delimiter: ";", hasHeader: true, dateColumn: 0, dateFormat: "DD-MM-YYYY", amountColumn: 2, decimalSeparator: ",", descriptionColumn: 1, referenceColumn: 3 };
  const text = "Datum;Omschrijving;Bedrag;Ref\n01-10-2026;Ontvangst;1.250,50;R1\n02-10-2026;Huur;-800,00;R2\n03-10-2026;Kosten;-12,25;\n";
  it("summarises count, period and totals", () => {
    expect(summariseSample(text, profile)).toMatchObject({ lineCount: 3, dateFrom: "2026-10-01", dateTo: "2026-10-03", totalIn: "1250.50", totalOut: "812.25", withReference: 2 });
  });
  it("compares with the bank's own statement", () => {
    const s = summariseSample(text, profile);
    expect(compareWithStatement(s, { lineCount: 3, totalIn: "1250.5", totalOut: "812.25" })).toEqual([]);
    expect(compareWithStatement(s, { lineCount: 4, totalIn: "1250.50", totalOut: "812.24" })).toEqual(["lineCount", "totalOut"]);
  });
});
