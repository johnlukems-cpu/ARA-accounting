"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { systemDb } from "@/core/db/client";
import { audit } from "@/core/audit/audit";
import { DUMMY_PASSWORD_HASH, decrypt, hashPassword, randomToken, sha256, verifyPassword } from "@/core/auth/crypto";
import { verifyTotp } from "@/core/auth/totp";
import { clearAttempts, isRateLimited, recordAttempt } from "@/core/auth/rate-limit";
import { createSession, destroySession, readSession, requestMeta, revokeOtherSessions, updateSession } from "@/core/auth/session";
import { UserError } from "@/core/errors";
import { registerOrganization } from "@/modules/organization/service";
import { emailSchema, passwordSchema, registerSchema } from "@/modules/organization/schemas";
import { appUrl, getEmailSender } from "@/integrations/email";
import { formObject, okState, toActionState, type ActionState } from "@/lib/action";

const LOGIN_MAX = 5;
const LOGIN_WINDOW_MIN = 15;

async function sendVerificationEmail(userId: string, email: string) {
  const sender = getEmailSender();
  if (!sender) return false;
  const token = randomToken();
  await systemDb.userToken.create({ data: { tokenHash: sha256(token), kind: "EMAIL_VERIFICATION", userId, expiresAt: new Date(Date.now() + 48 * 3600_000) } });
  await sender.send({
    to: email,
    subject: "Bevestig uw e-mailadres — ARA Accounting",
    text: `Bevestig uw e-mailadres via deze link (48 uur geldig):\n${appUrl(`/verify-email?token=${token}`)}`,
  });
  return true;
}

export async function registerAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const meta = await requestMeta();
    const maxPerHour = Number(process.env.REGISTER_LIMIT_PER_HOUR ?? 5);
    if (meta.ip && (await isRateLimited([`register:${meta.ip}`], maxPerHour, 60))) throw new UserError("errors.tooManyAttempts");
    if (meta.ip) await recordAttempt([`register:${meta.ip}`]);
    const input = registerSchema.parse(formObject(fd));
    const { userId } = await registerOrganization(input, meta.ip ?? undefined);
    await sendVerificationEmail(userId, input.email).catch(() => false);
    await createSession(userId, { mfaVerified: false });
  } catch (err) {
    return toActionState(err);
  }
  redirect("/onboarding");
}

export async function loginAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let mfaNeeded = false;
  try {
    const { email, password } = z.object({ email: emailSchema, password: z.string().min(1).max(200) }).parse(formObject(fd));
    const meta = await requestMeta();
    const keys = [`email:${email}`, ...(meta.ip ? [`ip:${meta.ip}`] : [])];
    if (await isRateLimited(keys, LOGIN_MAX, LOGIN_WINDOW_MIN)) throw new UserError("errors.tooManyAttempts");

    const user = await systemDb.user.findUnique({ where: { email } });
    const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !valid || !user.isActive) {
      await recordAttempt(keys);
      if (user) await systemDb.auditLog.create({ data: { organizationId: null, userId: user.id, action: "auth.loginFailed", entity: "User", entityId: user.id, ip: meta.ip } });
      throw new UserError("errors.invalidLogin");
    }
    await clearAttempts([`email:${email}`]);
    await systemDb.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await createSession(user.id, { mfaVerified: false });
    await systemDb.auditLog.create({ data: { organizationId: null, userId: user.id, action: "auth.login", entity: "User", entityId: user.id, ip: meta.ip } });
    mfaNeeded = user.mfaEnabled;
  } catch (err) {
    return toActionState(err);
  }
  redirect(mfaNeeded ? "/login/mfa" : "/app");
}

