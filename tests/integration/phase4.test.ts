import { describe, expect, it } from "vitest";
import { systemDb } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { createAdministration, createCompany } from "@/modules/organization/service";
import {
  applyUpgrade, createCustomTemplate, exportVersion, importTemplate, newDraftVersion, parseContent, publishVersion, saveDraftContent, upgradeProposal,
} from "@/modules/industry/service";
import { companyInput, newOrganization, refresh } from "./helpers";

async function org() {
  const o = await newOrganization();
  const company = await createCompany(o.access, companyInput());
  const access = await refresh(o.access);
  const platform = async (code: string) => (await systemDb.industryTemplate.findFirstOrThrow({ where: { ownerOrganizationId: null, code } })).id;
  let n = 0;
  const admin = async (templateId?: string) =>
    (await createAdministration(access, { companyId: company.id, code: `A${++n}`, name: `Administratie ${n}`, baseCurrency: "SRD", startYear: 2026, startMonth: 1, templateId })).administration;
  return { access, companyId: company.id, platform, admin };
}

const chart = async (administrationId: string) =>
  (await systemDb.account.findMany({ where: { administrationId }, include: { parent: { select: { number: true } } }, orderBy: { number: "asc" } }))
    .map((a) => [a.number, a.name, a.category, a.type, a.normalBalance, a.controlType, a.parent?.number ?? null, a.templateAccountRef].join("|"));

describe("Phase 4: applying industry templates", () => {
  it("a construction administration gets the template's accounts, asset category and project dimension on top of the standard chart", async () => {
    const o = await org();
    const adm = await o.admin(await o.platform("CONSTRUCTION"));
    const accounts = await systemDb.account.findMany({ where: { administrationId: adm.id } });
    const byNumber = new Map(accounts.map((a) => [a.number, a]));
    expect(byNumber.get("8010")).toBeTruthy(); // standard chart
    expect(byNumber.get("8140")).toMatchObject({ name: "Opbrengst aanneming", category: "REVENUE", normalBalance: "CREDIT", templateAccountRef: "CONSTRUCTION:a8140" });
    expect(byNumber.get("0215")).toMatchObject({ controlType: "FIXED_ASSET", normalBalance: "CREDIT" });
    expect(byNumber.get("8140")!.parentId).toBe(byNumber.get("8000")!.id);
    expect(await systemDb.assetCategory.findFirst({ where: { administrationId: adm.id, code: "BOUWM" } })).toMatchObject({ assetAccountId: byNumber.get("0210")!.id, defaultUsefulLifeMonths: 84 });
    expect(await systemDb.dimensionValue.count({ where: { administrationId: adm.id, type: "PROJECT", code: "ALG" } })).toBe(1);
    const version = await systemDb.industryTemplateVersion.findUniqueOrThrow({ where: { id: (await systemDb.administration.findUniqueOrThrow({ where: { id: adm.id } })).templateVersionId! } });
    expect(version.status).toBe("PUBLISHED");
  });

  it("is reproducible: the same template version gives the same chart; no template means GENERAL", async () => {
    const o = await org();
    const tpl = await o.platform("HOSPITALITY");
    const [a, b] = [await o.admin(tpl), await o.admin(tpl)];
    expect(await chart(a.id)).toEqual(await chart(b.id));
    const plain = await o.admin();
    const general = await systemDb.industryTemplateVersion.findUniqueOrThrow({ where: { id: (await systemDb.administration.findUniqueOrThrow({ where: { id: plain.id } })).templateVersionId! }, include: { template: true } });
    expect(general.template.code).toBe("GENERAL");
    expect((await chart(a.id)).length).toBe((await chart(plain.id)).length + parseContent((await systemDb.industryTemplateVersion.findFirstOrThrow({ where: { templateId: tpl } })).content).accounts.length);
  });

  it("platform templates are read-only for tenants and published versions are immutable for everyone", async () => {
    const o = await org();
    const id = await o.platform("RETAIL");
    await withTenant(o.access, async (tx) => {
      expect(await tx.industryTemplate.count({ where: { id } })).toBe(1); // readable
      expect((await tx.industryTemplate.updateMany({ where: { id }, data: { name: "Gekaapt" } })).count).toBe(0); // not writable
    });
    const v = await systemDb.industryTemplateVersion.findFirstOrThrow({ where: { templateId: id } });
    await expect(systemDb.industryTemplateVersion.update({ where: { id: v.id }, data: { content: {} } })).rejects.toThrow(/immutable/);
    await expect(systemDb.industryTemplateVersion.delete({ where: { id: v.id } })).rejects.toThrow(/immutable/);
  });
});

