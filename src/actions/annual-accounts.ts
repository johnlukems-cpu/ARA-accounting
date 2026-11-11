"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActionContext } from "@/core/auth/context";
import * as annual from "@/modules/annual-accounts/service";
import { formObject, okState, toActionState, type ActionState } from "@/lib/action";

const done = () => revalidatePath("/app/annual-accounts");

export async function generateAnnualAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const raw = formObject(fd);
    await annual.generateAnnualAccount(c.access, { administrationId: z.string().min(1).parse(raw.administrationId), fiscalYearId: z.string().min(1).parse(raw.fiscalYearId), framework: z.enum(["NV_IFRS_SME", "NV_FULL_IFRS", "SOLE_PROPRIETOR", "FOUNDATION"]).parse(raw.framework) });
    done();
    return okState("annual.generated");
  } catch (err) {
    return toActionState(err);
  }
}

export async function saveNoteAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const raw = formObject(fd);
    await annual.saveDisclosure(c.access, { annualAccountId: z.string().min(1).parse(raw.annualAccountId), code: z.string().trim().min(1, "validation.required").parse(raw.code), title: z.string().trim().min(2, "validation.required").parse(raw.title), body: z.string().trim().min(2, "validation.required").parse(raw.body) });
    done();
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}

export async function annualStepAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const step = z.enum(["submit", "approve", "return", "finalize"]).parse(fd.get("step"));
    await annual.annualStep(c.access, z.string().min(1).parse(fd.get("annualAccountId")), step);
    done();
    return okState(`annual.step.${step}`);
  } catch (err) {
    return toActionState(err);
  }
}
