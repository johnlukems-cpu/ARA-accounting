"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActionContext } from "@/core/auth/context";
import { UserError } from "@/core/errors";
import * as fx from "@/modules/currency/service";
import { bool, formObject, okState, toActionState, type ActionState } from "@/lib/action";

const done = () => revalidatePath("/app/currency");
const id = (fd: FormData, key = "id") => z.string().min(1).parse(fd.get(key));

export async function createRateAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    await fx.createRate(c.access, fx.rateSchema.parse(formObject(fd)));
    done();
    return okState("currency.rateCreated");
  } catch (err) {
    return toActionState(err);
  }
}

export async function decideRateAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const decision = z.enum(["APPROVED", "REJECTED"]).parse(fd.get("decision"));
    await fx.decideRate(c.access, id(fd), decision);
    done();
    return okState(decision === "APPROVED" ? "currency.rateApproved" : "currency.rateRejected");
  } catch (err) {
    return toActionState(err);
  }
}

export async function importCbvsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new UserError("banking.noFile");
    if (file.size > 1024 * 1024) throw new UserError("banking.fileTooLarge");
    if (!/\.(csv|txt)$/i.test(file.name)) throw new UserError("banking.onlyCsv");
    const base = z.string().regex(/^[A-Z]{3}$/).parse(fd.get("baseCurrency") ?? "SRD");
    const r = await fx.importCbvsRates(c.access, { baseCurrency: base, content: await file.text(), fileName: file.name });
    done();
    return okState("currency.imported", { summary: `${r.created} / ${r.skipped}` });
  } catch (err) {
    return toActionState(err);
  }
}

export async function savePolicyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const raw = formObject(fd);
    await fx.setPolicy(c.access, id(fd, "administrationId"), {
      sales: raw.sales, purchase: raw.purchase, revaluation: raw.revaluation, maxAgeDays: raw.maxAgeDays, requireApproved: bool(fd, "requireApproved"),
      revaluationMode: raw.revaluationMode, monetaryAccounts: (raw.monetaryAccounts ?? "").split(/[\s,;]+/).filter(Boolean),
    });
    done();
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}

export async function proposeRevaluationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const r = await fx.proposeRevaluation(c.access, { administrationId: id(fd, "administrationId"), periodId: id(fd, "periodId") });
    done();
    return okState("currency.revaluationProposed", { total: r.total });
  } catch (err) {
    return toActionState(err);
  }
}

export async function revaluationStepAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const step = z.enum(["cancel", "post", "completeReversal", "reverse"]).parse(fd.get("step"));
    const rid = id(fd);
    if (step === "cancel") await fx.cancelRevaluation(c.access, rid);
    if (step === "post") await fx.postRevaluation(c.access, rid);
    if (step === "completeReversal") await fx.completeReversal(c.access, rid);
    if (step === "reverse") await fx.reverseRevaluation(c.access, rid, z.string().trim().min(3, "validation.required").parse(fd.get("reason")));
    done();
    return okState(`currency.step.${step}`);
  } catch (err) {
    return toActionState(err);
  }
}
