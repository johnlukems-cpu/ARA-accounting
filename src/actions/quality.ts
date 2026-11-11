"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActionContext } from "@/core/auth/context";
import * as quality from "@/modules/quality/service";
import { okState, toActionState, type ActionState } from "@/lib/action";

export async function scanAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const r = await quality.scanNow(c.access, z.string().min(1).parse(fd.get("administrationId")));
    revalidatePath("/app/quality");
    return okState(r.newIssues ? "quality.scannedNew" : "quality.scanned");
  } catch (err) {
    return toActionState(err);
  }
}

export async function issueAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const status = fd.get("status") ? z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "ACCEPTED", "FALSE_POSITIVE"]).parse(fd.get("status")) : undefined;
    const assignee = fd.get("assigneeId");
    await quality.updateIssue(c.access, { issueId: z.string().min(1).parse(fd.get("issueId")), status, note: String(fd.get("note") ?? ""), assigneeId: assignee === null ? undefined : String(assignee) || null });
    revalidatePath("/app/quality");
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}
