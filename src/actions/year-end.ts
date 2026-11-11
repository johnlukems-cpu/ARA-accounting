"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActionContext } from "@/core/auth/context";
import { UserError } from "@/core/errors";
import { parseAmount } from "@/core/money";
import * as ye from "@/modules/year-end/service";
import { formObject, okState, toActionState, type ActionState } from "@/lib/action";

const done = () => revalidatePath("/app/year-end");
const id = (fd: FormData, k: string) => z.string().min(1).parse(fd.get(k));

export async function startYearEndAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    await ye.startYearEnd(c.access, id(fd, "fiscalYearId"));
    done();
    return okState("yearEnd.started");
  } catch (err) {
    return toActionState(err);
  }
}

export async function checklistItemAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    await ye.setItem(c.access, id(fd, "itemId"), z.enum(["COMPLETED", "NOT_APPLICABLE", "OPEN"]).parse(fd.get("status")), String(fd.get("comment") ?? ""));
    done();
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}

export async function yearEndStepAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const step = z.enum(["submit", "approve", "return", "close", "reopen"]).parse(fd.get("step"));
    const closingId = id(fd, "closingId");
    const reason = String(fd.get("reason") ?? "");
    if (step === "submit") await ye.submitYearEnd(c.access, closingId);
    if (step === "approve") await ye.reviewYearEnd(c.access, closingId, "APPROVE");
    if (step === "return") await ye.reviewYearEnd(c.access, closingId, "RETURN", reason);
    if (step === "close") await ye.closeYear(c.access, closingId);
    if (step === "reopen") await ye.reopenYear(c.access, closingId, reason);
    done();
    return okState(`yearEnd.step.${step}`);
  } catch (err) {
    return toActionState(err);
  }
}

export async function adjustmentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const raw = formObject(fd);
    let amount: string;
    try {
      amount = parseAmount(raw.amount ?? "", raw.locale === "en" ? "en" : "nl");
    } catch {
      throw new UserError("budgets.invalidAmountIn", { value: raw.amount ?? "" });
    }
    await ye.postAdjustment(c.access, {
      closingId: id(fd, "closingId"), debitAccountId: z.string().min(1, "validation.required").parse(raw.debitAccountId), creditAccountId: z.string().min(1, "validation.required").parse(raw.creditAccountId),
      amount, description: z.string().trim().min(3, "validation.required").max(300).parse(raw.description),
    });
    done();
    return okState("yearEnd.adjustmentPosted");
  } catch (err) {
    return toActionState(err);
  }
}
