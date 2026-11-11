"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActionContext } from "@/core/auth/context";
import { UserError } from "@/core/errors";
import * as bank from "@/modules/banking/service";
import { bool, formObject, okState, toActionState, type ActionState } from "@/lib/action";

const amount = z.string().trim().transform((v) => v.replace(",", ".")).pipe(z.string().regex(/^\d+(\.\d+)?$/, "validation.amount"));
const optAmount = z.string().trim().transform((v) => v.replace(",", ".")).pipe(z.string().regex(/^(\d+(\.\d+)?)?$/, "validation.amount")).optional().transform((v) => v || undefined);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date");
const done = (fa: string) => revalidatePath(`/app/banking/${fa}`);
/** Columns are shown 1-based to users and stored 0-based. */
const colIn = (v: string | undefined) => (v === undefined || v.trim() === "" ? undefined : String(Number(v) - 1));

export async function saveProfileAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const raw = formObject(fd);
    const profile = bank.importProfileSchema.parse({
      delimiter: raw.delimiter === "tab" ? "\t" : raw.delimiter, hasHeader: bool(fd, "hasHeader"), dateFormat: raw.dateFormat, decimalSeparator: raw.decimalSeparator,
      dateColumn: colIn(raw.dateColumn), amountColumn: colIn(raw.amountColumn), debitColumn: colIn(raw.debitColumn), creditColumn: colIn(raw.creditColumn),
      descriptionColumn: colIn(raw.descriptionColumn), counterpartyColumn: colIn(raw.counterpartyColumn), counterpartyAccountColumn: colIn(raw.counterpartyAccountColumn), referenceColumn: colIn(raw.referenceColumn),
    });
    await bank.saveImportProfile(c.access, z.string().min(1).parse(raw.financialAccountId), profile);
    done(raw.financialAccountId!);
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}

export async function importStatementAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const financialAccountId = z.string().min(1).parse(fd.get("financialAccountId"));
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new UserError("banking.noFile");
    if (file.size > 2 * 1024 * 1024) throw new UserError("banking.fileTooLarge");
    if (!/\.(csv|txt)$/i.test(file.name)) throw new UserError("banking.onlyCsv");
    const content = await file.text();
    const closing = optAmount.parse(fd.get("closingBalance") ?? "");
    const st = await bank.importStatement(c.access, { financialAccountId, fileName: file.name, content, closingBalance: closing });
    done(financialAccountId);
    return okState("banking.imported", { summary: `${st.lineCount} / ${st.duplicateLines}` });
  } catch (err) {
    return toActionState(err);
  }
}

export async function matchAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const raw = formObject(fd);
    const input = z.object({ transactionId: z.string().min(1), openItemId: z.string().min(1), amount, exchangeRate: optAmount }).parse(raw);
    await bank.matchToOpenItems(c.access, { transactionId: input.transactionId, allocations: [{ openItemId: input.openItemId, amount: input.amount }], exchangeRate: input.exchangeRate });
    done(raw.financialAccountId!);
    return okState("banking.matched");
  } catch (err) {
    return toActionState(err);
  }
}

export async function bookAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const raw = formObject(fd);
    const input = z.object({ transactionId: z.string().min(1), accountId: z.string().min(1, "validation.required"), description: z.string().max(300).optional(), amount: optAmount, exchangeRate: optAmount }).parse(raw);
    await bank.bookToAccount(c.access, input);
    done(raw.financialAccountId!);
    return okState("banking.booked");
  } catch (err) {
    return toActionState(err);
  }
}

export async function ignoreAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const raw = formObject(fd);
    const input = z.object({ transactionId: z.string().min(1), reason: z.string().trim().min(3, "validation.required").max(300) }).parse(raw);
    await bank.ignoreTransaction(c.access, input.transactionId, input.reason);
    done(raw.financialAccountId!);
    return okState("banking.ignored");
  } catch (err) {
    return toActionState(err);
  }
}

export async function transferAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const raw = formObject(fd);
    const input = z.object({ fromId: z.string().min(1), toId: z.string().min(1, "validation.required"), date, amountFrom: amount, amountTo: optAmount, rateFrom: optAmount, rateTo: optAmount, description: z.string().max(300).optional() }).parse(raw);
    await bank.transferFunds(c.access, input);
    done(input.fromId);
    return okState("banking.transferred");
  } catch (err) {
    return toActionState(err);
  }
}

export async function cashEntryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const raw = formObject(fd);
    const input = z.object({
      financialAccountId: z.string().min(1), date, direction: z.enum(["IN", "OUT"]), amount, accountId: z.string().min(1, "validation.required"),
      taxCodeId: z.string().optional().transform((v) => v || undefined), description: z.string().trim().min(2, "validation.required").max(300), exchangeRate: optAmount,
    }).parse(raw);
    await bank.cashEntry(c.access, input);
    done(input.financialAccountId);
    return okState("banking.cashBooked");
  } catch (err) {
    return toActionState(err);
  }
}

export async function reconcileAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const raw = formObject(fd);
    const input = z.object({ financialAccountId: z.string().min(1), periodEnd: date, statementBalance: z.string().trim().transform((v) => v.replace(",", ".")).pipe(z.string().regex(/^-?\d+(\.\d+)?$/, "validation.amount")), notes: z.string().max(500).optional() }).parse(raw);
    await bank.reconcile(c.access, input);
    done(input.financialAccountId);
    return okState("banking.reconciliationSaved");
  } catch (err) {
    return toActionState(err);
  }
}

export async function approveReconciliationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const raw = formObject(fd);
    await bank.approveReconciliation(c.access, z.string().min(1).parse(raw.id));
    done(raw.financialAccountId!);
    return okState("banking.reconciliationApprovedMsg");
  } catch (err) {
    return toActionState(err);
  }
}
