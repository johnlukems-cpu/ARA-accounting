import { z } from "zod";
import { createHash } from "node:crypto";
import type { CrmActivityType, CrmStage, Prisma } from "@prisma/client";
import type { Tx } from "@/core/db/client";
import { audit } from "@/core/audit/audit";
import { UserError } from "@/core/errors";
import { partySchema } from "@/modules/invoicing/schemas";
import { sniffMime } from "@/modules/scan/domain";
import { activeBackend, getFile, putFile } from "@/integrations/storage";
import { assertCan } from "@/core/auth/access";
import { inHome, nextNumber, newId } from "./common";
import type { AdminContext } from "./home";

const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);

export const customerSchema = z.object({
  kind: z.enum(["COMPANY", "PERSON"]).default("COMPANY"),
  name: z.string().trim().min(2, "validation.required").max(160),
  legalName: opt(200), category: opt(60), source: opt(60), kkfNumber: opt(30), taxNumber: opt(30),
  email: z.string().trim().toLowerCase().email("validation.email").or(z.literal("")).optional().transform((v) => v || null),
  phone: opt(40), address: opt(200), district: opt(40), country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).default("SR"),
  website: opt(200), preferredCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "validation.currency").default("SRD"),
  paymentTermDays: z.coerce.number().int().min(0).max(365).default(14), accountManagerId: opt(40), notes: opt(4000),
  stage: z.enum(["LEAD", "CONTACTED", "QUALIFIED", "PROPOSAL", "CUSTOMER", "INACTIVE"]).default("LEAD"),
});

async function activity(tx: Tx, ctx: AdminContext, customerId: string, type: CrmActivityType, subject: string, extra: { body?: string | null; entity?: string; entityId?: string; dueDate?: Date | null } = {}) {
  return tx.crmActivity.create({ data: { organizationId: ctx.home.organizationId, customerId, type, subject: subject.slice(0, 200), body: extra.body ?? null, entity: extra.entity ?? null, entityId: extra.entityId ?? null, dueDate: extra.dueDate ?? null, userId: ctx.access.userId } });
}
export { activity as logActivity };
export { convertInTx as convertCustomerInTx };

/** Creates a lead/prospect/customer. A record created directly as CUSTOMER gets its debtor immediately. */
export async function createCustomer(ctx: AdminContext, raw: z.input<typeof customerSchema>) {
  const input = customerSchema.parse(raw);
  return inHome(ctx, "crm.create", async (tx) => {
    const number = await nextNumber(tx, ctx, "CUS");
    const { stage, ...rest } = input;
    let c = await tx.crmCustomer.create({ data: { ...rest, stage: stage === "CUSTOMER" ? "PROPOSAL" : stage, organizationId: ctx.home.organizationId, number, createdById: ctx.access.userId } });
    await activity(tx, ctx, c.id, "NOTE", `Aangemaakt als ${stage}`);
    await audit(tx, { organizationId: ctx.home.organizationId, userId: ctx.access.userId, action: "crm.customerCreated", entity: "CrmCustomer", entityId: c.id, details: { number, name: c.name, stage } });
    if (stage === "CUSTOMER") c = await convertInTx(tx, ctx, c.id);
    return c;
  });
}

export async function updateCustomer(ctx: AdminContext, id: string, raw: z.input<typeof customerSchema>) {
  const input = customerSchema.parse(raw);
  return inHome(ctx, "crm.edit", async (tx) => {
    const before = await tx.crmCustomer.findUnique({ where: { id } });
    if (!before) throw new UserError("errors.notFound");
    const { stage: _stage, ...rest } = input;
    const c = await tx.crmCustomer.update({ where: { id }, data: rest });
    if (c.partyId) {
      // Keep the debtor's master data in line (name, contact, tax ids, terms).
      await tx.party.update({ where: { id: c.partyId }, data: { name: c.name, email: c.email, phone: c.phone, address: c.address, taxNumber: c.taxNumber, kkfNumber: c.kkfNumber, paymentTermDays: c.paymentTermDays } });
    }
    const changed = Object.keys(rest).filter((k) => JSON.stringify((before as Record<string, unknown>)[k] ?? null) !== JSON.stringify((rest as Record<string, unknown>)[k] ?? null));
    await audit(tx, { organizationId: ctx.home.organizationId, userId: ctx.access.userId, action: "crm.customerUpdated", entity: "CrmCustomer", entityId: id, details: { fields: changed } });
    return c;
  });
}

