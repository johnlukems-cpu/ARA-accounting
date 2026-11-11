import type { Prisma } from "@prisma/client";
import { z } from "zod";
import type { Tx } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { audit } from "@/core/audit/audit";
import { assertCan, type Access } from "@/core/auth/access";
import { UserError } from "@/core/errors";
import { defaultNormalBalance } from "@/modules/ledger/standard-chart";
import { contentHash, diffContent, templateContentSchema, validateContent, type TemplateContent } from "./content";

export type TemplateContentT = TemplateContent;

const scope = (a: Access) => ({ organizationId: a.organizationId, userId: a.userId });
const asJson = (c: TemplateContent) => c as unknown as Prisma.InputJsonValue;
export const parseContent = (raw: unknown): TemplateContent => templateContentSchema.parse(raw);

/** Latest published version of a template visible to the tenant. */
export async function latestPublished(tx: Tx, templateId: string) {
  return tx.industryTemplateVersion.findFirst({ where: { templateId, status: "PUBLISHED" }, orderBy: { version: "desc" }, include: { template: true } });
}

export async function defaultTemplateVersion(tx: Tx) {
  const t = await tx.industryTemplate.findFirst({ where: { ownerOrganizationId: null, code: "GENERAL" } });
  return t ? latestPublished(tx, t.id) : null;
}

// ───────────── Applying a template ─────────────

type AppliedSelection = { accounts?: Set<string>; journals?: Set<string>; assetCategories?: Set<string>; dimensions?: Set<string> };

/**
 * Copies template additions into an administration. Only adds rows; existing rows (same number/code) are never touched.
 * Returns what was added and what was skipped because the administration already uses that number or code.
 */
async function install(tx: Tx, organizationId: string, administrationId: string, templateCode: string, content: TemplateContent, only?: AppliedSelection) {
  const added: string[] = [];
  const skipped: string[] = [];
  const existing = await tx.account.findMany({ where: { administrationId }, select: { id: true, number: true, type: true } });
  const byNumber = new Map(existing.map((a) => [a.number, a]));
  // Headers first so children can find their parent.
  const accounts = [...content.accounts].sort((a, b) => Number(!!b.header) - Number(!!a.header) || a.number.localeCompare(b.number));
  for (const a of accounts) {
    if (only?.accounts && !only.accounts.has(a.ref)) continue;
    if (byNumber.has(a.number)) {
      skipped.push(a.number);
      continue;
    }
    const parent = byNumber.get(a.parent);
    if (!parent || parent.type !== "HEADER") {
      skipped.push(a.number);
      continue;
    }
    const row = await tx.account.create({
      data: {
        organizationId, administrationId, number: a.number, name: a.name, nameEn: a.nameEn, category: a.category, type: a.header ? "HEADER" : "DETAIL",
        parentId: parent.id, normalBalance: a.normal ?? defaultNormalBalance(a.category), controlType: a.control ?? "NONE", templateAccountRef: `${templateCode}:${a.ref}`,
      },
    });
    byNumber.set(a.number, { id: row.id, number: row.number, type: row.type });
    added.push(a.number);
  }
  for (const j of content.journals) {
    if (only?.journals && !only.journals.has(j.code)) continue;
    if (await tx.journal.findFirst({ where: { administrationId, code: j.code } })) {
      skipped.push(j.code);
      continue;
    }
    await tx.journal.create({ data: { organizationId, administrationId, code: j.code, name: j.name, type: j.type, requiresApproval: j.requiresApproval ?? false } });
    added.push(j.code);
  }
  const num = (n: string) => byNumber.get(n)?.id;
  for (const c of content.assetCategories) {
    if (only?.assetCategories && !only.assetCategories.has(c.code)) continue;
    const [assetAccountId, accumulatedAccountId, expense, gain, loss] = [num(c.asset), num(c.accumulated), num("4800"), num("8095"), num("4810")];
    if (!assetAccountId || !accumulatedAccountId || !expense || !gain || !loss || (await tx.assetCategory.findFirst({ where: { administrationId, code: c.code } }))) {
      skipped.push(c.code);
      continue;
    }
    await tx.assetCategory.create({ data: { organizationId, administrationId, code: c.code, name: c.name, assetAccountId, accumulatedAccountId, expenseAccountId: expense, gainAccountId: gain, lossAccountId: loss, defaultUsefulLifeMonths: c.lifeMonths } });
    added.push(c.code);
  }
  for (const d of content.dimensions) {
    if (only?.dimensions && !only.dimensions.has(`${d.type}:${d.code}`)) continue;
    if (await tx.dimensionValue.findFirst({ where: { administrationId, type: d.type, code: d.code } })) {
      skipped.push(`${d.type}:${d.code}`);
      continue;
    }
    await tx.dimensionValue.create({ data: { organizationId, administrationId, type: d.type, code: d.code, name: d.name } });
    added.push(`${d.type}:${d.code}`);
  }
  return { added, skipped };
}

