import { systemDb, type Tx } from "@/core/db/client";
import { audit } from "@/core/audit/audit";
import { can, type Access } from "@/core/auth/access";
import { UserError, ForbiddenError } from "@/core/errors";
import { invoicePdfData } from "@/modules/invoicing/pdf-data";
import { renderInvoicePdf } from "@/modules/invoicing/pdf";
import { getHome } from "./home";
import { expireQuotes, quotePdf } from "./quotes";

/**
 * Customer portal ("Mijn ARA-account" inside the customer's own ARA Accounting organisation).
 * The customer's users are NOT members of ARA's organisation, so RLS would hide ARA's records from them. These
 * functions therefore run as trusted server code and filter every query EXPLICITLY on the CRM customer linked to the
 * caller's own organisation. Nothing is returned without that ownership match; issued documents only (no drafts).
 *   Customer Administrator = a member with organization.edit (owner / firm administrator) → may accept quotations.
 *   Customer User          = any member with organization.view → may view and download, and open support tickets.
 */
async function customerFor(access: Access) {
  if (!can(access, "organization.view")) throw new ForbiddenError("organization.view");
  const home = await getHome();
  if (!home || home.organizationId === access.organizationId) return null;
  const customer = await systemDb.crmCustomer.findFirst({ where: { organizationId: home.organizationId, linkedOrganizationId: access.organizationId, status: "ACTIVE" } });
  return customer ? { customer, home } : null;
}

export async function portalOverview(access: Access) {
  const found = await customerFor(access);
  const home = await getHome();
  const tickets = home ? await systemDb.supportTicket.findMany({ where: { organizationId: home.organizationId, requesterOrganizationId: access.organizationId }, orderBy: { createdAt: "desc" }, take: 50, include: { messages: { where: { internal: false }, orderBy: { createdAt: "asc" } } } }) : [];
  if (!found) return { customer: null, subscriptions: [], invoices: [], openItems: [], quotations: [], tickets };
  const { customer, home: h } = found;
  await systemDb.$transaction((tx) => expireQuotes(tx as unknown as Tx));
  const [subscriptions, invoices, openItems, quotations] = await Promise.all([
    systemDb.araSubscription.findMany({ where: { organizationId: h.organizationId, customerId: customer.id }, orderBy: { createdAt: "desc" } }),
    customer.partyId ? systemDb.invoice.findMany({ where: { administrationId: h.administrationId, partyId: customer.partyId, type: "SALES", status: { in: ["POSTED", "PARTIALLY_PAID", "PAID"] } }, orderBy: { invoiceDate: "desc" }, take: 100 }) : [],
    customer.partyId ? systemDb.openItem.findMany({ where: { administrationId: h.administrationId, partyId: customer.partyId, side: "RECEIVABLE", status: "OPEN" }, orderBy: { dueDate: "asc" } }) : [],
    systemDb.quotation.findMany({ where: { organizationId: h.organizationId, customerId: customer.id, status: { not: "DRAFT" } }, orderBy: { quoteDate: "desc" }, take: 50 }),
  ]);
  const products = await systemDb.product.findMany({ where: { organizationId: h.organizationId, id: { in: subscriptions.map((s) => s.productId) } } });
  return { customer: { name: customer.name, number: customer.number }, subscriptions: subscriptions.map((s) => ({ ...s, productName: products.find((p) => p.id === s.productId)?.name ?? "" })), invoices, openItems, quotations, tickets };
}

export async function portalInvoicePdf(access: Access, invoiceId: string, locale: string) {
  const found = await customerFor(access);
  if (!found?.customer.partyId) throw new UserError("errors.notFound");
  const inv = await systemDb.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv || inv.administrationId !== found.home.administrationId || inv.partyId !== found.customer.partyId || !["POSTED", "PARTIALLY_PAID", "PAID"].includes(inv.status)) throw new UserError("errors.notFound");
  const d = await invoicePdfData(systemDb as unknown as Tx, invoiceId, locale);
  if (!d) throw new UserError("errors.notFound");
  await systemDb.$transaction((tx) => audit(tx as unknown as Tx, { organizationId: found.home.organizationId, userId: access.userId, action: "portal.invoiceDownloaded", entity: "Invoice", entityId: invoiceId, details: { by: access.organizationId } }));
  return { number: inv.number ?? invoiceId, bytes: await renderInvoicePdf(d.data) };
}

async function ownQuote(access: Access, id: string) {
  const found = await customerFor(access);
  if (!found) throw new UserError("errors.notFound");
  const q = await systemDb.quotation.findUnique({ where: { id } });
  if (!q || q.organizationId !== found.home.organizationId || q.customerId !== found.customer.id || q.status === "DRAFT") throw new UserError("errors.notFound");
  return { q, home: found.home };
}

/** Opening a sent quotation in the portal records "viewed" (view tracking). */
export async function portalQuotePdf(access: Access, id: string, locale: string) {
  const { q, home } = await ownQuote(access, id);
  return systemDb.$transaction(async (raw) => {
    const tx = raw as unknown as Tx;
    if (q.status === "SENT") await tx.quotation.update({ where: { id }, data: { status: "VIEWED", viewedAt: new Date() } });
    await audit(tx, { organizationId: home.organizationId, userId: access.userId, action: "portal.quoteViewed", entity: "Quotation", entityId: id, details: { by: access.organizationId } });
    return { number: q.number, bytes: await quotePdf(tx, { home }, id, locale) };
  });
}

/** Accept or reject a quotation: only a customer administrator, only while it is open and valid. */
export async function portalDecideQuote(access: Access, id: string, decision: "ACCEPTED" | "REJECTED", userName: string, note?: string) {
  if (!can(access, "organization.edit")) throw new ForbiddenError("organization.edit");
  const { q, home } = await ownQuote(access, id);
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  if (!["SENT", "VIEWED"].includes(q.status)) throw new UserError("ledger.wrongStatus");
  if (q.validUntil < today) throw new UserError("admin.quoteExpired");
  return systemDb.$transaction(async (raw) => {
    const tx = raw as unknown as Tx;
    await tx.quotation.update({ where: { id }, data: { status: decision, decidedAt: new Date(), decidedBy: `${userName} (portaal)`, decisionNote: note?.trim() || null } });
    await tx.crmActivity.create({ data: { organizationId: home.organizationId, customerId: q.customerId, type: "QUOTATION", subject: `Offerte ${q.number} ${decision === "ACCEPTED" ? "geaccepteerd" : "afgewezen"} via het klantportaal`, body: note?.trim() || null, entity: "Quotation", entityId: id, userId: access.userId } });
    await audit(tx, { organizationId: home.organizationId, userId: access.userId, action: decision === "ACCEPTED" ? "quote.accepted" : "quote.rejected", entity: "Quotation", entityId: id, details: { number: q.number, via: "portal", organizationId: access.organizationId } });
  });
}
