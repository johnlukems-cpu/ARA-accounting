/**
 * Environment validation (production readiness). Checks presence and FORMAT of configuration only and never returns or
 * logs a value. Used by the build (`npm run check:env`, run by scripts/vercel-build.mjs), at server start
 * (src/instrumentation.ts) and on the production readiness dashboard.
 */
export type EnvLevel = "error" | "warning" | "ok" | "info";
export interface EnvCheck {
  key: string;
  level: EnvLevel;
  /** Message key under readiness.env.* (translated in the UI; English text for the CLI). */
  code: string;
  hint: string;
}

type Env = Record<string, string | undefined>;
const set = (v: string | undefined): v is string => typeof v === "string" && v.trim() !== "";
const isLocalHost = (h: string) => ["localhost", "127.0.0.1", "::1"].includes(h) || h.endsWith(".local");

function parseUrl(v: string): URL | null {
  try {
    return new URL(v);
  } catch {
    return null;
  }
}

function checkDatabase(env: Env, prod: boolean): EnvCheck[] {
  const out: EnvCheck[] = [];
  const pooled = env.DATABASE_URL;
  const direct = env.DATABASE_URL_UNPOOLED;
  if (!set(pooled)) {
    out.push({ key: "DATABASE_URL", level: prod ? "error" : "warning", code: "missing", hint: "PostgreSQL connection string (Neon pooled URL on Vercel)." });
    return out;
  }
  const u = parseUrl(pooled);
  if (!u || !/^postgres(ql)?:$/.test(u.protocol)) {
    out.push({ key: "DATABASE_URL", level: "error", code: "invalidUrl", hint: "Must be a postgresql:// URL." });
    return out;
  }
  const remote = !isLocalHost(u.hostname);
  if (remote && u.searchParams.get("sslmode") !== "require" && u.searchParams.get("sslmode") !== "verify-full") {
    out.push({ key: "DATABASE_URL", level: "error", code: "sslRequired", hint: "Remote databases must use sslmode=require (Neon sets it)." });
  } else out.push({ key: "DATABASE_URL", level: "ok", code: remote ? "remoteTls" : "local", hint: remote ? "Remote database over TLS." : "Local database." });
  if (remote && u.hostname.endsWith(".neon.tech") && !u.hostname.includes("-pooler")) {
    out.push({ key: "DATABASE_URL", level: "warning", code: "neonNotPooled", hint: "On Vercel use Neon's pooled host (…-pooler…) for DATABASE_URL; serverless functions open many connections." });
  }
  if (!set(direct)) {
    out.push({ key: "DATABASE_URL_UNPOOLED", level: prod ? "error" : "warning", code: "missing", hint: "Direct (unpooled) URL; prisma migrate deploy needs it." });
  } else {
    const d = parseUrl(direct);
    if (!d || !/^postgres(ql)?:$/.test(d.protocol)) out.push({ key: "DATABASE_URL_UNPOOLED", level: "error", code: "invalidUrl", hint: "Must be a postgresql:// URL." });
    else if (d.hostname.includes("-pooler")) out.push({ key: "DATABASE_URL_UNPOOLED", level: "error", code: "pooledDirect", hint: "Must be the direct host (without -pooler): migrations need a session connection." });
    else if (!isLocalHost(d.hostname) && d.searchParams.get("sslmode") !== "require" && d.searchParams.get("sslmode") !== "verify-full") out.push({ key: "DATABASE_URL_UNPOOLED", level: "error", code: "sslRequired", hint: "Remote databases must use sslmode=require." });
    else if (d.hostname.replace("-pooler", "") !== u.hostname.replace("-pooler", "") || d.pathname !== u.pathname) out.push({ key: "DATABASE_URL_UNPOOLED", level: "error", code: "differentDatabase", hint: "Pooled and direct URLs must point to the same database." });
    else out.push({ key: "DATABASE_URL_UNPOOLED", level: "ok", code: "ok", hint: "" });
  }
  return out;
}