/** Used by createAdministration (inside its transaction) after the standard chart is installed. */
export async function applyTemplateToNewAdministration(tx: Tx, organizationId: string, administrationId: string, templateId?: string) {
  const version = templateId ? await latestPublished(tx, templateId) : await defaultTemplateVersion(tx);
  if (templateId && (!version || version.template.status !== "ACTIVE")) throw new UserError("industry.invalidTemplate");
  if (!version) return null; // reference data not seeded (only in bare test databases)
  const content = parseContent(version.content);
  await install(tx, organizationId, administrationId, version.template.code, content);
  await tx.administration.update({ where: { id: administrationId }, data: { templateVersionId: version.id } });
  return version;
}

// ───────────── Upgrades (diff proposal; never overwrites) ─────────────

export async function upgradeProposal(tx: Tx, administrationId: string) {
  const admin = await tx.administration.findUnique({ where: { id: administrationId } });
  if (!admin?.templateVersionId) return null;
  const current = await tx.industryTemplateVersion.findUnique({ where: { id: admin.templateVersionId }, include: { template: true } });
  if (!current) return null;
  const latest = await latestPublished(tx, current.templateId);
  if (!latest || latest.version <= current.version) return { current, latest: null, diff: null, conflicts: [] as string[] };
  const diff = diffContent(parseContent(current.content), parseContent(latest.content));
  const used = new Set((await tx.account.findMany({ where: { administrationId }, select: { number: true } })).map((a) => a.number));
  const conflicts = diff.newAccounts.filter((a) => used.has(a.number)).map((a) => a.number);
  return { current, latest, diff, conflicts };
}

export const upgradeSchema = z.object({
  administrationId: z.string().min(1),
  targetVersionId: z.string().min(1),
  accounts: z.array(z.string()).default([]),
  journals: z.array(z.string()).default([]),
  assetCategories: z.array(z.string()).default([]),
  dimensions: z.array(z.string()).default([]),
});

/** Adds the selected new items of the newer version and records the new version. Changed or removed items are only reported. */
export async function applyUpgrade(access: Access, input: z.infer<typeof upgradeSchema>) {
  return withTenant(scope(access), async (tx) => {
    const admin = await tx.administration.findUnique({ where: { id: input.administrationId } });
    if (!admin) throw new UserError("errors.notFound");
    assertCan(access, "administrations.manageSettings", admin.companyId);
    const proposal = await upgradeProposal(tx, admin.id);
    if (!proposal?.latest || proposal.latest.id !== input.targetVersionId) throw new UserError("industry.upgradeOutdated");
    const content = parseContent(proposal.latest.content);
    const result = await install(tx, access.organizationId, admin.id, proposal.latest.template.code, content, {
      accounts: new Set(input.accounts), journals: new Set(input.journals), assetCategories: new Set(input.assetCategories), dimensions: new Set(input.dimensions),
    });
    await tx.administration.update({ where: { id: admin.id }, data: { templateVersionId: proposal.latest.id } });
    await audit(tx, {
      organizationId: access.organizationId, userId: access.userId, action: "industry.upgraded", entity: "Administration", entityId: admin.id,
      details: { template: proposal.latest.template.code, from: proposal.current.version, to: proposal.latest.version, added: result.added, skipped: result.skipped },
    });
    return result;
  });
}

// ───────────── Custom templates (builder, versions, import/export) ─────────────

const codeSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,30}$/, "validation.code");
export const customTemplateSchema = z.object({
  code: codeSchema,
  name: z.string().trim().min(2, "validation.required").max(120),
  description: z.string().trim().max(500).optional(),
  basedOnTemplateId: z.string().min(1, "validation.required"),
});

async function createTemplate(tx: Tx, access: Access, meta: { code: string; name: string; nameEn?: string; description?: string; descriptionEn?: string; basedOnId?: string }, content: TemplateContent, changelog: string) {
  if (await tx.industryTemplate.findFirst({ where: { ownerOrganizationId: access.organizationId, code: meta.code } })) throw new UserError("errors.codeTaken");
  const template = await tx.industryTemplate.create({ data: { ownerOrganizationId: access.organizationId, ...meta } });
  const version = await tx.industryTemplateVersion.create({
    data: { ownerOrganizationId: access.organizationId, templateId: template.id, version: 1, status: "DRAFT", content: asJson(content), contentHash: contentHash(content), createdById: access.userId, changelog },
  });
  await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "industry.templateCreated", entity: "IndustryTemplate", entityId: template.id, details: { code: meta.code, basedOn: meta.basedOnId ?? null } });
  return { template, version };
}

export async function createCustomTemplate(access: Access, input: z.infer<typeof customTemplateSchema>) {
  return withTenant(scope(access), async (tx) => {
    assertCan(access, "industry.create");
    const base = await latestPublished(tx, input.basedOnTemplateId);
    if (!base) throw new UserError("industry.invalidTemplate");
    return createTemplate(tx, access, { code: input.code, name: input.name, description: input.description || undefined, basedOnId: base.templateId }, parseContent(base.content), `Gebaseerd op ${base.template.code} v${base.version}`);
  });
}

