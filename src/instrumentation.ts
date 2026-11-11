/**
 * Next.js instrumentation: validates the configuration once at server start and reports every server error
 * (render, route handler, server action) through the redacted monitoring hook.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { checkEnvironment } = await import("@/core/ops/env");
  const { log } = await import("@/core/ops/log");
  const checks = checkEnvironment();
  const errors = checks.filter((c) => c.level === "error");
  const warnings = checks.filter((c) => c.level === "warning");
  if (errors.length) log.error("config.invalid", { keys: errors.map((c) => `${c.key}:${c.code}`) });
  if (warnings.length) log.warn("config.warnings", { keys: warnings.map((c) => `${c.key}:${c.code}`) });
}

export async function onRequestError(error: unknown, request: { path: string; method: string }, context: { routePath: string; routeType: string }) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportError } = await import("@/core/ops/monitoring");
  await reportError({ event: "request.error", digest: (error as { digest?: string })?.digest, path: request.path, method: request.method, routePath: context.routePath, routeType: context.routeType, error });
}