export async function verifyMfaAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const session = await readSession();
    if (!session) throw new UserError("errors.unauthenticated");
    const code = String(fd.get("code") ?? "").trim();
    const key = [`mfa:${session.userId}`];
    if (await isRateLimited(key, 5, 15)) throw new UserError("errors.tooManyAttempts");
    const user = session.user;
    let ok = false;
    if (user.mfaEnabled && user.mfaSecretEnc) {
      if (/^\d{6}$/.test(code)) ok = verifyTotp(decrypt(user.mfaSecretEnc), code);
      else {
        // Recovery code: single use.
        const codes = (user.mfaRecoveryCodes as string[] | null) ?? [];
        const hash = sha256(code.toUpperCase().replace(/\s/g, ""));
        if (codes.includes(hash)) {
          ok = true;
          await systemDb.user.update({ where: { id: user.id }, data: { mfaRecoveryCodes: codes.filter((c) => c !== hash) } });
        }
      }
    }
    if (!ok) {
      await recordAttempt(key);
      throw new UserError("errors.invalidCode");
    }
    await clearAttempts(key);
    await updateSession(session.id, { mfaVerifiedAt: new Date() });
  } catch (err) {
    return toActionState(err);
  }
  redirect("/app");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function requestPasswordResetAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const email = emailSchema.parse(fd.get("email"));
    const meta = await requestMeta();
    const keys = [`reset:${email}`, ...(meta.ip ? [`reset-ip:${meta.ip}`] : [])];
    if (await isRateLimited(keys, 3, 60)) throw new UserError("errors.tooManyAttempts");
    await recordAttempt(keys);
    const sender = getEmailSender();
    if (!sender) return { ok: false, message: (await okState("auth.resetNoEmail"))?.message, ts: Date.now() };
    const user = await systemDb.user.findUnique({ where: { email } });
    if (user && user.isActive) {
      const token = randomToken();
      await systemDb.userToken.create({ data: { tokenHash: sha256(token), kind: "PASSWORD_RESET", userId: user.id, expiresAt: new Date(Date.now() + 3600_000) } });
      await sender.send({
        to: email,
        subject: "Wachtwoord herstellen — ARA Accounting",
        text: `Stel een nieuw wachtwoord in via deze link (1 uur geldig):\n${appUrl(`/reset-password?token=${token}`)}\n\nHeeft u dit niet aangevraagd? Dan kunt u deze e-mail negeren.`,
      });
    }
    // Same answer whether or not the address exists.
    return okState("auth.resetSent");
  } catch (err) {
    return toActionState(err);
  }
}

async function consumeToken(token: string, kind: "PASSWORD_RESET" | "INVITATION" | "EMAIL_VERIFICATION") {
  const row = await systemDb.userToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.kind !== kind || row.usedAt || row.expiresAt < new Date()) throw new UserError("errors.invalidToken");
  const claimed = await systemDb.userToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw new UserError("errors.invalidToken");
  return row;
}

export async function resetPasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { token, password } = z.object({ token: z.string().min(10), password: passwordSchema }).parse(formObject(fd));
    const row = await consumeToken(token, "PASSWORD_RESET");
    await systemDb.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date() } });
    await revokeOtherSessions(row.userId);
    await systemDb.auditLog.create({ data: { organizationId: null, userId: row.userId, action: "auth.passwordReset", entity: "User", entityId: row.userId } });
  } catch (err) {
    return toActionState(err);
  }
  redirect("/login?reset=1");
}

export async function acceptInvitationAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { token, name, password } = z
      .object({ token: z.string().min(10), name: z.string().trim().min(2, "validation.required").max(120), password: passwordSchema })
      .parse(formObject(fd));
    const row = await consumeToken(token, "INVITATION");
    await systemDb.$transaction(async (tx) => {
      await tx.user.update({ where: { id: row.userId }, data: { name, passwordHash: await hashPassword(password), passwordChangedAt: new Date(), emailVerifiedAt: new Date() } });
      if (row.organizationId) {
        await tx.organizationMembership.updateMany({ where: { organizationId: row.organizationId, userId: row.userId, status: "INVITED" }, data: { status: "ACTIVE" } });
        await audit(tx, { organizationId: row.organizationId, userId: row.userId, action: "member.joined", entity: "User", entityId: row.userId });
      }
    });
    await createSession(row.userId, { mfaVerified: false });
  } catch (err) {
    return toActionState(err);
  }
  redirect("/app");
}

export async function verifyEmail(token: string): Promise<boolean> {
  try {
    const row = await consumeToken(token, "EMAIL_VERIFICATION");
    await systemDb.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
    return true;
  } catch {
    return false;
  }
}
