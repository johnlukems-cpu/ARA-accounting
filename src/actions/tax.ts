"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireActionContext } from "@/core/auth/context";
import { UserError } from "@/core/errors";
import { parseAmount } from "@/core/money";
import * as tax from "@/modules/tax/service";
import { bool, formObject, okState, toActionState, type ActionState } from "@/lib/action";

const id = (fd: FormData, k: string) => z.string().min(1).parse(fd.get(k));
const amountOf = (raw: string | undefined, locale: unknown) => {
  try {
    return parseAmount(raw ?? "", locale === "en" ? "en" : "nl");
  } catch {
    throw new UserError("budgets.invalidAmountIn", { value: raw ?? "" });
  }
};

export async function prepareReturnAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let returnId: string;
  try {
    const c = await requireActionContext();
    const raw = formObject(fd);
    const kind = z.enum(["BTW", "IB_RECHTSPERSONEN", "DIVIDENDBELASTING"]).parse(raw.taxType);
    const administrationId = id(fd, "administrationId");
    const ret = kind === "BTW"
      ? await tax.prepareBtwReturn(c.access, { administrationId, month: z.string().regex(/^\d{4}-\d{2}$/, "validation.date").parse(raw.month) })
      : kind === "IB_RECHTSPERSONEN"
        ? await tax.prepareIbReturn(c.access, { administrationId, fiscalYearId: id(fd, "fiscalYearId") })
        : await tax.prepareDividend(c.access, { administrationId, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date").parse(raw.date), gross: amountOf(raw.gross, raw.locale) });
    returnId = ret.id;
  } catch (err) {
    return toActionState(err);
  }
  redirect(`/app/tax/${returnId}`);
}

export async function adjustmentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const raw = formObject(fd);
    await tax.addAdjustment(c.access, {
      returnId: id(fd, "returnId"), kind: z.enum(["NON_DEDUCTIBLE", "EXEMPT_INCOME", "DEPRECIATION_DIFFERENCE", "LOSS_OFFSET", "OTHER"]).parse(raw.kind),
      description: z.string().trim().min(3, "validation.required").max(200).parse(raw.description), amount: amountOf(raw.amount, raw.locale),
    });
    revalidatePath(`/app/tax/${raw.returnId}`);
    return okState("tax.adjustmentAdded");
  } catch (err) {
    return toActionState(err);
  }
}

export async function approveReturnAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const returnId = id(fd, "returnId");
    await tax.approveReturn(c.access, { returnId, acknowledgeUnverified: bool(fd, "acknowledge"), explanation: String(fd.get("explanation") ?? "") });
    revalidatePath(`/app/tax/${returnId}`);
    return okState("tax.approved");
  } catch (err) {
    return toActionState(err);
  }
}

export async function fileReturnAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const returnId = id(fd, "returnId");
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new UserError("banking.noFile");
    if (file.size > 4.4 * 1024 * 1024) throw new UserError("scan.requestTooLarge");
    await tax.fileReturn(c.access, { returnId, fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()), reference: String(fd.get("reference") ?? ""), confirmed: bool(fd, "confirm") });
    revalidatePath(`/app/tax/${returnId}`);
    return okState("tax.filed");
  } catch (err) {
    return toActionState(err);
  }
}
