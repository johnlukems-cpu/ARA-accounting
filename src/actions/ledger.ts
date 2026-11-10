"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireActionContext } from "@/core/auth/context";
import { UserError } from "@/core/errors";
import * as ledger from "@/modules/ledger/service";
import { accountSchema, accountUpdateSchema, dimensionSchema, entrySchema, journalSchema, reverseSchema } from "@/modules/ledger/schemas";
import { bool, formObject, okState, toActionState, type ActionState } from "@/lib/action";

export async function createAccountAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    await ledger.createAccount(c.access, accountSchema.parse(formObject(fd)));
    revalidatePath("/app/ledger/accounts");
    return okState("ledger.accountCreated");
  } catch (err) {
    return toActionState(err);
  }
}

export async function updateAccountAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    await ledger.updateAccount(c.access, accountUpdateSchema.parse(formObject(fd)));
    revalidatePath("/app/ledger/accounts");
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}

export async function saveJournalAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const raw = formObject(fd);
    await ledger.saveJournal(c.access, { ...journalSchema.parse({ ...raw, requiresApproval: bool(fd, "requiresApproval") }), id: raw.id || undefined });
    revalidatePath("/app/ledger/journals");
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}

export async function createDimensionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    await ledger.createDimension(c.access, dimensionSchema.parse(formObject(fd)));
    revalidatePath("/app/ledger/dimensions");
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}

/** Saves a draft entry from the entry editor (lines arrive as JSON). Optionally posts it right away. */
export async function saveEntryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const c = await requireActionContext();
    const payload = JSON.parse(String(fd.get("payload") ?? "{}"));
    const input = entrySchema.parse(payload);
    const entryId = typeof payload.entryId === "string" && payload.entryId ? payload.entryId : undefined;
    const entry = await ledger.saveDraft(c.access, input, entryId);
    if (fd.get("intent") === "post") await ledger.post(c.access, entry.id);
    id = entry.id;
  } catch (err) {
    if (err instanceof SyntaxError) return toActionState(new UserError("validation.invalid"));
    return toActionState(err);
  }
  revalidatePath("/app/ledger", "layout");
  redirect(`/app/ledger/entries/${id}`);
}

const idSchema = z.object({ id: z.string().min(1) });

export async function entryTransitionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let redirectTo: string | null = null;
  try {
    const c = await requireActionContext();
    const { id } = idSchema.parse(formObject(fd));
    const intent = String(fd.get("intent"));
    if (intent === "submit") await ledger.submit(c.access, id);
    else if (intent === "approve") await ledger.approve(c.access, id);
    else if (intent === "post") await ledger.post(c.access, id);
    else if (intent === "delete") {
      await ledger.removeDraft(c.access, id);
      redirectTo = "/app/ledger/entries";
    } else throw new UserError("validation.invalid");
    revalidatePath("/app/ledger", "layout");
    if (!redirectTo) return okState(`ledger.transition.${intent}`);
  } catch (err) {
    return toActionState(err);
  }
  redirect(redirectTo);
}

export async function reverseEntryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const c = await requireActionContext();
    const input = reverseSchema.parse(formObject(fd));
    const result = await ledger.reverse(c.access, input);
    id = result.id;
  } catch (err) {
    return toActionState(err);
  }
  revalidatePath("/app/ledger", "layout");
  redirect(`/app/ledger/entries/${id}`);
}
