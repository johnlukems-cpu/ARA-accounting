import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import type { Tx } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { audit } from "@/core/audit/audit";
import { assertCan, type Access } from "@/core/auth/access";
import { UserError } from "@/core/errors";
import { postInvoice, purchaseApprovalRequired, saveInvoice, submitInvoice } from "@/modules/invoicing/service";
import { FIELD_KEYS, emptyFields, matchSupplier, sniffMime, type DuplicateReason, type Fields } from "./domain";
import { assertLimit } from "@/modules/saas/service";
import { assertNotThrottled, hit } from "@/core/ops/throttle";
import { anthropicExtractor, readPdfText, textLayerExtractor, type Extractor } from "./extractors";

const scope = (a: Access) => ({ organizationId: a.organizationId, userId: a.userId });
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const json = (v: unknown) => v as Prisma.InputJsonValue;

// ───────────── Organisation AI setting ─────────────

export type AiSettings = { enabled: boolean; consentAt?: string; consentById?: string };
export const aiSettingsOf = (settings: unknown): AiSettings => ({ enabled: false, ...((settings as { ai?: AiSettings } | null)?.ai ?? {}) });
export const aiConfigured = () => !!process.env.ANTHROPIC_API_KEY;

export async function setAiEnabled(access: Access, enabled: boolean) {
  return withTenant(scope(access), async (tx) => {
    assertCan(access, "organization.manageSettings");
    const org = await tx.organization.findUniqueOrThrow({ where: { id: access.organizationId } });
    const ai: AiSettings = enabled ? { enabled: true, consentAt: new Date().toISOString(), consentById: access.userId } : { enabled: false };
    await tx.organization.update({ where: { id: org.id }, data: { settings: json({ ...((org.settings as object) ?? {}), ai }) } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: enabled ? "ai.enabled" : "ai.disabled", entity: "Organization", entityId: org.id });
  });
}

// ───────────── Upload and extraction ─────────────

/** Merge: per field the suggestion with the highest confidence. */
function merge(results: Fields[]): Fields {
  const out = emptyFields();
  for (const r of results) for (const k of FIELD_KEYS) if (r[k].value && r[k].confidence > out[k].confidence) out[k] = r[k];
  return out;
}

export async function latestFields(tx: Tx, documentId: string): Promise<Fields> {
  const rows = await tx.documentExtraction.findMany({ where: { documentId, error: null }, orderBy: { createdAt: "asc" } });
  return merge(rows.map((r) => ({ ...emptyFields(), ...(r.fields as Fields) })));
}

/**
 * Stores the file (evidence, append-only), reads the PDF text layer and runs the extractors: the text heuristics always,
 * the AI provider only when configured and switched on by the organisation. `extractors` replaces the defaults in tests.
 */
