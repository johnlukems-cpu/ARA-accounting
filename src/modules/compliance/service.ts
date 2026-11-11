import { z } from "zod";
import type { ComplianceReview, ComplianceSubject } from "@prisma/client";
import { systemDb } from "@/core/db/client";
import { audit } from "@/core/audit/audit";
import { UserError } from "@/core/errors";
import { STANDARD_TAX_CODES } from "@/modules/invoicing/setup";
import { FRAMEWORKS } from "@/modules/annual-accounts/service";

/**
 * Suriname compliance register. Separates two kinds of configuration:
 *  - LEGAL items: parameters taken from Surinamese law (tax rates, filing days, BTW codes, annual-accounts frameworks,
 *    retention). They are only "verified" after a qualified external reviewer approved them; the review is recorded
 *    as evidence (ComplianceReview, append-only) and is the ONLY way a tax rule becomes VERIFIED.
 *  - SOFTWARE rules (double entry, period locks, approval workflows, FX policy defaults …) are product design, listed in
 *    docs/COMPLIANCE_REVIEW_CHECKLIST.md, and need no legal verification.
 * The software never claims legal compliance on its own.
 */
export type RegisterItem = {
  subject: ComplianceSubject;
  key: string;
  title: string;
  value: string;
  status: "VERIFIED" | "SOURCE_FOUND" | "PENDING_VERIFICATION";
  source: string | null;
  reviewer: string;
  lastReview: ComplianceReview | null;
};

/** Legal questions that are not a tax rate but must be confirmed before general availability. */
export const OTHER_LEGAL_ITEMS = [
  { key: "INVOICE_REQUIREMENTS", title: "Verplichte factuurgegevens volgens de Wet BTW 2022", value: "Factuur-PDF bevat: naam, adres, fiscaal nummer verkoper en afnemer, factuurnummer (doorlopend), datum, omschrijving, bedrag excl. BTW, BTW-tarief en -bedrag per tarief, totaal." },
  { key: "FX_RATE_FOR_TAX", title: "Koers voor BTW over facturen in vreemde valuta", value: "Configureerbaar koersbeleid per administratie (standaard: CBvS-verkoopkoers van de factuurdatum)." },
  { key: "DIGITAL_RECORDS", title: "Digitale bewaring en echtheid van facturen en bonnen", value: "Originelen worden onveranderlijk opgeslagen met SHA-256; papieren originelen worden niet vervangen." },
] as const;

const reviewerFor = (s: ComplianceSubject) => (s === "ANNUAL_ACCOUNTS_FRAMEWORK" ? "SUVA-registered accountant" : s === "RETENTION_PERIOD" ? "Tax adviser or lawyer" : "Surinamese tax adviser");

export async function complianceRegister(): Promise<RegisterItem[]> {
  const [rules, reviews] = await Promise.all([
    systemDb.taxRuleVersion.findMany({ orderBy: [{ taxType: "asc" }, { effectiveFrom: "asc" }] }),
    systemDb.complianceReview.findMany({ orderBy: { createdAt: "desc" } }),
  ]);
  const last = (subject: ComplianceSubject, key: string) => reviews.find((r) => r.subject === subject && r.subjectKey === key) ?? null;
  const approved = (subject: ComplianceSubject, key: string) => last(subject, key)?.decision === "APPROVED";
  const items: RegisterItem[] = [];
  for (const r of rules) {
    const key = `${r.taxType}@${r.effectiveFrom.toISOString().slice(0, 10)}`;
    items.push({ subject: "TAX_RULE", key, title: `${r.taxType} vanaf ${key.split("@")[1]}`, value: JSON.stringify(r.parameters), status: r.legalStatus, source: r.legalSource, reviewer: reviewerFor("TAX_RULE"), lastReview: last("TAX_RULE", key) });
  }
  for (const c of STANDARD_TAX_CODES) {
    items.push({ subject: "BTW_CODE_TEMPLATE", key: c.code, title: c.name, value: `${c.rate}% · ${c.kind} · ${c.direction}`, status: approved("BTW_CODE_TEMPLATE", c.code) ? "VERIFIED" : c.legalStatus, source: c.legalSource, reviewer: reviewerFor("BTW_CODE_TEMPLATE"), lastReview: last("BTW_CODE_TEMPLATE", c.code) });
  }
  for (const f of FRAMEWORKS) {
    items.push({ subject: "ANNUAL_ACCOUNTS_FRAMEWORK", key: f, title: f, value: "Indeling, grondslagen en concepttoelichtingen", status: approved("ANNUAL_ACCOUNTS_FRAMEWORK", f) ? "VERIFIED" : "PENDING_VERIFICATION", source: f.startsWith("NV") ? "Wet op de Jaarrekening, S.B. 2017 no. 84" : null, reviewer: reviewerFor("ANNUAL_ACCOUNTS_FRAMEWORK"), lastReview: last("ANNUAL_ACCOUNTS_FRAMEWORK", f) });
  }
  items.push({ subject: "RETENTION_PERIOD", key: "BOOKS_AND_RECORDS", title: "Bewaartermijn administratie", value: "10 jaar (instelling, nog te bevestigen)", status: approved("RETENTION_PERIOD", "BOOKS_AND_RECORDS") ? "VERIFIED" : "PENDING_VERIFICATION", source: null, reviewer: reviewerFor("RETENTION_PERIOD"), lastReview: last("RETENTION_PERIOD", "BOOKS_AND_RECORDS") });
  for (const o of OTHER_LEGAL_ITEMS) {
    items.push({ subject: "OTHER", key: o.key, title: o.title, value: o.value, status: approved("OTHER", o.key) ? "VERIFIED" : "PENDING_VERIFICATION", source: null, reviewer: reviewerFor("OTHER"), lastReview: last("OTHER", o.key) });
  }
  return items;
}

