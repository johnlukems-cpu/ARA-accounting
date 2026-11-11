/**
 * Structured production logging. One JSON object per line (Vercel log drains parse it). Sensitive data is removed
 * BEFORE writing: fields whose name suggests a secret or personal/financial content are replaced, and free text is
 * scrubbed of e-mail addresses, bearer tokens, connection strings and long digit sequences (account numbers, amounts
 * with many digits). Log ids, codes and counts — never amounts, names or document contents.
 */
type Level = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const SENSITIVE_KEY = /pass(word)?|secret|token|api[-_]?key|authorization|cookie|session|encryption|smtp_?pass|^key$|iban|accountnumber|account_number|email|phone|address|amount|balance|description|content|bytes|body|text|name$/i;
const ALLOWED_KEY = /^(event|level|time|organizationId|userId|administrationId|entityId|id|ids|digest|path|method|routePath|routeType|status|code|count|scanned|failed|durationMs|commit|region|firstBrokenSeq|errorName|keys)$/;

export function scrubText(s: string): string {
  return s
    .replace(/postgres(ql)?:\/\/[^\s"']+/gi, "postgresql://[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b(sk-ant-|sk-|ghp_|xox[bp]-)[A-Za-z0-9_-]{8,}/g, "[secret]")
    .replace(/\d[\d.,]{7,}\d/g, "[number]")
    .slice(0, 500);
}

export function redact(value: unknown, key = "", depth = 0): unknown {
  if (key && !ALLOWED_KEY.test(key) && SENSITIVE_KEY.test(key)) return "[redacted]";
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return scrubText(value);
  if (value instanceof Error) return { errorName: value.name, message: scrubText(value.message) };
  if (depth > 3) return "[depth]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, "", depth + 1));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redact(v, k, depth + 1)]));
  return String(value);
}

function write(level: Level, event: string, fields: LogFields = {}) {
  const line = JSON.stringify({ level, event, time: new Date().toISOString(), ...(redact(fields) as object) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (level !== "debug" || process.env.NODE_ENV !== "production") console.log(line);
}

export const log = {
  debug: (event: string, fields?: LogFields) => write("debug", event, fields),
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields),
};
