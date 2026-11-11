import type { Access } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";

export type TemplateChoice = { id: string; code: string; name: string; own: boolean };

/** Active templates with a published version, for the administration wizard (platform first, then own). */
export async function templateChoices(access: Access, locale: string): Promise<TemplateChoice[]> {
  const rows = await withTenant(access, (tx) =>
    tx.industryTemplate.findMany({ where: { status: "ACTIVE", versions: { some: { status: "PUBLISHED" } } }, orderBy: { name: "asc" } }),
  );
  const list = rows.map((r) => ({ id: r.id, code: r.code, name: (locale === "en" && r.nameEn) || r.name, own: !!r.ownerOrganizationId }));
  return [...list.filter((r) => !r.own && r.code === "GENERAL"), ...list.filter((r) => !r.own && r.code !== "GENERAL"), ...list.filter((r) => r.own)];
}