describe("Phase 4: custom templates, versions and upgrades", () => {
  it("builds, publishes, applies and upgrades without overwriting the administration", async () => {
    const o = await org();
    const { template, version: v1 } = await createCustomTemplate(o.access, { code: "WINKELKETEN", name: "Winkelketen Paramaribo", basedOnTemplateId: await o.platform("TRADE") });
    const base = parseContent(v1.content);
    // Business issues are saved but block publishing.
    const issues = await saveDraftContent(o.access, v1.id, { ...base, accounts: [...base.accounts, { ref: "dup", number: "8010", name: "Dubbel", nameEn: "Duplicate", category: "REVENUE", parent: "8000" }] });
    expect(issues.map((i) => i.key)).toEqual(["industry.issueDuplicateNumber"]);
    await expect(publishVersion(o.access, v1.id)).rejects.toMatchObject({ key: "industry.hasIssues" });
    await saveDraftContent(o.access, v1.id, { ...base, accounts: [...base.accounts, { ref: "filialen", number: "8180", name: "Omzet filialen", nameEn: "Branch revenue", category: "REVENUE", parent: "8000" }] });
    await publishVersion(o.access, v1.id, "Eerste versie");
    await expect(saveDraftContent(o.access, v1.id, base)).rejects.toMatchObject({ key: "industry.publishedImmutable" });

    const adm = await o.admin(template.id);
    expect(await systemDb.account.count({ where: { administrationId: adm.id, number: "8180" } })).toBe(1);
    // The user renames an account from the template.
    await systemDb.account.updateMany({ where: { administrationId: adm.id, number: "8110" }, data: { name: "Omzet eigen naam" } });
    // Someone in the administration already used number 8195 for something else.
    const parent = await systemDb.account.findFirstOrThrow({ where: { administrationId: adm.id, number: "8000" } });
    await systemDb.account.create({ data: { organizationId: o.access.organizationId, administrationId: adm.id, number: "8195", name: "Eigen rekening", category: "REVENUE", normalBalance: "CREDIT", parentId: parent.id } });
    expect((await withTenant(o.access, (tx) => upgradeProposal(tx, adm.id)))!.latest).toBeNull();

    const v2 = await newDraftVersion(o.access, template.id);
    await expect(newDraftVersion(o.access, template.id)).rejects.toMatchObject({ key: "industry.draftExists" });
    const c2 = parseContent(v2.content);
    await saveDraftContent(o.access, v2.id, {
      ...c2,
      accounts: [
        ...c2.accounts.map((a) => (a.number === "8110" ? { ...a, name: "Omzet handelsgoederen (nieuw)" } : a)),
        { ref: "webshop", number: "8190", name: "Omzet webshop", nameEn: "Web shop revenue", category: "REVENUE", parent: "8000" },
        { ref: "eigen", number: "8195", name: "Omzet export regio", nameEn: "Regional export", category: "REVENUE", parent: "8000" },
      ],
      dimensions: [{ type: "COST_CENTER", code: "FIL2", name: "Filiaal 2" }],
    });
    await publishVersion(o.access, v2.id, "Webshop en filiaal 2");

    const proposal = (await withTenant(o.access, (tx) => upgradeProposal(tx, adm.id)))!;
    expect(proposal.latest!.version).toBe(2);
    expect(proposal.diff!.newAccounts.map((a) => a.number)).toEqual(["8190", "8195"]);
    expect(proposal.conflicts).toEqual(["8195"]);
    expect(proposal.diff!.changedAccounts.map((c) => c.to.number)).toEqual(["8110"]);

    const result = await applyUpgrade(o.access, { administrationId: adm.id, targetVersionId: proposal.latest!.id, accounts: ["webshop", "eigen"], journals: [], assetCategories: [], dimensions: ["COST_CENTER:FIL2"] });
    expect(result.added).toEqual(["8190", "COST_CENTER:FIL2"]);
    expect(result.skipped).toEqual(["8195"]);
    const after = await systemDb.account.findMany({ where: { administrationId: adm.id, number: { in: ["8110", "8190", "8195"] } }, orderBy: { number: "asc" } });
    expect(after.map((a) => a.name)).toEqual(["Omzet eigen naam", "Omzet webshop", "Eigen rekening"]); // nothing overwritten
    expect((await systemDb.administration.findUniqueOrThrow({ where: { id: adm.id } })).templateVersionId).toBe(proposal.latest!.id);
    await expect(applyUpgrade(o.access, { administrationId: adm.id, targetVersionId: proposal.latest!.id, accounts: [], journals: [], assetCategories: [], dimensions: [] })).rejects.toMatchObject({ key: "industry.upgradeOutdated" });
  });

  it("exports and re-imports a template with identical content; other organisations cannot see or use it", async () => {
    const o = await org();
    const { template, version } = await createCustomTemplate(o.access, { code: "EXPORTTEST", name: "Export test", basedOnTemplateId: await o.platform("FISHERIES") });
    const doc = await withTenant(o.access, (tx) => exportVersion(tx, version.id));
    const other = await org();
    const imported = await importTemplate(other.access, JSON.stringify({ ...doc, code: "GEIMPORTEERD" }));
    expect(imported.version.contentHash).toBe(version.contentHash);
    expect(imported.version.status).toBe("DRAFT");
    await expect(importTemplate(other.access, "{ geen json")).rejects.toMatchObject({ key: "industry.invalidJson" });
    await expect(importTemplate(other.access, JSON.stringify({ ...doc, content: { accounts: [{ number: "x" }] } }))).rejects.toMatchObject({ key: "industry.invalidContent" });

    await withTenant(other.access, async (tx) => expect(await tx.industryTemplate.count({ where: { id: template.id } })).toBe(0));
    await publishVersion(o.access, version.id);
    await expect(other.admin(template.id)).rejects.toMatchObject({ key: "industry.invalidTemplate" });
  });
});
