"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActionContext, getContext } from "@/core/auth/context";
import { UnauthenticatedError } from "@/core/errors";
import * as saas from "@/modules/saas/service";
import * as practice from "@/modules/practice/service";
import { bool, formObject, okState, toActionState, type ActionState } from "@/lib/action";

/** Platform actions: the service checks isPlatformAdmin itself (they act across organisations). */
async function platformUser() {
  const ctx = await getContext();
  if (!ctx || !ctx.mfaSatisfied) throw new UnauthenticatedError();
  return ctx.user.id;
}
const doneP = () => revalidatePath("/app/platform");

export async function savePlanAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await saas.savePlan(await platformUser(), formObject(fd) as z.input<typeof saas.planSchema>);
    doneP();
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}

export async function setSubscriptionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await saas.setSubscription(await platformUser(), formObject(fd) as z.input<typeof saas.subscriptionSchema>);
    doneP();
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}

export async function createSubscriptionInvoiceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await saas.createSubscriptionInvoice(await platformUser(), formObject(fd) as z.input<typeof saas.subscriptionInvoiceSchema>);
    doneP();
    return okState("saas.invoiceCreated");
  } catch (err) {
    return toActionState(err);
  }
}

export async function invoiceStepAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await platformUser();
    const invoiceId = z.string().min(1).parse(fd.get("invoiceId"));
    if (fd.get("step") === "void") await saas.voidSubscriptionInvoice(user, invoiceId, String(fd.get("reference") ?? ""));
    else await saas.confirmPayment(user, { invoiceId, reference: String(fd.get("reference") ?? ""), reactivate: bool(fd, "reactivate") });
    doneP();
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}

export async function createTaskAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    await practice.createTask(c.access, formObject(fd) as z.input<typeof practice.taskSchema>);
    revalidatePath("/app/practice");
    return okState("practice.taskCreated");
  } catch (err) {
    return toActionState(err);
  }
}

export async function taskStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    await practice.setTaskStatus(c.access, z.string().min(1).parse(fd.get("taskId")), z.enum(["OPEN", "DONE"]).parse(fd.get("status")));
    revalidatePath("/app/practice");
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}