export const reviewSchema = z.object({
  subject: z.enum(["TAX_RULE", "BTW_CODE_TEMPLATE", "ANNUAL_ACCOUNTS_FRAMEWORK", "RETENTION_PERIOD", "OTHER"]),
  subjectKey: z.string().trim().min(1).max(100),
  decision: z.enum(["APPROVED", "CHANGES_REQUIRED", "REJECTED"]),
  reviewerName: z.string().trim().min(3, "validation.required").max(120),
  reviewerQualification: z.string().trim().min(3, "validation.required").max(200),
  reference: z.string().trim().min(3, "validation.required").max(200),
  reviewedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date"),
  notes: z.string().trim().max(2000).optional(),
});

/**
 * Records an external professional review (platform admins only). APPROVED on a tax rule marks it VERIFIED with the
 * reviewer, date and reference; any other decision on a verified rule sets it back to PENDING_VERIFICATION.
 * APPROVED on a BTW code template also marks the matching BTW codes of every administration (same code AND same rate)
 * as VERIFIED — codes an organisation changed keep their own status.
 */
export async function recordReview(userId: string, raw: z.input<typeof reviewSchema>) {
  const user = await systemDb.user.findUnique({ where: { id: userId } });
  if (!user?.isPlatformAdmin || !user.isActive) throw new UserError("errors.forbidden");
  const input = reviewSchema.parse(raw);
  const reviewedOn = new Date(`${input.reviewedOn}T00:00:00Z`);
  if (reviewedOn > new Date()) throw new UserError("validation.date");
  if (input.decision !== "APPROVED" && !input.notes?.trim()) throw new UserError("errors.reasonRequired");
  const known = (await complianceRegister()).some((i) => i.subject === input.subject && i.key === input.subjectKey);
  if (!known) throw new UserError("errors.notFound");

  return systemDb.$transaction(async (tx) => {
    const review = await tx.complianceReview.create({ data: { ...input, notes: input.notes || null, reviewedOn, recordedById: userId } });
    let affected = 0;
    if (input.subject === "TAX_RULE") {
      const [taxType, from] = input.subjectKey.split("@");
      const rule = await tx.taxRuleVersion.findFirstOrThrow({ where: { taxType: taxType as never, effectiveFrom: new Date(`${from}T00:00:00Z`) } });
      await tx.taxRuleVersion.update({
        where: { id: rule.id },
        data: input.decision === "APPROVED"
          ? { legalStatus: "VERIFIED", verifiedBy: `${input.reviewerName} (${input.reviewerQualification})`, verifiedAt: reviewedOn, verificationReference: input.reference }
          : { legalStatus: "PENDING_VERIFICATION", verifiedBy: null, verifiedAt: null, verificationReference: null },
      });
      affected = 1;
    }
    if (input.subject === "BTW_CODE_TEMPLATE" && input.decision === "APPROVED") {
      const template = STANDARD_TAX_CODES.find((c) => c.code === input.subjectKey)!;
      affected = (await tx.taxCode.updateMany({ where: { code: template.code, rate: template.rate }, data: { legalStatus: "VERIFIED", legalSource: input.reference } })).count;
    }
    await audit(tx, { organizationId: null, userId, action: "platform.complianceReviewed", entity: "ComplianceReview", entityId: review.id, details: { subject: input.subject, key: input.subjectKey, decision: input.decision, reviewer: input.reviewerName, reference: input.reference, affected } });
    return { review, affected };
  });
}