/** Prospect → customer on the SAME record: creates the debtor in ARA's administration and links it. */
async function convertInTx(tx: Tx, ctx: AdminContext, id: string) {
  const c = await tx.crmCustomer.findUniqueOrThrow({ where: { id } });
  if (c.partyId) return tx.crmCustomer.update({ where: { id }, data: { stage: "CUSTOMER" } });
  const party = partySchema.parse({
    administrationId: ctx.home.administrationId, code: c.number.replace(/[^A-Za-z0-9_-]/g, ""), name: c.name, isCustomer: true, isSupplier: false,
    kkfNumber: c.kkfNumber ?? "", taxNumber: c.taxNumber ?? "", email: c.email ?? "", phone: c.phone ?? "", address: c.address ?? "", currency: c.preferredCurrency, paymentTermDays: c.paymentTermDays,
  });
  const p = await tx.party.create({ data: { ...party, organizationId: ctx.home.organizationId, code: party.code.toUpperCase() } });
  await audit(tx, { organizationId: ctx.home.organizationId, userId: ctx.access.userId, action: "party.created", entity: "Party", entityId: p.id, details: { code: p.code, name: p.name, from: "crm" } });
  return tx.crmCustomer.update({ where: { id }, data: { stage: "CUSTOMER", partyId: p.id, convertedAt: c.convertedAt ?? new Date() } });
}

export async function setStage(ctx: AdminContext, id: string, stage: CrmStage, note?: string) {
  return inHome(ctx, "crm.edit", async (tx) => {
    const c = await tx.crmCustomer.findUnique({ where: { id } });
    if (!c) throw new UserError("errors.notFound");
    if (c.stage === stage) return c;
    const updated = stage === "CUSTOMER" ? await convertInTx(tx, ctx, id) : await tx.crmCustomer.update({ where: { id }, data: { stage } });
    await activity(tx, ctx, id, "STAGE_CHANGE", `${c.stage} → ${stage}`, { body: note || null });
    await audit(tx, { organizationId: ctx.home.organizationId, userId: ctx.access.userId, action: "crm.stageChanged", entity: "CrmCustomer", entityId: id, details: { from: c.stage, to: stage } });
    return updated;
  });
}

export const contactSchema = z.object({
  customerId: z.string().min(1), name: z.string().trim().min(2, "validation.required").max(120), jobTitle: opt(80),
  email: z.string().trim().toLowerCase().email("validation.email").or(z.literal("")).optional().transform((v) => v || null),
  phone: opt(40), isPrimary: z.boolean().default(false), notes: opt(1000),
});

export async function addContact(ctx: AdminContext, raw: z.input<typeof contactSchema>) {
  const input = contactSchema.parse(raw);
  return inHome(ctx, "crm.edit", async (tx) => {
    if (!(await tx.crmCustomer.findUnique({ where: { id: input.customerId } }))) throw new UserError("errors.notFound");
    if (input.isPrimary) await tx.crmContact.updateMany({ where: { customerId: input.customerId }, data: { isPrimary: false } });
    const c = await tx.crmContact.create({ data: { ...input, organizationId: ctx.home.organizationId } });
    await audit(tx, { organizationId: ctx.home.organizationId, userId: ctx.access.userId, action: "crm.contactAdded", entity: "CrmContact", entityId: c.id, details: { customerId: input.customerId } });
    return c;
  });
}

export const activitySchema = z.object({
  customerId: z.string().min(1),
  type: z.enum(["NOTE", "CALL", "EMAIL", "MEETING", "TASK"]),
  subject: z.string().trim().min(2, "validation.required").max(200),
  body: opt(4000),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
});

