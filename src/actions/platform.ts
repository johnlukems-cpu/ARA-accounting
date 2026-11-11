"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext, requireActionContext } from "@/core/auth/context";
import { UnauthenticatedError, UserError } from "@/core/errors";
import * as saas from "@/modules/saas/service";
import * as compliance from "@/modules/compliance/service";
import * as formats from "@/modules/banking/formats";
import * as readiness from "@/modules/readiness/service";
import { bool, formObject, okState, toActionState, type ActionState } from "@/lib/action";

/** Platform actions: every service re-checks isPlatformAdmin (they act across organisations). MFA must be satisfied. */
async function platformUser() {
  const ctx = await getContext();
  if (!ctx || !ctx.mfaSatisfied) throw new UnauthenticatedError();
  return ctx.user.id;
}

const optInt = (v: FormDataEntryValue | null) => (v === null || v === "" ? undefined : Number(v));

export async function savePlanAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const raw = formObject(fd);
    const modules = bool(fd, "allModules") ? "all" : fd.getAll("modules").map(String);
    await saas.savePlan(await platformUser(), { ...raw, modules } as z.input<typeof saas.planSchema>);
    revalidatePath("/app/platform/plans");
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}

export async function trialDaysAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await saas.setTrialDays(await platformUser(), Number(fd.get("trialDays")));
    revalidatePath("/app/platform/plans");
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}

export async function paymentInstructionsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await readiness.setPaymentInstructions(await platformUser(), String(fd.get("paymentInstructions") ?? ""));
    revalidatePath("/app/platform/plans");
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}

export async function recordReviewAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const [subject, subjectKey] = String(fd.get("item") ?? "").split("|");
    const r = await compliance.recordReview(await platformUser(), { ...formObject(fd), subject, subjectKey } as z.input<typeof compliance.reviewSchema>);
    revalidatePath("/app/platform/compliance");
    return okState(r.affected > 0 ? "compliance.recordedApplied" : "compliance.recorded");
  } catch (err) {
    return toActionState(err);
  }
}

function profileFrom(fd: FormData) {
  return {
    delimiter: fd.get("delimiter") === "tab" ? "\t" : String(fd.get("delimiter") ?? ";"),
    hasHeader: bool(fd, "hasHeader"),
    dateColumn: optInt(fd.get("dateColumn")),
    dateFormat: String(fd.get("dateFormat") ?? ""),
    amountColumn: optInt(fd.get("amountColumn")),
    debitColumn: optInt(fd.get("debitColumn")),
    creditColumn: optInt(fd.get("creditColumn")),
    decimalSeparator: String(fd.get("decimalSeparator") ?? ","),
    descriptionColumn: optInt(fd.get("descriptionColumn")),
    counterpartyColumn: optInt(fd.get("counterpartyColumn")),
    counterpartyAccountColumn: optInt(fd.get("counterpartyAccountColumn")),
    referenceColumn: optInt(fd.get("referenceColumn")),
  };
}

export async function saveBankFormatAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await formats.saveFormat(await platformUser(), { id: String(fd.get("id") ?? ""), bankName: String(fd.get("bankName") ?? ""), formatName: String(fd.get("formatName") ?? ""), notes: String(fd.get("notes") ?? ""), profile: profileFrom(fd) } as z.input<typeof formats.formatSchema>);
    revalidatePath("/app/platform/bank-formats");
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}

export async function validateBankFormatAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new UserError("validation.required");
    const text = (await file.text()).replace(/^﻿/, "");
    const r = await formats.validateFormat(await platformUser(), { formatId: String(fd.get("formatId") ?? ""), expectedLineCount: String(fd.get("expectedLineCount") ?? ""), expectedTotalIn: String(fd.get("expectedTotalIn") ?? ""), expectedTotalOut: String(fd.get("expectedTotalOut") ?? ""), confirmRealSample: bool(fd, "confirmRealSample") as true }, text);
    revalidatePath("/app/platform/bank-formats");
    if (r.ok) return okState("bankFormats.validated");
    if ("error" in r && r.error) throw new UserError(r.error.key, r.error.values as Record<string, string | number>);
    throw new UserError("bankFormats.mismatch", { fields: (r.mismatches ?? []).join(", "), count: r.summary?.lineCount ?? 0, totalIn: r.summary?.totalIn ?? "", totalOut: r.summary?.totalOut ?? "" });
  } catch (err) {
    return toActionState(err);
  }
}

export async function retireBankFormatAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await formats.retireFormat(await platformUser(), String(fd.get("formatId") ?? ""));
    revalidatePath("/app/platform/bank-formats");
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}

export async function testEmailAction(_p: ActionState, _fd: FormData): Promise<ActionState> {
  try {
    const r = await readiness.sendTestEmail(await platformUser());
    revalidatePath("/app/platform/readiness");
    if (!r.ok) throw new UserError(`readiness.smtp.${r.code}`);
    return okState("readiness.smtp.sent");
  } catch (err) {
    return toActionState(err);
  }
}

export async function testErrorAction(_p: ActionState, _fd: FormData): Promise<ActionState> {
  try {
    await readiness.sendTestError(await platformUser());
    revalidatePath("/app/platform/readiness");
    return okState("readiness.monitoringSent");
  } catch (err) {
    return toActionState(err);
  }
}

export async function evidenceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await readiness.recordEvidence(await platformUser(), { item: String(fd.get("item") ?? "") as never, reference: String(fd.get("reference") ?? ""), note: String(fd.get("note") ?? ""), confirm: bool(fd, "confirm") as true });
    revalidatePath("/app/platform/readiness");
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}

/** Tenants: apply a validated bank format to one of their bank accounts. */
export async function applyBankFormatAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const accountId = z.string().min(1).parse(fd.get("financialAccountId"));
    await formats.applyFormat(c.access, accountId, z.string().min(1).parse(fd.get("formatId")));
    revalidatePath(`/app/banking/${accountId}`);
    return okState("bankFormats.applied");
  } catch (err) {
    return toActionState(err);
  }
}
