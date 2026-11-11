import type { Prisma, PrismaClient } from "@prisma/client";
import { contentHash, validateContent } from "./content";
import { PLATFORM_TEMPLATES } from "./library";

/** Idempotent: creates each platform template and publishes a new version only when its content changed. */
export async function seedPlatformTemplates(db: PrismaClient) {
  for (const def of PLATFORM_TEMPLATES) {
    const { content, issues } = validateContent(def.content);
    if (issues.length) throw new Error(`Template ${def.code} is invalid: ${issues.map((i) => `${i.key} ${JSON.stringify(i.values)}`).join(", ")}`);
    const hash = contentHash(content);
    const meta = { name: def.name, nameEn: def.nameEn, description: def.description, descriptionEn: def.descriptionEn };
    const existing = await db.industryTemplate.findFirst({ where: { ownerOrganizationId: null, code: def.code } });
    const template = existing ? await db.industryTemplate.update({ where: { id: existing.id }, data: meta }) : await db.industryTemplate.create({ data: { code: def.code, ...meta } });
    const latest = await db.industryTemplateVersion.findFirst({ where: { templateId: template.id }, orderBy: { version: "desc" } });
    if (latest?.contentHash === hash) continue;
    await db.industryTemplateVersion.create({
      data: { templateId: template.id, version: (latest?.version ?? 0) + 1, status: "PUBLISHED", content: content as unknown as Prisma.InputJsonValue, contentHash: hash, publishedAt: new Date(), changelog: latest ? "Platform update" : "Eerste versie" },
    });
  }
}

