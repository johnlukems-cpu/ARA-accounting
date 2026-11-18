"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { getContext } from "@/core/auth/context";
import { updateSession } from "@/core/auth/session";
import { UnauthenticatedError, UserError } from "@/core/errors";
import { adminActionContext } from "@/modules/admin/guard";
import { bootstrapHome, getHome, type ExpenseCategory } from "@/modules/admin/home";
import * as crm from "@/modules/admin/crm";
import * as products from "@/modules/admin/products";
import * as quotes from "@/modules/admin/quotes";
import * as billing from "@/modules/admin/billing";
import * as payments from "@/modules/admin/payments";
import * as support from "@/modules/admin/support";
import * as expenses from "@/modules/admin/expenses";
import * as staffSvc from "@/modules/admin/staff";
import { approveInvoice, createCreditNoteDraft, markInvoiceSent, postInvoice, submitInvoice } from "@/modules/invoicing/service";
import { bool, formObject, okState, toActionState, type ActionState } from "@/lib/action";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");
async function run(fn: () => Promise<unknown>, paths: string[], message = "common.saved"): Promise<ActionState> {
  try {
    await fn();
    for (const p of paths) revalidatePath(p);
    return okState(message);
  } catch (err) {
    return toActionState(err);
  }
}

// ───────────── Setup and navigation ─────────────

export async function bootstrapHomeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await getContext();
    if (!ctx || !ctx.mfaSatisfied) throw new UnauthenticatedError();
    await bootstrapHome(ctx.user.id, { ...formObject(fd), isBtwRegistered: bool(fd, "isBtwRegistered") } as never);
  } catch (err) {
    return toActionState(err);
  }
  redirect("/admin");
}

/** Opens a page of the accounting app with ARA's own organisation and administration as the active context. */
export async function openHomeBooksAction(fd: FormData) {
  const ctx = await getContext();
  const home = await getHome();
  if (!ctx || !home || !ctx.memberships.some((m) => m.organizationId === home.organizationId)) redirect("/admin");
  await updateSession(ctx.session.id, { activeOrganizationId: home.organizationId, activeCompanyId: home.companyId, activeAdministrationId: home.administrationId, activeFiscalYearId: null });
  const target = s(fd, "to");
  redirect(target.startsWith("/app") ? target : "/app");
}

// ───────────── CRM ─────────────

export async function createCustomerAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  try {
    const c = await adminActionContext("crm.create");
    id = (await crm.createCustomer(c, formObject(fd) as z.input<typeof crm.customerSchema>)).id;
  } catch (err) {
    return toActionState(err);
  }
  redirect(`/admin/customers/${id}`);
}

export async function updateCustomerAction(_p: ActionState, fd: FormData) {
  return run(async () => crm.updateCustomer(await adminActionContext("crm.edit"), s(fd, "id"), formObject(fd) as z.input<typeof crm.customerSchema>), ["/admin/customers", `/admin/customers/${s(fd, "id")}`]);
}

export async function setStageAction(_p: ActionState, fd: FormData) {
  return run(async () => crm.setStage(await adminActionContext("crm.edit"), s(fd, "id"), z.enum(["LEAD", "CONTACTED", "QUALIFIED", "PROPOSAL", "CUSTOMER", "INACTIVE"]).parse(s(fd, "stage")), s(fd, "note")), ["/admin/crm", "/admin/customers", `/admin/customers/${s(fd, "id")}`]);
}

export async function addContactAction(_p: ActionState, fd: FormData) {
  return run(async () => crm.addContact(await adminActionContext("crm.edit"), { ...formObject(fd), isPrimary: bool(fd, "isPrimary") } as z.input<typeof crm.contactSchema>), [`/admin/customers/${s(fd, "customerId")}`]);
}

export async function addActivityAction(_p: ActionState, fd: FormData) {
  return run(async () => crm.addActivity(await adminActionContext("crm.create"), formObject(fd) as z.input<typeof crm.activitySchema>), [`/admin/customers/${s(fd, "customerId")}`, "/admin"]);
}

export async function completeTaskAction(_p: ActionState, fd: FormData) {
  return run(async () => crm.completeTask(await adminActionContext("crm.edit"), s(fd, "activityId")), ["/admin", `/admin/customers/${s(fd, "customerId")}`]);
}

export async function linkOrganizationAction(_p: ActionState, fd: FormData) {
  return run(async () => crm.linkOrganization(await adminActionContext("crm.edit"), s(fd, "customerId"), s(fd, "organizationId") || null), [`/admin/customers/${s(fd, "customerId")}`]);
}