async function ownDraft(tx: Tx, access: Access, versionId: string) {
  const v = await tx.industryTemplateVersion.findUnique({ where: { id: versionId } });
  if (!v || v.ownerOrganizationId !== access.organizationId) throw new UserError("errors.notFound");
  if (v.status !== "DRAFT") throw new UserError("industry.publishedImmutable");
  return v;
}

/** Saves draft content (JSON from the builder). Schema errors are rejected; business issues are reported and block publishing only. */
export async function saveDraftContent(access: Access, versionId: string, raw: unknown) {
  return withTenant(scope(access), async (tx) => {
    assertCan(access, "industry.edit");
    await ownDraft(tx, access, versionId);
    const parsed = templateContentSchema.safeParse(raw);
    if (!parsed.success) throw new UserError("industry.invalidContent", { detail: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    const { issues } = validateContent(parsed.data);
    await tx.industryTemplateVersion.update({ where: { id: versionId }, data: { content: asJson(parsed.data), contentHash: contentHash(parsed.data) } });
    return issues;
  });
}

export async function publishVersion(access: Access, versionId: string, changelog?: string) {
  return withTenant(scope(access), async (tx) => {
    assertCan(access, "industry.manageSettings");
    const v = await ownDraft(tx, access, versionId);
    const { issues } = validateContent(v.content);
    if (issues.length) throw new UserError("industry.hasIssues", { count: issues.length });
    const published = await tx.industryTemplateVersion.update({ where: { id: v.id }, data: { status: "PUBLISHED", publishedAt: new Date(), changelog: changelog?.trim() || v.changelog } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "industry.versionPublished", entity: "IndustryTemplate", entityId: v.templateId, details: { version: v.version, hash: v.contentHash } });
    return published;
  });
}

/** Starts a new draft from the latest published version (one draft at a time). */
export async function newDraftVersion(access: Access, templateId: string) {
  return withTenant(scope(access), async (tx) => {
    assertCan(access, "industry.edit");
    const t = await tx.industryTemplate.findUnique({ where: { id: templateId } });
    if (!t || t.ownerOrganizationId !== access.organizationId) throw new UserError("errors.notFound");
    if (await tx.industryTemplateVersion.findFirst({ where: { templateId, status: "DRAFT" } })) throw new UserError("industry.draftExists");
    const latest = await tx.industryTemplateVersion.findFirst({ where: { templateId }, orderBy: { version: "desc" } });
    const content = parseContent(latest!.content);
    return tx.industryTemplateVersion.create({
      data: { ownerOrganizationId: access.organizationId, templateId, version: latest!.version + 1, status: "DRAFT", content: asJson(content), contentHash: contentHash(content), createdById: access.userId },
    });
  });
}

export async function setTemplateStatus(access: Access, templateId: string, status: "ACTIVE" | "ARCHIVED") {
  return withTenant(scope(access), async (tx) => {
    assertCan(access, "industry.manageSettings");
    const t = await tx.industryTemplate.findUnique({ where: { id: templateId } });
    if (!t || t.ownerOrganizationId !== access.organizationId) throw new UserError("errors.notFound");
    await tx.industryTemplate.update({ where: { id: templateId }, data: { status } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "industry.templateStatus", entity: "IndustryTemplate", entityId: templateId, details: { status } });
  });
}

export const EXPORT_FORMAT = "ara-industry-template";

export const exportDocumentSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  formatVersion: z.literal(1),
  code: codeSchema,
  name: z.string().trim().min(2).max(120),
  nameEn: z.string().trim().max(120).optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
  content: z.unknown(),
});

export async function exportVersion(tx: Tx, versionId: string) {
  const v = await tx.industryTemplateVersion.findUnique({ where: { id: versionId }, include: { template: true } });
  if (!v) return null;
  return {
    format: EXPORT_FORMAT, formatVersion: 1 as const, code: v.template.code, name: v.template.name, nameEn: v.template.nameEn, description: v.template.description,
    version: v.version, status: v.status, contentHash: v.contentHash, content: parseContent(v.content),
  };
}

/** Imports an exported template as a new custom template (draft version 1). */
export async function importTemplate(access: Access, json: string) {
  return withTenant(scope(access), async (tx) => {
    assertCan(access, "industry.create");
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      throw new UserError("industry.invalidJson");
    }
    const doc = exportDocumentSchema.safeParse(raw);
    if (!doc.success) throw new UserError("industry.invalidJson");
    const parsed = templateContentSchema.safeParse(doc.data.content);
    if (!parsed.success) throw new UserError("industry.invalidContent", { detail: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    return createTemplate(tx, access, { code: doc.data.code, name: doc.data.name, nameEn: doc.data.nameEn ?? undefined, description: doc.data.description ?? undefined }, parsed.data, "Geïmporteerd");
  });
}
