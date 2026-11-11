import { isRateLimited, recordAttempt } from "@/core/auth/rate-limit";
import { UserError } from "@/core/errors";
import { log } from "./log";

/**
 * Per-minute abuse and cost protection for uploads, exports, downloads and AI calls (database-backed, so it holds across
 * serverless instances). Limits are generous for normal work; they stop scripts and runaway loops.
 */
export const THROTTLES = {
  upload: { perUser: 60, perOrg: 300, windowMin: 10 },
  export: { perUser: 60, perOrg: 300, windowMin: 10 },
  download: { perUser: 300, perOrg: 1500, windowMin: 10 },
  ai: { perUser: 40, perOrg: 120, windowMin: 10 },
} as const;
export type ThrottleKind = keyof typeof THROTTLES;

/** Counts one event and returns true when the limit was already reached (the event is then not counted). */
export async function hit(kind: ThrottleKind, userId: string, organizationId: string): Promise<boolean> {
  const l = THROTTLES[kind];
  const userKey = `${kind}:u:${userId}`;
  const orgKey = `${kind}:o:${organizationId}`;
  if ((await isRateLimited([userKey], l.perUser, l.windowMin)) || (await isRateLimited([orgKey], l.perOrg, l.windowMin))) {
    log.warn("throttle.limited", { code: kind, userId, organizationId });
    return true;
  }
  await recordAttempt([userKey, orgKey]);
  return false;
}

export async function assertNotThrottled(kind: ThrottleKind, userId: string, organizationId: string) {
  if (await hit(kind, userId, organizationId)) throw new UserError("errors.tooManyRequests");
}

/** For route handlers: a 429 response when limited, otherwise null. */
export async function throttleResponse(kind: ThrottleKind, userId: string, organizationId: string): Promise<Response | null> {
  return (await hit(kind, userId, organizationId)) ? new Response("Too many requests", { status: 429, headers: { "Retry-After": String(THROTTLES[kind].windowMin * 60) } }) : null;
}
