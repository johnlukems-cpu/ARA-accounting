import { z } from "zod";
import { systemDb } from "@/core/db/client";
import { audit } from "@/core/audit/audit";
import { UserError } from "@/core/errors";
import { checkEnvironment, type EnvCheck } from "@/core/ops/env";
import { reportError } from "@/core/ops/monitoring";
import { getEmailSender, testEmailDelivery } from "@/integrations/email";
import { complianceRegister } from "@/modules/compliance/service";
import { READINESS_ITEMS, type ReadinessItem, type ReadinessStatus } from "./register";

async function platformAdmin(userId: string) {
  const u = await systemDb.user.findUnique({ where: { id: userId } });
  if (!u?.isPlatformAdmin || !u.isActive) throw new UserError("errors.forbidden");
  return u;
}

/** Items whose completion is a fact outside the software: recorded as evidence by a platform admin. */
export const EVIDENCE_ITEMS = ["O10", "O12", "O13"] as const;

export type EvaluatedItem = ReadinessItem & { live: boolean; detail?: string };

const envOk = (checks: EnvCheck[], key: string) => checks.find((c) => c.key === key)?.level === "ok";
const envError = (checks: EnvCheck[], key: string) => checks.some((c) => c.key === key && c.level === "error");

/** The register with live statuses. Never exposes configuration values — only whether checks pass. */
export async function evaluate(env: Record<string, string | undefined> = process.env) {
  const checks = checkEnvironment(env);
  const [plans, setting, register, formats, events, failedMigrations] = await Promise.all([
    systemDb.plan.findMany({ where: { status: "ACTIVE" } }),
    systemDb.platformSetting.findMany(),
    complianceRegister(),
    systemDb.bankFormat.groupBy({ by: ["status"], _count: { _all: true } }),
    systemDb.auditLog.findMany({ where: { organizationId: null, action: { in: ["platform.smtpTested", "platform.monitoringTested", "platform.readinessEvidence"] } }, orderBy: { seq: "desc" }, take: 200 }),
    systemDb.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "_prisma_migrations" WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL`.catch(() => [{ n: BigInt(0) }]),
  ]);
  const settings = Object.fromEntries(setting.map((s) => [s.key, s.value]));
  const evidence = (item: string) => events.find((e) => e.action === "platform.readinessEvidence" && (e.details as { item?: string } | null)?.item === item);
  const share = (subject: string) => {
    const items = register.filter((r) => r.subject === subject);
    const verified = items.filter((r) => r.status === "VERIFIED").length;
    return { verified, total: items.length };
  };
  const ratioStatus = (v: { verified: number; total: number }, waiting: ReadinessStatus): ReadinessStatus => (v.total > 0 && v.verified === v.total ? "COMPLETED" : v.verified > 0 ? "IN_PROGRESS" : waiting);

  const live: Record<string, { status: ReadinessStatus; detail?: string }> = {};
  const coreKeys = ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "ENCRYPTION_KEY", "CRON_SECRET", "APP_URL"];
  const coreErrors = coreKeys.filter((k) => checks.some((c) => c.key === k && c.level === "error" && c.code !== "missing"));
  const coreMissing = coreKeys.filter((k) => !envOk(checks, k));
  live.O1 = coreErrors.length ? { status: "BLOCKED", detail: coreErrors.join(", ") } : coreMissing.length ? { status: "WAITING_OWNER", detail: coreMissing.join(", ") } : { status: "COMPLETED" };
  const smtpTested = events.some((e) => e.action === "platform.smtpTested");
  live.O2 = envError(checks, "SMTP_HOST") ? { status: "BLOCKED", detail: "SMTP_*" } : !getEmailSender() ? { status: "WAITING_OWNER" } : smtpTested ? { status: "COMPLETED" } : { status: "IN_PROGRESS", detail: "testEmail" };
  const priced = plans.filter((p) => p.priceMonthlySrd || p.priceMonthlyUsd || p.priceAnnualSrd || p.priceAnnualUsd);
  live.O3 = priced.length && settings.trialDays ? { status: "COMPLETED", detail: `${priced.length}` } : plans.length || settings.trialDays ? { status: "IN_PROGRESS", detail: `${plans.length}/${priced.length}` } : { status: "WAITING_OWNER" };
  live.O4 = typeof settings.paymentInstructions === "string" && settings.paymentInstructions.trim() ? { status: "COMPLETED" } : { status: "WAITING_OWNER" };
  const tax = share("TAX_RULE");
  const codes = share("BTW_CODE_TEMPLATE");
  live.O5 = { status: ratioStatus({ verified: tax.verified + codes.verified, total: tax.total + codes.total }, "WAITING_SPECIALIST"), detail: `${tax.verified + codes.verified}/${tax.total + codes.total}` };
  const fw = share("ANNUAL_ACCOUNTS_FRAMEWORK");
  live.O6 = { status: ratioStatus(fw, "WAITING_SPECIALIST"), detail: `${fw.verified}/${fw.total}` };
  const validated = formats.find((f) => f.status === "VALIDATED")?._count._all ?? 0;
  live.O7 = validated ? { status: "IN_PROGRESS", detail: `${validated}` } : { status: "WAITING_OWNER", detail: "0" };
  live.O8 = { status: ratioStatus(share("RETENTION_PERIOD"), "WAITING_SPECIALIST") };
  live.O9 = envOk(checks, "ANTHROPIC_API_KEY") ? { status: "COMPLETED" } : { status: "WAITING_OWNER" };
  const monitoringTested = events.some((e) => e.action === "platform.monitoringTested");
  live.O11 = envError(checks, "ERROR_REPORT_URL") ? { status: "BLOCKED" } : !envOk(checks, "ERROR_REPORT_URL") ? { status: "WAITING_OWNER" } : monitoringTested ? { status: "COMPLETED" } : { status: "IN_PROGRESS", detail: "testError" };
  for (const id of EVIDENCE_ITEMS) {
    const e = evidence(id);
    if (e) live[id] = { status: "COMPLETED", detail: String((e.details as { reference?: string }).reference ?? "") };
  }
  if (Number(failedMigrations[0]?.n ?? 0) > 0) live.T3 = { status: "BLOCKED", detail: "failed migration" };

  const items: EvaluatedItem[] = READINESS_ITEMS.map((it) => (live[it.id] ? { ...it, status: live[it.id]!.status, detail: live[it.id]!.detail, live: true } : { ...it, live: false }));
  const gateReady = (gates: string[]) => items.filter((it) => gates.includes(it.gate) && it.priority === "P1").every((it) => it.status === "COMPLETED");
  return {
    items,
    env: checks.map((c) => ({ key: c.key, level: c.level, code: c.code, hint: c.hint })),
    pilotReady: gateReady(["PILOT"]),
    gaReady: gateReady(["PILOT", "GA"]),
    counts: items.reduce<Record<string, number>>((acc, it) => ({ ...acc, [it.status]: (acc[it.status] ?? 0) + 1 }), {}),
  };
}

export async function sendTestEmail(userId: string) {
  const u = await platformAdmin(userId);
  const r = await testEmailDelivery(u.email);
  if (r.ok) await systemDb.$transaction((tx) => audit(tx, { organizationId: null, userId, action: "platform.smtpTested", entity: "Platform", entityId: "smtp", details: { ok: true } }));
  return r;
}

export async function sendTestError(userId: string) {
  await platformAdmin(userId);
  if (!process.env.ERROR_REPORT_URL?.startsWith("https://")) throw new UserError("readiness.monitoringNotConfigured");
  await reportError({ event: "monitoring.test", path: "/app/platform/readiness", error: new Error("ARA Accounting monitoring test (no action needed)") });
  await systemDb.$transaction((tx) => audit(tx, { organizationId: null, userId, action: "platform.monitoringTested", entity: "Platform", entityId: "monitoring" }));
}

export const evidenceSchema = z.object({
  item: z.enum(EVIDENCE_ITEMS),
  reference: z.string().trim().min(3, "validation.required").max(200),
  note: z.string().trim().max(1000).optional(),
  confirm: z.literal(true, { message: "readiness.confirmRequired" }),
});

/** Records evidence for an item completed outside the software (restore drill, external security test, legal texts). */
export async function recordEvidence(userId: string, raw: z.input<typeof evidenceSchema>) {
  await platformAdmin(userId);
  const input = evidenceSchema.parse(raw);
  await systemDb.$transaction((tx) => audit(tx, { organizationId: null, userId, action: "platform.readinessEvidence", entity: "Platform", entityId: input.item, details: { item: input.item, reference: input.reference, note: input.note ?? null } }));
}

export async function setPaymentInstructions(userId: string, text: string) {
  await platformAdmin(userId);
  const value = text.trim().slice(0, 2000);
  await systemDb.$transaction(async (tx) => {
    await tx.platformSetting.upsert({ where: { key: "paymentInstructions" }, create: { key: "paymentInstructions", value, updatedById: userId }, update: { value, updatedById: userId } });
    await audit(tx, { organizationId: null, userId, action: "platform.paymentInstructionsChanged", entity: "PlatformSetting", entityId: "paymentInstructions" });
  });
}

/** Shown to customers on the subscription page (null until the owner has set it). */
export async function paymentInstructions(): Promise<string | null> {
  const row = await systemDb.platformSetting.findUnique({ where: { key: "paymentInstructions" } });
  return typeof row?.value === "string" && row.value.trim() ? row.value : null;
}
