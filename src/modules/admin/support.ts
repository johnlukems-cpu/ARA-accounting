import { z } from "zod";
import { systemDb } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { audit } from "@/core/audit/audit";
import { UserError } from "@/core/errors";
import { inHome, nextNumber } from "./common";
import { logActivity } from "./crm";
import { getHome, type AdminContext, type Home } from "./home";

export const ticketSchema = z.object({
  subject: z.string().trim().min(3, "validation.required").max(200),
  body: z.string().trim().min(3, "validation.required").max(8000),
  category: z.string().trim().max(60).optional().transform((v) => v || null),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  customerId: z.string().optional().transform((v) => v || null),
});

export async function createTicket(ctx: AdminContext, raw: z.input<typeof ticketSchema>) {
  const input = ticketSchema.parse(raw);
  return inHome(ctx, "support.create", async (tx) => {
    if (input.customerId && !(await tx.crmCustomer.findUnique({ where: { id: input.customerId } }))) throw new UserError("errors.notFound");
    const number = await nextNumber(tx, ctx, "TIC", new Date().getUTCFullYear());
    const t = await tx.supportTicket.create({ data: { organizationId: ctx.home.organizationId, number, customerId: input.customerId, subject: input.subject, category: input.category, priority: input.priority, assigneeId: ctx.access.userId } });
    await tx.supportMessage.create({ data: { organizationId: ctx.home.organizationId, ticketId: t.id, authorUserId: ctx.access.userId, authorKind: "STAFF", body: input.body } });
    if (input.customerId) await logActivity(tx, ctx, input.customerId, "SUPPORT", `Ticket ${number}: ${input.subject}`, { entity: "SupportTicket", entityId: t.id });
    await audit(tx, { organizationId: ctx.home.organizationId, userId: ctx.access.userId, action: "support.ticketCreated", entity: "SupportTicket", entityId: t.id, details: { number } });
    return t;
  });
}

export async function replyTicket(ctx: AdminContext, ticketId: string, body: string, internal: boolean) {
  if (!body?.trim()) throw new UserError("validation.required");
  return inHome(ctx, "support.edit", async (tx) => {
    const t = await tx.supportTicket.findUnique({ where: { id: ticketId } });
    if (!t) throw new UserError("errors.notFound");
    await tx.supportMessage.create({ data: { organizationId: ctx.home.organizationId, ticketId, authorUserId: ctx.access.userId, authorKind: "STAFF", body: body.trim().slice(0, 8000), internal } });
    if (!internal && t.status === "OPEN") await tx.supportTicket.update({ where: { id: ticketId }, data: { status: "IN_PROGRESS" } });
    // Notify the customer's requester (in their own organisation) about a public reply.
    if (!internal && t.requesterUserId && t.requesterOrganizationId) {
      await systemDb.notification.create({ data: { organizationId: t.requesterOrganizationId, userId: t.requesterUserId, type: "supportReply", params: { number: t.number }, link: "/app/ara" } });
    }
  });
}

export async function setTicket(ctx: AdminContext, ticketId: string, data: { status?: "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED"; assigneeId?: string | null; priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT" }) {
  return inHome(ctx, "support.edit", async (tx) => {
    const t = await tx.supportTicket.findUnique({ where: { id: ticketId } });
    if (!t) throw new UserError("errors.notFound");
    await tx.supportTicket.update({ where: { id: ticketId }, data });
    await audit(tx, { organizationId: ctx.home.organizationId, userId: ctx.access.userId, action: "support.ticketUpdated", entity: "SupportTicket", entityId: ticketId, details: data });
  });
}

/**
 * Customer portal: a customer's user opens a ticket. Runs as trusted code in ARA's tenant on behalf of the requester;
 * the ticket is linked to the requester's organisation and, when known, to the CRM customer linked to it.
 */
export async function portalCreateTicket(requester: { userId: string; organizationId: string }, raw: z.input<typeof ticketSchema>) {
  const input = ticketSchema.parse({ ...raw, customerId: "" });
  const home = await getHome();
  if (!home) throw new UserError("admin.noHome");
  return withTenant({ organizationId: home.organizationId, userId: requester.userId }, async (tx) => {
    const customer = await tx.crmCustomer.findFirst({ where: { linkedOrganizationId: requester.organizationId } });
    const n = await nextNumber(tx, { home } as AdminContext, "TIC", new Date().getUTCFullYear());
    const t = await tx.supportTicket.create({ data: { organizationId: home.organizationId, number: n, customerId: customer?.id ?? null, requesterOrganizationId: requester.organizationId, requesterUserId: requester.userId, subject: input.subject, category: input.category, priority: input.priority } });
    await tx.supportMessage.create({ data: { organizationId: home.organizationId, ticketId: t.id, authorUserId: requester.userId, authorKind: "CUSTOMER", body: input.body } });
    if (customer) await tx.crmActivity.create({ data: { organizationId: home.organizationId, customerId: customer.id, type: "SUPPORT", subject: `Ticket ${n}: ${input.subject}`.slice(0, 200), entity: "SupportTicket", entityId: t.id, userId: requester.userId } });
    await audit(tx, { organizationId: home.organizationId, userId: requester.userId, action: "support.portalTicket", entity: "SupportTicket", entityId: t.id, details: { number: n, from: requester.organizationId } });
    return t;
  });
}

/** Customer portal: reply on one's own ticket (ownership = requester organisation). */
export async function portalReply(requester: { userId: string; organizationId: string }, ticketId: string, body: string) {
  if (!body?.trim()) throw new UserError("validation.required");
  const home = (await getHome()) as Home;
  return withTenant({ organizationId: home.organizationId, userId: requester.userId }, async (tx) => {
    const t = await tx.supportTicket.findUnique({ where: { id: ticketId } });
    if (!t || t.requesterOrganizationId !== requester.organizationId) throw new UserError("errors.notFound");
    await tx.supportMessage.create({ data: { organizationId: home.organizationId, ticketId, authorUserId: requester.userId, authorKind: "CUSTOMER", body: body.trim().slice(0, 8000) } });
    if (t.status === "WAITING_CUSTOMER" || t.status === "RESOLVED") await tx.supportTicket.update({ where: { id: ticketId }, data: { status: "OPEN" } });
  });
}