export async function uploadDocument(access: Access, input: { administrationId: string; fileName: string; bytes: Uint8Array; source?: "WEB" | "MOBILE" }, extractors?: Extractor[]) {
  await assertNotThrottled("upload", access.userId, access.organizationId);
  if (input.bytes.length === 0) throw new UserError("banking.noFile");
  if (input.bytes.length > MAX_UPLOAD_BYTES) throw new UserError("scan.tooLarge");
  const mimeType = sniffMime(input.bytes);
  if (!mimeType) throw new UserError("scan.unsupportedType");
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const pdf = mimeType === "application/pdf" ? await readPdfText(input.bytes) : null;

  const doc = await withTenant(scope(access), async (tx) => {
    const admin = await tx.administration.findUnique({ where: { id: input.administrationId } });
    if (!admin) throw new UserError("errors.notFound");
    assertCan(access, "scan.create", admin.companyId);
    await assertLimit(tx, access.organizationId, "documentsPerMonth");
    await assertLimit(tx, access.organizationId, "storageMb", input.bytes.length / 1_048_576);
    const same = await tx.document.findFirst({ where: { administrationId: admin.id, kind: "PURCHASE", sha256, status: { not: "REJECTED" } }, orderBy: { createdAt: "asc" } });
    const d = await tx.document.create({
      data: {
        organizationId: access.organizationId, administrationId: admin.id, fileName: input.fileName.slice(0, 200), mimeType, sizeBytes: input.bytes.length, sha256,
        pageCount: pdf?.pages ?? (mimeType === "application/pdf" ? null : 1), source: input.source ?? "WEB", textContent: pdf?.text.slice(0, 200_000) || null,
        uploadedById: access.userId, status: "REVIEW_REQUIRED", ...(same ? { duplicateOfId: same.id, duplicateReason: "SAME_FILE" satisfies DuplicateReason } : {}),
      },
    });
    await tx.documentFile.create({ data: { documentId: d.id, organizationId: access.organizationId, data: Buffer.from(input.bytes) } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "document.uploaded", entity: "Document", entityId: d.id, details: { fileName: d.fileName, sha256, size: d.sizeBytes, duplicateOf: same?.id ?? null } });
    return { d, aiOn: aiSettingsOf((await tx.organization.findUniqueOrThrow({ where: { id: access.organizationId } })).settings).enabled };
  });

  // AI calls cost money per document: above the per-minute AI limit the text layer is used alone (no failure).
  const aiAllowed = doc.aiOn && !extractors && !(await hit("ai", access.userId, access.organizationId));
  const list = extractors ?? [textLayerExtractor, ...(aiAllowed ? [anthropicExtractor()].filter((x): x is Extractor => !!x) : [])];
  const runs: { provider: string; model?: string; fields: Fields | null; ms: number; error?: string }[] = [];
  for (const ex of list) {
    const start = Date.now();
    try {
      runs.push({ provider: ex.provider, model: ex.model, fields: await ex.extract({ bytes: input.bytes, mimeType, text: pdf?.text ?? null }), ms: Date.now() - start });
    } catch (err) {
      runs.push({ provider: ex.provider, model: ex.model, fields: null, ms: Date.now() - start, error: (err as Error).message.slice(0, 500) });
    }
  }
  await withTenant(scope(access), async (tx) => {
    for (const r of runs) {
      await tx.documentExtraction.create({ data: { organizationId: access.organizationId, documentId: doc.d.id, provider: r.provider, model: r.model ?? null, fields: json(r.fields ?? emptyFields()), durationMs: r.ms, error: r.error ?? null } });
    }
  });
  const automation = await runAutomation(access, doc.d.id);
  return { document: doc.d, automation };
}

// ───────────── Suggestions (supplier, account, BTW code) and duplicates ─────────────

export async function suggestionsFor(tx: Tx, documentId: string) {
  const doc = await tx.document.findUniqueOrThrow({ where: { id: documentId } });
  const fields = await latestFields(tx, documentId);
  const suppliers = await tx.party.findMany({ where: { administrationId: doc.administrationId, isSupplier: true, status: "ACTIVE" } });
  const supplier = matchSupplier(fields, suppliers);
  let account: { accountId: string; confidence: number; source: string } | null = null;
  let taxCode: { taxCodeId: string; source: string } | null = null;
  let rule = null;
  if (supplier) {
    const text = `${fields.description.value ?? ""} ${doc.textContent ?? ""}`.toLowerCase();
    const rules = await tx.automationRule.findMany({ where: { administrationId: doc.administrationId, partyId: supplier.party.id, enabled: true }, orderBy: { createdAt: "asc" } });
    rule = rules.find((r) => r.descriptionContains && text.includes(r.descriptionContains.toLowerCase())) ?? rules.find((r) => !r.descriptionContains) ?? null;
    if (rule) {
      account = { accountId: rule.accountId, confidence: 0.95, source: "rule" };
      if (rule.taxCodeId) taxCode = { taxCodeId: rule.taxCodeId, source: "rule" };
    } else if (supplier.party.defaultExpenseAccountId) {
      account = { accountId: supplier.party.defaultExpenseAccountId, confidence: 0.85, source: "supplier" };
    } else {
      // History: the account used most on this supplier's earlier purchase invoices.
      const hist = await tx.$queryRaw<{ accountId: string; n: bigint; total: bigint }[]>`
        SELECT l."accountId", COUNT(*) AS n, SUM(COUNT(*)) OVER () AS total FROM "InvoiceLine" l JOIN "Invoice" i ON i.id = l."invoiceId"
         WHERE i."partyId" = ${supplier.party.id} AND i.type = 'PURCHASE' AND i.status <> 'DRAFT' GROUP BY l."accountId" ORDER BY n DESC LIMIT 1`;
      if (hist[0]) account = { accountId: hist[0].accountId, confidence: Number((0.5 + 0.3 * (Number(hist[0].n) / Number(hist[0].total))).toFixed(2)), source: "history" };
    }
    if (!taxCode && supplier.party.defaultTaxCodeId) taxCode = { taxCodeId: supplier.party.defaultTaxCodeId, source: "supplier" };
  }
  return { doc, fields, supplier, account, taxCode, rule, duplicate: await duplicateCheck(tx, doc, fields, supplier?.party.id ?? null) };
}

