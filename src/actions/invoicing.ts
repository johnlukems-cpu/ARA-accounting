"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { requireActionContext } from "@/core/auth/context";
import { assertCan } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { UserError } from "@/core/errors";
import * as svc from "@/modules/invoicing/service";
import { financialAccountSchema, invoiceSchema, offsetSchema, partySchema, paymentSchema } from "@/modules/invoicing/schemas";
import { invoicePdfData } from "@/modules/invoicing/pdf-data";
import { renderInvoicePdf } from "@/modules/invoicing/pdf";
import { getEmailSender } from "@/integrations/email";
import { bool, formObject, okState, toActionState, type ActionState } from "@/lib/action";

const path = (type: string) => (type === "SALES" ? "/app/sales" : "/app/purchase");

export async function savePartyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const c = await requireActionContext();
    const raw = formObject(fd);
    const party = await svc.saveParty(c.access, partySchema.parse({ ...raw, isCustomer: bool(fd, "isCustomer"), isSupplier: bool(fd, "isSupplier") }), raw.id || undefined);
    id = party!.id;
    if (raw.id) {
      revalidatePath(`/app/relations/${id}`);
      return okState("common.saved");
    }
  } catch (err) {
    return toActionState(err);
  }
  redirect(`/app/relations/${id}`);
}

export async function saveInvoiceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let target: string;
  try {
    const c = await requireActionContext();
    const input = invoiceSchema.parse(JSON.parse(String(fd.get("payload") ?? "{}")));
    const inv = await svc.saveInvoice(c.access, input);
    if (fd.get("intent") === "post") await svc.postInvoice(c.access, inv!.id);
    target = `${path(input.type)}/${inv!.id}`;
  } catch (err) {
    if (err instanceof SyntaxError) return toActionState(new UserError("validation.invalid"));
    return toActionState(err);
  }
  revalidatePath("/app", "layout");
  redirect(target);
}

export async function invoiceTransitionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let target: string | null = null;
  try {
    const c = await requireActionContext();
    const { id, intent, type } = z.object({ id: z.string().min(1), intent: z.enum(["submit", "approve", "post", "delete", "credit"]), type: z.enum(["SALES", "PURCHASE"]) }).parse(formObject(fd));
    if (intent === "submit") await svc.submitInvoice(c.access, id);
    else if (intent === "approve") await svc.approveInvoice(c.access, id);
    else if (intent === "post") await svc.postInvoice(c.access, id);
    else if (intent === "delete") {
      await svc.deleteDraftInvoice(c.access, id);
      target = path(type);
    } else {
      const cn = await svc.createCreditNoteDraft(c.access, id);
      target = `${path(type)}/${cn!.id}/edit`;
    }
    revalidatePath("/app", "layout");
    if (!target) return okState(`invoicing.transition.${intent}`);
  } catch (err) {
    return toActionState(err);
  }
  redirect(target);
}

/** Sends a posted sales invoice as PDF. Without SMTP configuration nothing is sent and the user is told so. */
export async function sendInvoiceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const { id, to } = z.object({ id: z.string().min(1), to: z.string().trim().toLowerCase().email("validation.email") }).parse(formObject(fd));
    const sender = getEmailSender();
    if (!sender) throw new UserError("invoicing.emailNotConfigured");
    const locale = await getLocale();
    const r = await withTenant(c.access, (tx) => invoicePdfData(tx, id, locale));
    if (!r || r.type !== "SALES") throw new UserError("errors.notFound");
    assertCan(c.access, "sales.post", r.companyId);
    if (!r.posted) throw new UserError("invoicing.notPosted");
    const pdf = await renderInvoicePdf(r.data);
    await sender.send({
      to,
      subject: `${r.data.invoice.title} ${r.data.invoice.number} — ${r.data.seller.name}`,
      text: `${r.data.invoice.title} ${r.data.invoice.number}\n${r.data.labels.totalGross}: ${r.data.invoice.currency} ${r.data.totals.gross}\n${r.data.labels.dueDate}: ${r.data.invoice.dueDate}`,
      attachments: [{ filename: `${r.data.invoice.number}.pdf`, content: pdf, contentType: "application/pdf" }],
    });
    await svc.markInvoiceSent(c.access, id, to);
    revalidatePath(`/app/sales/${id}`);
    return okState("invoicing.sent");
  } catch (err) {
    return toActionState(err);
  }
}

export async function registerPaymentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    const raw = formObject(fd);
    const allocations = raw.openItemId ? [{ openItemId: raw.openItemId, amount: raw.allocate || raw.amount }] : [];
    await svc.registerPayment(c.access, paymentSchema.parse({ ...raw, allocations }));
    revalidatePath("/app", "layout");
    return okState("invoicing.paymentRegistered");
  } catch (err) {
    return toActionState(err);
  }
}

export async function offsetItemsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    await svc.offsetItems(c.access, offsetSchema.parse(formObject(fd)));
    revalidatePath("/app", "layout");
    return okState("invoicing.offsetDone");
  } catch (err) {
    return toActionState(err);
  }
}

export async function createFinancialAccountAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext();
    await svc.createFinancialAccount(c.access, financialAccountSchema.parse(formObject(fd)));
    revalidatePath("/app/banking");
    return okState("invoicing.financialAccountCreated");
  } catch (err) {
    return toActionState(err);
  }
}
