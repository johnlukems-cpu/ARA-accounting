import "server-only";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { UserError } from "@/core/errors";

/** Result returned by every form action (rendered by <ActionForm>). */
export type ActionState = {
  ok: boolean;
  message?: string;
  errors?: Record<string, string[]>;
  /** One-time data to show after success (e.g. an invitation link). Never secrets of other users. */
  data?: Record<string, string>;
  ts?: number;
} | null;

/** Converts expected errors into a translated form state; rethrows anything else (incl. redirects). */
export async function toActionState(err: unknown): Promise<ActionState> {
  const t = await getTranslations();
  if (err instanceof z.ZodError) {
    const errors: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const field = String(issue.path[0] ?? "_");
      const key = issue.message?.startsWith("validation.") ? issue.message : "validation.invalid";
      (errors[field] ??= []).push(t(key as never));
    }
    return { ok: false, message: t("validation.fixFields"), errors, ts: Date.now() };
  }
  if (err instanceof UserError) {
    return { ok: false, message: t(err.key as never, err.values as never), ts: Date.now() };
  }
  throw err;
}

export async function okState(messageKey: string, data?: Record<string, string>): Promise<ActionState> {
  const t = await getTranslations();
  return { ok: true, message: t(messageKey as never), data, ts: Date.now() };
}

/** FormData → plain object; repeated keys become arrays; checkboxes are read with `bool`. */
export function formObject(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) out[k] = v;
  return out;
}

export function bool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "true" || v === "1";
}
