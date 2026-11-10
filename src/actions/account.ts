"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import QRCode from "qrcode";
import { systemDb } from "@/core/db/client";
import { decrypt, encrypt, hashPassword, randomToken, sha256, verifyPassword } from "@/core/auth/crypto";
import { generateTotpSecret, otpauthUri, verifyTotp } from "@/core/auth/totp";
import { readSession, revokeOtherSessions, updateSession } from "@/core/auth/session";
import { UserError } from "@/core/errors";
import { passwordSchema } from "@/modules/organization/schemas";
import { formObject, okState, toActionState, type ActionState } from "@/lib/action";

async function currentSession() {
  const session = await readSession();
  if (!session) throw new UserError("errors.unauthenticated");
  return session;
}

async function platformAudit(userId: string, action: string) {
  await systemDb.auditLog.create({ data: { organizationId: null, userId, action, entity: "User", entityId: userId } });
}

/** Step 1 of MFA setup: stores a new (not yet active) secret and returns the QR code. */
export async function startMfaSetupAction(): Promise<{ secret: string; qr: string } | { error: string }> {
  const session = await readSession();
  if (!session) return { error: "unauthenticated" };
  if (session.user.mfaEnabled) return { error: "alreadyEnabled" };
  const secret = generateTotpSecret();
  await systemDb.user.update({ where: { id: session.userId }, data: { mfaSecretEnc: encrypt(secret) } });
  const qr = await QRCode.toDataURL(otpauthUri(secret, session.user.email), { margin: 1, width: 200 });
  return { secret, qr };
}

/** Step 2: confirms with a code, enables MFA and returns one-time recovery codes. */
export async function confirmMfaAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const session = await currentSession();
    const user = session.user;
    if (user.mfaEnabled || !user.mfaSecretEnc) throw new UserError("errors.invalidCode");
    if (!verifyTotp(decrypt(user.mfaSecretEnc), String(fd.get("code") ?? ""))) throw new UserError("errors.invalidCode");
    const codes = Array.from({ length: 8 }, () => randomToken(6).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8).padEnd(8, "X"));
    await systemDb.user.update({ where: { id: user.id }, data: { mfaEnabled: true, mfaRecoveryCodes: codes.map((c) => sha256(c)) } });
    await updateSession(session.id, { mfaVerifiedAt: new Date() });
    await revokeOtherSessions(user.id, session.id);
    await platformAudit(user.id, "auth.mfaEnabled");
    // No revalidation here: the page must keep showing the one-time recovery codes.
    return okState("account.mfaEnabled", { recoveryCodes: codes.join(" ") });
  } catch (err) {
    return toActionState(err);
  }
}

export async function disableMfaAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const session = await currentSession();
    const user = session.user;
    const { password, code } = z.object({ password: z.string().min(1), code: z.string() }).parse(formObject(fd));
    if (!(await verifyPassword(password, user.passwordHash))) throw new UserError("errors.invalidPassword");
    if (!user.mfaSecretEnc || !verifyTotp(decrypt(user.mfaSecretEnc), code)) throw new UserError("errors.invalidCode");
    await systemDb.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaSecretEnc: null, mfaRecoveryCodes: [] } });
    await revokeOtherSessions(user.id, session.id);
    await platformAudit(user.id, "auth.mfaDisabled");
    revalidatePath("/app", "layout");
    return okState("account.mfaDisabled");
  } catch (err) {
    return toActionState(err);
  }
}

export async function changePasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const session = await currentSession();
    const { current, password } = z.object({ current: z.string().min(1), password: passwordSchema }).parse(formObject(fd));
    if (!(await verifyPassword(current, session.user.passwordHash))) throw new UserError("errors.invalidPassword");
    await systemDb.user.update({ where: { id: session.userId }, data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date() } });
    await revokeOtherSessions(session.userId, session.id);
    await platformAudit(session.userId, "auth.passwordChanged");
    return okState("account.passwordChanged");
  } catch (err) {
    return toActionState(err);
  }
}

export async function updateProfileAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const session = await currentSession();
    const { name, locale } = z.object({ name: z.string().trim().min(2, "validation.required").max(120), locale: z.enum(["nl", "en"]) }).parse(formObject(fd));
    await systemDb.user.update({ where: { id: session.userId }, data: { name, locale } });
    revalidatePath("/", "layout");
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}