export async function uploadDocumentAction(_p: ActionState, fd: FormData) {
  return run(async () => {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new UserError("validation.required");
    await crm.uploadAdminDocument(await adminActionContext(), { category: s(fd, "category") as never, customerId: s(fd, "customerId"), entity: s(fd, "entity"), entityId: s(fd, "entityId") }, { fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  }, [`/admin/customers/${s(fd, "customerId")}`, "/admin/payments"]);
}

// ───────────── Catalogue ─────────────

export async function saveProductAction(_p: ActionState, fd: FormData) {
  return run(async () => products.saveProduct(await adminActionContext("catalog.edit"), formObject(fd) as z.input<typeof products.productSchema>), ["/admin/products"]);
}

// ───────────── Quotations ─────────────

function quoteLines(fd: FormData) {
  const n = Number(fd.get("lineCount") ?? 0);
  return Array.from({ length: Math.min(n, 200) }, (_, i) => ({
    productId: s(fd, `l${i}.productId`), description: s(fd, `l${i}.description`), quantity: s(fd, `l${i}.quantity`), unitPrice: s(fd, `l${i}.unitPrice`), discountPct: s(fd, `l${i}.discountPct`), taxCodeId: s(fd, `l${i}.taxCodeId`),
  })).filter((l) => l.description || l.productId || l.unitPrice);
}

export async function saveQuoteAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id = s(fd, "id");
  try {
    const c = await adminActionContext(id ? "quotes.edit" : "quotes.create");
    const input = { ...formObject(fd), lines: quoteLines(fd) } as z.input<typeof quotes.quoteSchema>;
    id = (await quotes.saveQuote(c, input, id || undefined)).id;
  } catch (err) {
    return toActionState(err);
  }
  redirect(`/admin/quotations/${id}`);
}

export async function quoteStepAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = s(fd, "id");
  const step = s(fd, "step");
  let invoiceId = "";
  try {
    const c = await adminActionContext();
    if (step === "send") await quotes.sendQuote(c, id, { to: s(fd, "to"), locale: await getLocale() });
    else if (step === "manual") await quotes.sendQuote(c, id, { manual: true });
    else if (step === "accept" || step === "reject") await quotes.decideQuote(c, id, step === "accept" ? "ACCEPTED" : "REJECTED", s(fd, "by"), s(fd, "note"));
    else if (step === "revise") await quotes.reviseQuote(c, id, s(fd, "reason"));
    else if (step === "convert") invoiceId = (await quotes.convertToInvoice(c, id)).id;
    else throw new UserError("validation.invalid");
    revalidatePath(`/admin/quotations/${id}`);
    revalidatePath("/admin/quotations");
  } catch (err) {
    return toActionState(err);
  }
  if (invoiceId) redirect(`/admin/invoices/${invoiceId}`);
  return okState("common.saved");
}

// ───────────── Invoices (ARA's administration, accounting engine) ─────────────

export async function invoiceStepAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = s(fd, "id");
  let redirectTo = "";
  try {
    const c = await adminActionContext("sales.view");
    const step = s(fd, "step");
    if (step === "submit") await submitInvoice(c.access, id);
    else if (step === "approve") await approveInvoice(c.access, id);
    else if (step === "post") await postInvoice(c.access, id);
    else if (step === "markSent") await markInvoiceSent(c.access, id, s(fd, "to") || "handmatig");
    else if (step === "credit") redirectTo = `/admin/invoices/${(await createCreditNoteDraft(c.access, id)).id}`;
    else throw new UserError("validation.invalid");
    revalidatePath(`/admin/invoices/${id}`);
    revalidatePath("/admin/invoices");
  } catch (err) {
    return toActionState(err);
  }
  if (redirectTo) redirect(redirectTo);
  return okState("common.saved");
}

// ───────────── Subscriptions ─────────────

export async function createSubscriptionAction(_p: ActionState, fd: FormData) {
  return run(async () => billing.createSubscription(await adminActionContext("billing.create"), formObject(fd) as z.input<typeof billing.subscriptionSchema>), ["/admin/subscriptions"]);
}

export async function changeSubscriptionAction(_p: ActionState, fd: FormData) {
  return run(async () => billing.changeSubscription(await adminActionContext("billing.edit"), formObject(fd) as z.input<typeof billing.changeSchema>), ["/admin/subscriptions"]);
}

export async function subscriptionStatusAction(_p: ActionState, fd: FormData) {
  return run(async () => billing.setSubscriptionStatus(await adminActionContext("billing.approve"), s(fd, "id"), z.enum(["ACTIVATE", "SUSPEND", "REACTIVATE", "CANCEL"]).parse(s(fd, "step")), s(fd, "reason")), ["/admin/subscriptions"]);
}