/** AI3: same file, same supplier + invoice number, or same supplier + date + total. */
export async function duplicateCheck(tx: Tx, doc: { id: string; administrationId: string; duplicateOfId: string | null; duplicateReason: string | null }, fields: Pick<Fields, "invoiceNumber" | "invoiceDate" | "grossAmount">, partyId: string | null) {
  if (doc.duplicateOfId) return { reason: doc.duplicateReason as DuplicateReason, documentId: doc.duplicateOfId, invoiceId: null as string | null };
  if (!partyId) return null;
  if (fields.invoiceNumber.value) {
    const inv = await tx.invoice.findFirst({ where: { administrationId: doc.administrationId, type: "PURCHASE", partyId, externalNumber: { equals: fields.invoiceNumber.value, mode: "insensitive" } } });
    if (inv) return { reason: "SAME_INVOICE_NUMBER" as DuplicateReason, documentId: null, invoiceId: inv.id };
  }
  if (fields.invoiceDate.value && fields.grossAmount.value) {
    const inv = await tx.invoice.findFirst({ where: { administrationId: doc.administrationId, type: "PURCHASE", partyId, invoiceDate: new Date(`${fields.invoiceDate.value}T00:00:00Z`), grossAmount: fields.grossAmount.value } });
    if (inv) return { reason: "SAME_DATE_AMOUNT" as DuplicateReason, documentId: null, invoiceId: inv.id };
  }
  return null;
}

// ───────────── Automation (AI2) ─────────────

const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** Net amount for one invoice line so that the invoice total equals the document total (or null when it cannot). */
function netForGross(gross: string, net: string | null, rate: string): string | null {
  const r = new Decimal(rate).dividedBy(100);
  const candidate = net ? new Decimal(net) : new Decimal(gross).dividedBy(r.plus(1)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const total = candidate.plus(candidate.times(r).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
  return total.minus(gross).abs().lte("0.01") ? candidate.toFixed(2) : null;
}

/**
 * Decides how far a document may go automatically and logs the decision (monitor). Without a rule in DRAFT/AUTO_POST mode,
 * or when any AI2 condition fails, the document stays REVIEW_REQUIRED with the reasons.
 */
export async function runAutomation(access: Access, documentId: string) {
  const start = Date.now();
  const plan = await withTenant(scope(access), async (tx) => {
    const s = await suggestionsFor(tx, documentId);
    const reasons: string[] = [];
    const rule = s.rule;
    if (!s.supplier) reasons.push("unknownSupplier");
    if (!rule) reasons.push("noRule");
    if (s.duplicate) reasons.push(`duplicate:${s.duplicate.reason}`);
    let net: string | null = null;
    let taxRate = "0";
    if (rule && rule.mode !== "SUGGEST") {
      const min = Number(rule.minConfidence);
      if (s.supplier && s.supplier.confidence < min) reasons.push("supplierConfidence");
      for (const k of ["invoiceNumber", "invoiceDate", "grossAmount"] as const) if (!s.fields[k].value || s.fields[k].confidence < min) reasons.push(`confidence:${k}`);
      if (rule.mode === "AUTO_POST" && s.fields.grossAmount.value && rule.maxAmount && new Decimal(s.fields.grossAmount.value).gt(rule.maxAmount.toString())) reasons.push("aboveMaxAmount");
      if (s.fields.currency.value && s.supplier && s.fields.currency.value !== s.supplier.party.currency) reasons.push("currencyMismatch");
      if (rule.taxCodeId) taxRate = (await tx.taxCode.findUniqueOrThrow({ where: { id: rule.taxCodeId } })).rate.toString();
      if (s.fields.grossAmount.value) {
        net = netForGross(s.fields.grossAmount.value, s.fields.netAmount.value, taxRate);
        if (!net) reasons.push("amountMismatch");
      }
    }
    const admin = await tx.administration.findUniqueOrThrow({ where: { id: s.doc.administrationId } });
    return { ...s, reasons, net, admin };
  });

  const { rule, reasons, fields, supplier, doc } = plan;
  let outcome: "SUGGESTED" | "DRAFTED" | "POSTED" | "REVIEW" | "FAILED" = !rule ? "REVIEW" : rule.mode === "SUGGEST" ? (reasons.length ? "REVIEW" : "SUGGESTED") : reasons.length ? "REVIEW" : "DRAFTED";
  let invoiceId: string | null = null;
  if (outcome === "DRAFTED" && rule && supplier && plan.net) {
    try {
      const inv = await saveInvoice(access, {
        administrationId: doc.administrationId, type: "PURCHASE", kind: "INVOICE", partyId: supplier.party.id, externalNumber: fields.invoiceNumber.value!,
        invoiceDate: fields.invoiceDate.value!, dueDate: fields.dueDate.value && fields.dueDate.value >= fields.invoiceDate.value! ? fields.dueDate.value : addDays(fields.invoiceDate.value!, supplier.party.paymentTermDays),
        currency: supplier.party.currency, description: fields.description.value ?? undefined,
        lines: [{ description: (fields.description.value ?? doc.fileName).slice(0, 300), quantity: "1", unitPrice: plan.net, accountId: rule.accountId, taxCodeId: rule.taxCodeId ?? undefined }],
      });
      invoiceId = inv!.id;
      if (rule.mode === "AUTO_POST" && !purchaseApprovalRequired(plan.admin.settings)) {
        await postInvoice(access, inv!.id);
        outcome = "POSTED";
      } else {
        await submitInvoice(access, inv!.id);
        if (rule.mode === "AUTO_POST") reasons.push("approvalRequired");
      }
    } catch (err) {
      outcome = "FAILED";
      reasons.push(`error:${(err as { key?: string }).key ?? (err as Error).message}`.slice(0, 200));
    }
  }
  await withTenant(scope(access), async (tx) => {
    await tx.automationExecution.create({ data: { organizationId: access.organizationId, administrationId: doc.administrationId, ruleId: rule?.id ?? null, documentId, outcome, reasons: json(reasons), durationMs: Date.now() - start } });
    if (invoiceId) await tx.document.update({ where: { id: documentId }, data: { status: "PROCESSED", invoiceId, confirmed: json({ by: "automation", ruleId: rule!.id, fields }) } });
  });
  return { outcome, reasons, invoiceId };
}

// ───────────── Manual review ─────────────

export const confirmSchema = z.object({
  documentId: z.string().min(1),
  partyId: z.string().min(1, "validation.required"),
  invoiceNumber: z.string().trim().min(1, "validation.required").max(60),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date"),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date"),
  currency: z.string().regex(/^[A-Z]{3}$/, "validation.currency"),
  exchangeRate: z.string().optional().transform((v) => v || undefined),
  accountId: z.string().min(1, "validation.required"),
  taxCodeId: z.string().optional().transform((v) => v || undefined),
  netAmount: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "validation.amount"),
  description: z.string().trim().max(300).optional(),
  acceptDuplicate: z.boolean().default(false),
});

