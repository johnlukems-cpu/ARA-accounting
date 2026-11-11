"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireActionContext } from "@/core/auth/context";
import { UserError } from "@/core/errors";
import { parseAmount, MoneyError } from "@/core/money";
import * as budgets from "@/modules/budgets/service";
import { formObject, okState, toActionState, type ActionState } from "@/lib/action";

const id = (fd: FormData, key: string) => z.string().min(1).parse(fd.get(key));
const done = (budgetId: string) => revalidatePath(`/app/budgets/${budgetId}`);

export async function createBudgetAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let budgetId: string;
  try {
    const c = await requireActionContext();
    const { budget } = await budgets.createBudget(c.access, formObject(fd) as z.input<typeof budgets.budgetSchema>);
    budgetId = budget.id;
  } catch (err) {
    return toActionState(err);
  }
  redirect(`/app/budgets/${budgetId}`);
}

/** Grid form: inputs named `c:<accountId>:<period>`; empty = 0. */
export async function saveCellsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const cells: { accountId: string; period: number; amount: string }[] = [];
    for (const [key, value] of fd.entries()) {
      const m = /^c:([^:]+):(\d{1,2})$/.exec(key);
      if (!m) continue;
      const raw = String(value).trim();
      let amount = "0";
      if (raw) {
        try {
          amount = parseAmount(raw, fd.get("locale") === "en" ? "en" : "nl");
        } catch (e) {
          if (e instanceof MoneyError) throw new UserError("budgets.invalidAmountIn", { value: raw });
          throw e;
        }
      }
      cells.push({ accountId: m[1]!, period: Number(m[2]), amount });
    }
    await budgets.saveCells(c.access, id(fd, "versionId"), cells);
    done(id(fd, "budgetId"));
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}

export async function distributeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const raw = formObject(fd);
    let amount: string;
    try {
      amount = parseAmount(raw.amount ?? "", raw.locale === "en" ? "en" : "nl");
    } catch {
      throw new UserError("budgets.invalidAmountIn", { value: raw.amount ?? "" });
    }
    await budgets.distributeYear(c.access, { versionId: id(fd, "versionId"), accountId: z.string().min(1, "validation.required").parse(raw.accountId), amount, method: z.enum(["EVEN", "PRIOR_YEAR"]).parse(raw.method) });
    done(id(fd, "budgetId"));
    return okState("budgets.distributed");
  } catch (err) {
    return toActionState(err);
  }
}

export async function importBudgetAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new UserError("banking.noFile");
    if (file.size > 1024 * 1024) throw new UserError("banking.fileTooLarge");
    if (!/\.(csv|txt)$/i.test(file.name)) throw new UserError("banking.onlyCsv");
    const r = await budgets.importLines(c.access, id(fd, "versionId"), await file.text());
    done(id(fd, "budgetId"));
    return okState("budgets.imported", { summary: String(r.lines) });
  } catch (err) {
    return toActionState(err);
  }
}

export async function budgetWorkflowAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const step = z.enum(["submit", "approve", "return", "newVersion"]).parse(fd.get("step"));
    const budgetId = id(fd, "budgetId");
    if (step === "submit") await budgets.submitVersion(c.access, id(fd, "versionId"));
    if (step === "approve") await budgets.approveVersion(c.access, id(fd, "versionId"));
    if (step === "return") await budgets.returnToDraft(c.access, id(fd, "versionId"), z.string().trim().min(3, "validation.required").parse(fd.get("reason")));
    if (step === "newVersion") await budgets.newVersion(c.access, budgetId, String(fd.get("notes") ?? ""));
    done(budgetId);
    return okState(`budgets.step.${step}`);
  } catch (err) {
    return toActionState(err);
  }
}
