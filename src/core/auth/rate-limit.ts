import { systemDb } from "@/core/db/client";

/** Database-backed sliding-window limiter (works across serverless instances). */
export async function isRateLimited(keys: string[], max: number, windowMinutes: number): Promise<boolean> {
  const since = new Date(Date.now() - windowMinutes * 60_000);
  for (const key of keys) {
    const count = await systemDb.loginAttempt.count({ where: { key, createdAt: { gte: since } } });
    if (count >= max) return true;
  }
  return false;
}

export async function recordAttempt(keys: string[]) {
  await systemDb.loginAttempt.createMany({ data: keys.map((key) => ({ key })) });
}

export async function clearAttempts(keys: string[]) {
  await systemDb.loginAttempt.deleteMany({ where: { key: { in: keys } } });
}

/** Removes old rows; called by the job runner. */
export async function pruneAttempts(olderThanHours = 24) {
  await systemDb.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - olderThanHours * 3600_000) } } });
}