/** The user confirms (and corrects) the suggestions: a purchase invoice draft is created and linked; the confirmed values are kept (AI1). */
export async function confirmDocument(access: Access, input: z.infer<typeof confirmSchema>) {
  const check = await withTenant(scope(access), async (tx) => {
    const doc = await tx.document.findUnique({ where: { id: input.documentId } });
    if (!doc) throw new UserError("errors.notFound");
    const admin = await tx.administration.findUniqueOrThrow({ where: { id: doc.administrationId } });
    assertCan(access, "scan.edit", admin.companyId);
    if (doc.status === "PROCESSED" || doc.status === "REJECTED") throw new UserError("scan.alreadyHandled");
    const dup = await duplicateCheck(tx, doc, { invoiceNumber: { value: input.invoiceNumber, confidence: 1 }, invoiceDate: { value: input.invoiceDate, confidence: 1 }, grossAmount: { value: null, confidence: 0 } }, input.partyId);
    return { doc, dup };
  });
  if (check.dup && !input.acceptDuplicate) throw new UserError("scan.duplicateSuspected", { reason: check.dup.reason });
  const inv = await saveInvoice(access, {
    administrationId: check.doc.administrationId, type: "PURCHASE", kind: "INVOICE", partyId: input.partyId, externalNumber: input.invoiceNumber, invoiceDate: input.invoiceDate, dueDate: input.dueDate,
    currency: input.currency, exchangeRate: input.exchangeRate, description: input.description,
    lines: [{ description: (input.description || check.doc.fileName).slice(0, 300), quantity: "1", unitPrice: input.netAmount, accountId: input.accountId, taxCodeId: input.taxCodeId }],
  });
  await withTenant(scope(access), async (tx) => {
    const { acceptDuplicate, documentId: _d, ...values } = input;
    await tx.document.update({ where: { id: input.documentId }, data: { status: "PROCESSED", invoiceId: inv!.id, confirmed: json({ by: access.userId, at: new Date().toISOString(), values, acceptedDuplicate: acceptDuplicate && !!check.dup }) } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "document.confirmed", entity: "Document", entityId: input.documentId, details: { invoiceId: inv!.id, duplicateAccepted: acceptDuplicate && !!check.dup } });
  });
  return inv!;
}

