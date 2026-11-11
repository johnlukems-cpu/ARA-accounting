import { log, redact } from "./log";

/**
 * Error monitoring, provider-neutral. Every server error is logged (structured, redacted). When ERROR_REPORT_URL is set
 * (an https webhook of the owner's monitoring service), a redacted report is also POSTed there. No SDK, no DSN invented:
 * connecting a specific provider (Sentry, Better Stack, a Slack webhook …) is an owner decision (OWNER_ACTION_REGISTER O11).
 */
export interface ErrorReport {
  event: string;
  digest?: string;
  path?: string;
  method?: string;
  routePath?: string;
  routeType?: string;
  error: unknown;
}

export async function reportError(r: ErrorReport): Promise<void> {
  const payload = redact({
    event: r.event,
    digest: r.digest,
    path: r.path?.split("?")[0], // never the query string
    method: r.method,
    routePath: r.routePath,
    routeType: r.routeType,
    error: r.error,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    region: process.env.VERCEL_REGION ?? null,
  }) as Record<string, unknown>;
  log.error(r.event, payload);
  const url = process.env.ERROR_REPORT_URL;
  if (!url?.startsWith("https://")) return;
  try {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ service: "ara-accounting", time: new Date().toISOString(), ...payload }), signal: AbortSignal.timeout(3000) });
  } catch {
    log.warn("monitoring.deliveryFailed", {});
  }
}