export function checkEnvironment(env: Env = process.env): EnvCheck[] {
  const prod = env.NODE_ENV === "production" && env.VERCEL_ENV !== "preview" && env.ARA_ENV !== "test";
  const out: EnvCheck[] = [...checkDatabase(env, prod)];

  // ENCRYPTION_KEY: 32 bytes, base64.
  if (!set(env.ENCRYPTION_KEY)) out.push({ key: "ENCRYPTION_KEY", level: set(env.DATABASE_URL) ? "error" : "warning", code: "missing", hint: "openssl rand -base64 32 — keep a copy in a password manager." });
  else if (Buffer.from(env.ENCRYPTION_KEY, "base64").length !== 32) out.push({ key: "ENCRYPTION_KEY", level: "error", code: "invalidKey", hint: "Must decode (base64) to exactly 32 bytes." });
  else out.push({ key: "ENCRYPTION_KEY", level: "ok", code: "ok", hint: "" });

  // CRON_SECRET: Vercel sends it as a Bearer token to /api/cron/*.
  if (!set(env.CRON_SECRET)) out.push({ key: "CRON_SECRET", level: prod ? "error" : "warning", code: "missing", hint: "At least 32 random characters (openssl rand -hex 32). Without it the daily cron is refused." });
  else if (env.CRON_SECRET.length < 32) out.push({ key: "CRON_SECRET", level: "error", code: "tooShort", hint: "Use at least 32 characters." });
  else out.push({ key: "CRON_SECRET", level: "ok", code: "ok", hint: "" });

  // APP_URL: absolute https origin used in e-mail links; never derived from the request's Host header.
  if (set(env.APP_URL)) {
    const a = parseUrl(env.APP_URL);
    if (!a || (a.protocol !== "https:" && !(a.protocol === "http:" && isLocalHost(a.hostname)))) out.push({ key: "APP_URL", level: "error", code: "httpsRequired", hint: "An https:// origin, e.g. https://app.example.sr." });
    else if (a.pathname !== "/" || a.search || a.hash) out.push({ key: "APP_URL", level: "error", code: "originOnly", hint: "Origin only, without path, query or fragment." });
    else out.push({ key: "APP_URL", level: "ok", code: "ok", hint: "" });
  } else if (set(env.VERCEL_PROJECT_PRODUCTION_URL)) out.push({ key: "APP_URL", level: "warning", code: "vercelFallback", hint: "Falls back to the Vercel production domain; set APP_URL once the custom domain is live." });
  else out.push({ key: "APP_URL", level: prod ? "error" : "warning", code: "missing", hint: "Needed for links in e-mails." });

  // SMTP: optional, but complete when present.
  if (!set(env.SMTP_HOST)) out.push({ key: "SMTP_HOST", level: "warning", code: "emailDisabled", hint: "No e-mail is sent; invitation and reset links are shown once to administrators instead." });
  else {
    const problems: string[] = [];
    const port = Number(env.SMTP_PORT ?? 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push("SMTP_PORT must be a port number");
    if (env.SMTP_SECURE && !["true", "false"].includes(env.SMTP_SECURE)) problems.push("SMTP_SECURE must be true or false");
    if (set(env.SMTP_USER) && !set(env.SMTP_PASSWORD)) problems.push("SMTP_PASSWORD is required with SMTP_USER");
    if (!set(env.SMTP_FROM) || !/<?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?\s*$/.test(env.SMTP_FROM)) problems.push("SMTP_FROM must contain a sender address");
    else if (/example\.(sr|com|org)|localhost/i.test(env.SMTP_FROM)) problems.push("SMTP_FROM still holds the placeholder address");
    out.push(problems.length ? { key: "SMTP_HOST", level: "error", code: "smtpIncomplete", hint: problems.join("; ") } : { key: "SMTP_HOST", level: "ok", code: "ok", hint: "" });
  }

  // Optional integrations and settings.
  out.push(set(env.ANTHROPIC_API_KEY) ? { key: "ANTHROPIC_API_KEY", level: "ok", code: "ok", hint: "" } : { key: "ANTHROPIC_API_KEY", level: "info", code: "aiDisabled", hint: "Optional: AI recognition of scanned images. PDFs with a text layer work without it." });
  if (set(env.ERROR_REPORT_URL)) {
    const e = parseUrl(env.ERROR_REPORT_URL);
    out.push(e?.protocol === "https:" ? { key: "ERROR_REPORT_URL", level: "ok", code: "ok", hint: "" } : { key: "ERROR_REPORT_URL", level: "error", code: "httpsRequired", hint: "Must be an https:// webhook URL." });
  } else out.push({ key: "ERROR_REPORT_URL", level: prod ? "warning" : "info", code: "monitoringDisabled", hint: "Errors are only written to the platform log (no alerting)." });
  if (set(env.TRIAL_DAYS)) {
    const n = Number(env.TRIAL_DAYS);
    out.push(Number.isInteger(n) && n > 0 && n <= 365 ? { key: "TRIAL_DAYS", level: "ok", code: "ok", hint: "" } : { key: "TRIAL_DAYS", level: "error", code: "invalidNumber", hint: "Whole number of days, 1–365 (the platform setting overrides it)." });
  }
  if (set(env.REGISTER_LIMIT_PER_HOUR)) {
    const n = Number(env.REGISTER_LIMIT_PER_HOUR);
    out.push(Number.isInteger(n) && n > 0 ? (prod && n > 20 ? { key: "REGISTER_LIMIT_PER_HOUR", level: "warning", code: "highLimit", hint: "Above 20 registrations per IP per hour weakens abuse protection." } : { key: "REGISTER_LIMIT_PER_HOUR", level: "ok", code: "ok", hint: "" }) : { key: "REGISTER_LIMIT_PER_HOUR", level: "error", code: "invalidNumber", hint: "Positive whole number." });
  }
  if (set(env.PLATFORM_ADMIN_EMAILS)) {
    const bad = env.PLATFORM_ADMIN_EMAILS.split(",").map((s) => s.trim()).filter((s) => s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
    out.push(bad.length ? { key: "PLATFORM_ADMIN_EMAILS", level: "error", code: "invalidEmail", hint: `${bad.length} invalid address(es).` } : { key: "PLATFORM_ADMIN_EMAILS", level: "ok", code: "ok", hint: "" });
  } else out.push({ key: "PLATFORM_ADMIN_EMAILS", level: prod ? "warning" : "info", code: "noPlatformAdmin", hint: "Nobody can open Platformbeheer until an address is set and the seed has run." });

  // Secrets must never be exposed to the browser bundle.
  const leaked = Object.keys(env).filter((k) => k.startsWith("NEXT_PUBLIC_") && /SECRET|KEY|PASSWORD|TOKEN|DATABASE/i.test(k));
  if (leaked.length) out.push({ key: leaked.join(", "), level: "error", code: "publicSecret", hint: "NEXT_PUBLIC_ variables are compiled into the browser bundle; secrets must not use that prefix." });
  return out;
}

export const envErrors = (checks: EnvCheck[]) => checks.filter((c) => c.level === "error");