export async function rejectDocument(access: Access, documentId: string, reason: string) {
  return withTenant(scope(access), async (tx) => {
    const doc = await tx.document.findUnique({ where: { id: documentId } });
    if (!doc) throw new UserError("errors.notFound");
    const admin = await tx.administration.findUniqueOrThrow({ where: { id: doc.administrationId } });
    assertCan(access, "scan.edit", admin.companyId);
    if (doc.status === "PROCESSED") throw new UserError("scan.alreadyHandled");
    await tx.document.update({ where: { id: documentId }, data: { status: "REJECTED", rejectReason: reason } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "document.rejected", entity: "Document", entityId: documentId, details: { reason } });
  });
}

// ───────────── Rules ─────────────

export const ruleSchema = z.object({
  administrationId: z.string().min(1),
  name: z.string().trim().min(2, "validation.required").max(80),
  partyId: z.string().min(1, "validation.required"),
  descriptionContains: z.string().trim().max(80).optional().transform((v) => v || undefined),
  accountId: z.string().min(1, "validation.required"),
  taxCodeId: z.string().optional().transform((v) => v || undefined),
  mode: z.enum(["SUGGEST", "DRAFT", "AUTO_POST"]),
  minConfidence: z.coerce.number().min(0.5, "validation.invalid").max(1, "validation.invalid").default(0.9),
  maxAmount: z.string().trim().transform((v) => v.replace(",", ".")).pipe(z.string().regex(/^(\d+(\.\d{1,2})?)?$/, "validation.amount")).optional().transform((v) => v || undefined),
});

export async function saveRule(access: Access, raw: z.input<typeof ruleSchema>) {
  const input = ruleSchema.parse(raw);
  return withTenant(scope(access), async (tx) => {
    const admin = await tx.administration.findUnique({ where: { id: input.administrationId } });
    if (!admin) throw new UserError("errors.notFound");
    assertCan(access, "automation.edit", admin.companyId);
    if (input.mode === "AUTO_POST" && !input.maxAmount) throw new UserError("scan.maxAmountRequired");
    const party = await tx.party.findUnique({ where: { id: input.partyId } });
    const account = await tx.account.findUnique({ where: { id: input.accountId } });
    if (!party || party.administrationId !== admin.id || !party.isSupplier) throw new UserError("invoicing.invalidParty");
    if (!account || account.administrationId !== admin.id || account.type !== "DETAIL") throw new UserError("ledger.accountNotPostable", { line: "", account: "" });
    const rule = await tx.automationRule.create({ data: { organizationId: access.organizationId, ...input, minConfidence: input.minConfidence.toFixed(3), maxAmount: input.maxAmount ?? null, createdById: access.userId } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "automation.ruleCreated", entity: "AutomationRule", entityId: rule.id, details: { name: rule.name, mode: rule.mode } });
    return rule;
  });
}

export async function setRuleEnabled(access: Access, ruleId: string, enabled: boolean) {
  return withTenant(scope(access), async (tx) => {
    const rule = await tx.automationRule.findUnique({ where: { id: ruleId } });
    if (!rule) throw new UserError("errors.notFound");
    const admin = await tx.administration.findUniqueOrThrow({ where: { id: rule.administrationId } });
    assertCan(access, "automation.edit", admin.companyId);
    await tx.automationRule.update({ where: { id: ruleId }, data: { enabled } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: enabled ? "automation.ruleEnabled" : "automation.ruleDisabled", entity: "AutomationRule", entityId: ruleId });
  });
}

/** Monitor: outcomes per period, for the automation dashboard. */
export async function automationStats(tx: Tx, administrationId: string, since: Date) {
  const rows = await tx.automationExecution.groupBy({ by: ["outcome"], where: { administrationId, createdAt: { gte: since } }, _count: { _all: true }, _avg: { durationMs: true } });
  return rows.map((r) => ({ outcome: r.outcome, count: r._count._all, avgMs: Math.round(r._avg.durationMs ?? 0) }));
}