export async function runBillingAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const r = await billing.runBilling(await adminActionContext("billing.create"), s(fd, "asOf") || undefined);
    revalidatePath("/admin/subscriptions");
    revalidatePath("/admin/invoices");
    return okState("admin.billing.done", { result: `${r.invoiced.length} / ${r.trialsEnded.length} / ${r.skipped.length}` });
  } catch (err) {
    return toActionState(err);
  }
}

// ───────────── Payments ─────────────

export async function registerPaymentAction(_p: ActionState, fd: FormData) {
  const allocations = fd.getAll("allocInvoice").map((invoiceId, i) => ({ invoiceId: String(invoiceId), amount: String(fd.getAll("allocAmount")[i] ?? "") })).filter((a) => a.invoiceId && a.amount);
  return run(async () => payments.registerPending(await adminActionContext("payments.create"), { ...formObject(fd), allocations } as z.input<typeof payments.paymentSchema>), ["/admin/payments"]);
}

export async function paymentStepAction(_p: ActionState, fd: FormData) {
  return run(async () => {
    const c = await adminActionContext();
    const id = s(fd, "id");
    const step = s(fd, "step");
    if (step === "confirm") await payments.confirmPayment(c, id, s(fd, "verification"));
    else if (step === "fail") await payments.failPayment(c, id, s(fd, "reason"));
    else if (step === "allocate") await payments.allocateRemainder(c, id, s(fd, "invoiceId"), s(fd, "amount"));
    else if (step === "refund") await payments.refundPayment(c, id, { financialAccountId: s(fd, "financialAccountId"), date: s(fd, "date"), amount: s(fd, "amount"), reason: s(fd, "reason") });
    else throw new UserError("validation.invalid");
  }, ["/admin/payments", "/admin/invoices", "/admin/receivables"]);
}

// ───────────── Expenses, support, staff ─────────────

export async function recordExpenseAction(_p: ActionState, fd: FormData) {
  return run(async () => expenses.recordExpense(await adminActionContext("purchase.create"), { ...formObject(fd), category: s(fd, "category") as ExpenseCategory } as z.input<typeof expenses.expenseSchema>), ["/admin/expenses", "/admin/finance"]);
}

export async function createTicketAction(_p: ActionState, fd: FormData) {
  return run(async () => support.createTicket(await adminActionContext("support.create"), formObject(fd) as z.input<typeof support.ticketSchema>), ["/admin/support"]);
}

export async function ticketStepAction(_p: ActionState, fd: FormData) {
  return run(async () => {
    const c = await adminActionContext("support.edit");
    const id = s(fd, "id");
    if (s(fd, "step") === "reply") await support.replyTicket(c, id, s(fd, "body"), bool(fd, "internal"));
    else await support.setTicket(c, id, { status: (s(fd, "status") || undefined) as never, priority: (s(fd, "priority") || undefined) as never, ...(fd.has("assigneeId") ? { assigneeId: s(fd, "assigneeId") || null } : {}) });
  }, ["/admin/support", `/admin/support/${s(fd, "id")}`]);
}

export async function inviteStaffAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const r = await staffSvc.inviteStaff(await adminActionContext("organization.manageUsers"), formObject(fd) as z.input<typeof staffSvc.staffInviteSchema>);
    revalidatePath("/admin/employees");
    const { appUrl, getEmailSender } = await import("@/integrations/email");
    if (!r.invitationToken) return okState("users.addedExisting");
    const link = appUrl(`/invite?token=${r.invitationToken}`);
    const sender = getEmailSender();
    if (sender) {
      await sender.send({ to: s(fd, "email"), subject: "Uitnodiging — ARA Intelligent Solutions", text: `U bent uitgenodigd als medewerker van ARA Intelligent Solutions.\nActiveer uw account via deze link (7 dagen geldig):\n${link}` });
      return okState("users.invitationSent");
    }
    return okState("admin.staff.invited", { link });
  } catch (err) {
    return toActionState(err);
  }
}

export async function staffRoleAction(_p: ActionState, fd: FormData) {
  return run(async () => staffSvc.changeStaffRole(await adminActionContext("organization.manageUsers"), s(fd, "membershipId"), (s(fd, "roleCode") || null) as never, (s(fd, "status") || undefined) as never), ["/admin/employees"]);
}

export async function saveEmployeeAction(_p: ActionState, fd: FormData) {
  return run(async () => staffSvc.saveEmployee(await adminActionContext("organization.manageUsers"), formObject(fd) as z.input<typeof staffSvc.employeeSchema>), ["/admin/employees"]);
}
