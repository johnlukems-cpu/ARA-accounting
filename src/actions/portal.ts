"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActionContext } from "@/core/auth/context";
import { portalDecideQuote } from "@/modules/admin/portal";
import { portalCreateTicket, portalReply, type ticketSchema } from "@/modules/admin/support";
import { formObject, okState, toActionState, type ActionState } from "@/lib/action";

/** Customer portal actions: always for the caller's OWN organisation; ownership is re-checked in the service. */
export async function portalQuoteAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext("organization.view");
    const decision = z.enum(["ACCEPTED", "REJECTED"]).parse(fd.get("decision"));
    await portalDecideQuote(c.access, String(fd.get("id") ?? ""), decision, c.user.name, String(fd.get("note") ?? ""));
    revalidatePath("/app/ara");
    return okState(decision === "ACCEPTED" ? "portal.accepted" : "portal.rejected");
  } catch (err) {
    return toActionState(err);
  }
}

export async function portalTicketAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext("organization.view");
    await portalCreateTicket({ userId: c.user.id, organizationId: c.access.organizationId }, formObject(fd) as z.input<typeof ticketSchema>);
    revalidatePath("/app/ara");
    return okState("portal.ticketCreated");
  } catch (err) {
    return toActionState(err);
  }
}

export async function portalReplyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext("organization.view");
    await portalReply({ userId: c.user.id, organizationId: c.access.organizationId }, String(fd.get("ticketId") ?? ""), String(fd.get("body") ?? ""));
    revalidatePath("/app/ara");
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}
