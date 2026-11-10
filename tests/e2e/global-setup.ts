import { PrismaClient } from "@prisma/client";

/** Clears rate-limit counters in the TEST database so repeated runs from 127.0.0.1 are not throttled. */
export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://ara:ara_dev@localhost:5432/ara_accounting_test";
  if (!/_test\b|_test$/.test(new URL(url).pathname)) throw new Error("E2E tests must run against a *_test database");
  const db = new PrismaClient({ datasourceUrl: url });
  await db.loginAttempt.deleteMany({});
  await db.$disconnect();
}