export async function addActivity(ctx: AdminContext, raw: z.input<typeof activitySchema>) {
  const input = activitySchema.parse(raw);
  return inHome(ctx, "crm.create", async (tx) => {
    if (!(await tx.crmCustomer.findUnique({ where: { id: input.customerId } }))) throw new UserError("errors.notFound");
    return activity(tx, ctx, input.customerId, input.type, input.subject, { body: input.body, dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00Z`) : null });
  });
}

export async function completeTask(ctx: AdminContext, activityId: string) {
  return inHome(ctx, "crm.edit", async (tx) => {
    const a = await tx.crmActivity.findUnique({ where: { id: activityId } });
    if (!a || a.type !== "TASK") throw new UserError("errors.notFound");
    return tx.crmActivity.update({ where: { id: activityId }, data: { doneAt: a.doneAt ? a.doneAt : new Date() } });
  });
}

export async function linkOrganization(ctx: AdminContext, customerId: string, organizationId: string | null) {
  return inHome(ctx, "crm.edit", async (tx) => {
    const c = await tx.crmCustomer.findUnique({ where: { id: customerId } });
    if (!c) throw new UserError("errors.notFound");
    if (organizationId) {
      // The customer's ARA Accounting organisation is platform data, read by trusted code (exists, not ARA itself).
      const { systemDb } = await import("@/core/db/client");
      const org = await systemDb.organization.findUnique({ where: { id: organizationId } });
      if (!org || org.id === ctx.home.organizationId) throw new UserError("errors.notFound");
      const taken = await tx.crmCustomer.findFirst({ where: { linkedOrganizationId: organizationId, id: { not: customerId } } });
      if (taken) throw new UserError("admin.organizationLinked");
    }
    await tx.crmCustomer.update({ where: { id: customerId }, data: { linkedOrganizationId: organizationId } });
    await audit(tx, { organizationId: ctx.home.organizationId, userId: ctx.access.userId, action: "crm.organizationLinked", entity: "CrmCustomer", entityId: customerId, details: { organizationId } });
  });
}

export interface CustomerFilter {
  q?: string;
  stage?: CrmStage;
  managerId?: string;
  category?: string;
}

export async function listCustomers(tx: Tx, f: CustomerFilter) {
  const where: Prisma.CrmCustomerWhereInput = {
    status: "ACTIVE",
    ...(f.stage ? { stage: f.stage } : {}),
    ...(f.managerId ? { accountManagerId: f.managerId } : {}),
    ...(f.category ? { category: f.category } : {}),
    ...(f.q ? { OR: [{ name: { contains: f.q, mode: "insensitive" } }, { number: { contains: f.q, mode: "insensitive" } }, { email: { contains: f.q, mode: "insensitive" } }, { kkfNumber: { contains: f.q } }, { taxNumber: { contains: f.q } }, { contacts: { some: { name: { contains: f.q, mode: "insensitive" } } } }] } : {}),
  };
  return tx.crmCustomer.findMany({ where, orderBy: [{ stage: "asc" }, { name: "asc" }], take: 500, include: { contacts: { where: { isPrimary: true }, take: 1 } } });
}

// ───────────── Documents (Supabase Storage when configured, otherwise the database) ─────────────

const DOC_CATEGORIES = ["CONTRACT", "QUOTATION", "INVOICE", "PURCHASE_INVOICE", "PAYMENT_EVIDENCE", "CUSTOMER", "INTERNAL"] as const;
export const documentSchema = z.object({
  category: z.enum(DOC_CATEGORIES),
  customerId: z.string().optional().transform((v) => v || null),
  entity: z.string().max(40).optional().transform((v) => v || null),
  entityId: z.string().max(40).optional().transform((v) => v || null),
});
export const MAX_ADMIN_DOCUMENT = 20 * 1024 * 1024;

export async function uploadAdminDocument(ctx: AdminContext, raw: z.input<typeof documentSchema>, file: { fileName: string; bytes: Uint8Array }) {
  const input = documentSchema.parse(raw);
  if (file.bytes.length === 0) throw new UserError("validation.required");
  if (file.bytes.length > MAX_ADMIN_DOCUMENT) throw new UserError("scan.tooLarge");
  const mimeType = sniffMime(file.bytes);
  if (!mimeType) throw new UserError("scan.unsupportedType");
  const permission = input.category === "PAYMENT_EVIDENCE" ? "payments.create" : "crm.edit";
  assertCan(ctx.access, permission, ctx.home.companyId);
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const id = newId();
  const key = `${ctx.home.organizationId}/${new Date().getUTCFullYear()}/${id}-${file.fileName.replace(/[^\w.-]+/g, "_").slice(-120)}`;
  const backend = activeBackend();
  // Supabase: the object is uploaded first (never overwritten); if the metadata insert then fails, an unreferenced
  // object remains in the private bucket and is never served. Database: file and metadata commit together.
  if (backend === "SUPABASE") await putFile(null, { documentId: id, organizationId: ctx.home.organizationId, key, bytes: file.bytes, contentType: mimeType });
  return inHome(ctx, permission, async (tx) => {
    if (input.customerId && !(await tx.crmCustomer.findUnique({ where: { id: input.customerId } }))) throw new UserError("errors.notFound");
    const doc = await tx.adminDocument.create({ data: { id, organizationId: ctx.home.organizationId, customerId: input.customerId, entity: input.entity, entityId: input.entityId, category: input.category, fileName: file.fileName.slice(0, 200), mimeType, sizeBytes: file.bytes.length, sha256, storage: backend, storageKey: key, uploadedById: ctx.access.userId } });
    if (backend === "DATABASE") await putFile(tx, { documentId: id, organizationId: ctx.home.organizationId, key, bytes: file.bytes, contentType: mimeType });
    if (input.customerId) await activity(tx, ctx, input.customerId, "DOCUMENT", doc.fileName, { entity: "AdminDocument", entityId: id });
    await audit(tx, { organizationId: ctx.home.organizationId, userId: ctx.access.userId, action: "admin.documentUploaded", entity: "AdminDocument", entityId: id, details: { category: input.category, sha256, backend, size: file.bytes.length } });
    return doc;
  });
}

/** Authorised download: the document must belong to ARA's tenant (RLS) and the user needs the view permission. */
export async function downloadAdminDocument(ctx: AdminContext, id: string) {
  return inHome(ctx, "crm.view", async (tx) => {
    const doc = await tx.adminDocument.findUnique({ where: { id } });
    if (!doc) throw new UserError("errors.notFound");
    const bytes = await getFile(tx, doc);
    await audit(tx, { organizationId: ctx.home.organizationId, userId: ctx.access.userId, action: "admin.documentDownloaded", entity: "AdminDocument", entityId: id });
    return { doc, bytes };
  });
}
