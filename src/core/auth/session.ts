import "server-only";
import { cookies, headers } from "next/headers";
import { systemDb } from "@/core/db/client";
import { randomToken, sha256 } from "./crypto";

export const SESSION_COOKIE = "ara_acc_session";
const ABSOLUTE_MS = 12 * 3600 * 1000;
const IDLE_MS = 2 * 3600 * 1000;
const TOUCH_MS = 5 * 60 * 1000;

export async function requestMeta() {
  const h = await headers();
  return {
    ip: (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip") || null,
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
  };
}

/** Creates a session and sets the cookie. Only callable from server actions and route handlers. */
export async function createSession(userId: string, opts: { mfaVerified: boolean }) {
  const token = randomToken();
  const meta = await requestMeta();
  const membership = await systemDb.organizationMembership.findFirst({
    where: { userId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  await systemDb.session.create({
    data: {
      id: sha256(token),
      userId,
      activeOrganizationId: membership?.organizationId ?? null,
      mfaVerifiedAt: opts.mfaVerified ? new Date() : null,
      expiresAt: new Date(Date.now() + ABSOLUTE_MS),
      ip: meta.ip,
      userAgent: meta.userAgent,
    },
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ABSOLUTE_MS / 1000,
  });
}

export type SessionWithUser = NonNullable<Awaited<ReturnType<typeof readSession>>>;

/** Reads and validates the session from the cookie. Expired or idle sessions are deleted. */
export async function readSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const id = sha256(token);
  const session = await systemDb.session.findUnique({ where: { id }, include: { user: true } });
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() < now || session.lastSeenAt.getTime() + IDLE_MS < now || !session.user.isActive) {
    await systemDb.session.delete({ where: { id } }).catch(() => undefined);
    return null;
  }
  if (session.lastSeenAt.getTime() + TOUCH_MS < now) {
    await systemDb.session.update({ where: { id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  return session;
}

export async function updateSession(
  sessionId: string,
  data: Partial<{
    activeOrganizationId: string | null;
    activeCompanyId: string | null;
    activeAdministrationId: string | null;
    activeFiscalYearId: string | null;
    mfaVerifiedAt: Date | null;
  }>,
) {
  await systemDb.session.update({ where: { id: sessionId }, data });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await systemDb.session.deleteMany({ where: { id: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

/** Ends every other session of a user (after a password or MFA change). */
export async function revokeOtherSessions(userId: string, keepSessionId?: string) {
  await systemDb.session.deleteMany({ where: { userId, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) } });
}
