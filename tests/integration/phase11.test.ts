import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { systemDb } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { accessState, assertWritable, confirmPayment, createSubscriptionInvoice, savePlan, setSubscription, trialDays } from "@/modules/saas/service";
import { createTask, portfolio, setTaskStatus } from "@/modules/practice/service";
import { scanNow } from "@/modules/quality/service";
import { uploadDocument } from "@/modules/scan/service";
import { createAdministration, createCompany, inviteMember, registerOrganization } from "@/modules/organization/service";
import { companyInput, newOrganization, refresh, uid } from "./helpers";

async function platformAdmin() {
  const o = await newOrganization();
  await systemDb.user.update({ where: { id: o.userId }, data: { isPlatformAdmin: true } });
  return o.userId;
}
const pdf = async (text: string) => PDFDocument.create().then(async (d) => { d.setTitle(text); d.addPage(); return d.save(); });

describe("Phase 11: subscriptions and entitlements", () => {
  it("a new organisation gets a trial; an ended trial, suspension or cancellation makes it read-only; tenants cannot change it", async () => {
    const r = await registerOrganization({ organizationName: `Proef ${uid()}`, kind: "BUSINESS", name: "Proef", email: `${uid("p")}@example.test`, password: "een lang test wachtwoord" } as never);
    const org = await systemDb.organization.findUniqueOrThrow({ where: { id: r.organizationId } });
    const days = Math.round((org.trialEndsAt!.getTime() - Date.now()) / 86_400_000);
    expect(days).toBe(trialDays());
    expect(accessState(org).readOnly).toBe(false);
    expect(accessState({ ...org, trialEndsAt: new Date(Date.now() - 1000) })).toEqual({ readOnly: true, reason: "TRIAL_ENDED" });
    expect(() => assertWritable({ ...org, status: "SUSPENDED" })).toThrow(expect.objectContaining({ key: "saas.readOnly" }));
    await expect(withTenant({ organizationId: org.id, userId: r.userId }, (tx) => tx.organization.update({ where: { id: org.id }, data: { status: "ACTIVE", trialEndsAt: new Date("2099-01-01") } }))).rejects.toThrow(/platform/);
  });

  it("plan limits are enforced on companies, administrations, users and documents; only platform admins manage plans", async () => {
    const adminId = await platformAdmin();
    const o = await newOrganization();
    await expect(savePlan(o.userId, { code: "X", name: "x" })).rejects.toMatchObject({ key: "errors.forbidden" });
    const plan = await savePlan(adminId, { code: `KLEIN${uid().slice(0, 4).toUpperCase()}`, name: "Klein", companies: "1", administrations: "1", users: "2", documentsPerMonth: "1", priceMonthlySrd: "", priceMonthlyUsd: "" });
    expect(plan.limits).toEqual({ companies: 1, administrations: 1, users: 2, documentsPerMonth: 1 });
    expect(plan.priceMonthlySrd).toBeNull(); // prices are the owner's decision; left empty
    await setSubscription(adminId, { organizationId: o.organizationId, planId: plan.id, status: "ACTIVE" });

    const company = await createCompany(o.access, companyInput());
    const access = await refresh(o.access);
    await expect(createCompany(access, companyInput())).rejects.toMatchObject({ key: "saas.limitReached", values: { what: "companies", limit: 1 } });
    const { administration } = await createAdministration(access, { companyId: company.id, code: "A1", name: "Een", baseCurrency: "SRD", startYear: 2026, startMonth: 1 });
    await expect(createAdministration(access, { companyId: company.id, code: "A2", name: "Twee", baseCurrency: "SRD", startYear: 2026, startMonth: 1 })).rejects.toMatchObject({ key: "saas.limitReached" });
    await inviteMember(access, { email: `${uid("m")}@example.test`, name: "Tweede", roleCode: "BOOKKEEPER" });
    await expect(inviteMember(access, { email: `${uid("m")}@example.test`, name: "Derde", roleCode: "BOOKKEEPER" })).rejects.toMatchObject({ key: "saas.limitReached", values: { what: "users" } });
    await uploadDocument(access, { administrationId: administration.id, fileName: "a.pdf", bytes: await pdf("a") }, []);
    await expect(uploadDocument(access, { administrationId: administration.id, fileName: "b.pdf", bytes: await pdf("b") }, [])).rejects.toMatchObject({ key: "saas.limitReached", values: { what: "documentsPerMonth" } });
  });

  it("subscription invoices: gapless numbers, manual payment confirmation with reference reactivates; organisations read only their own", async () => {
    const adminId = await platformAdmin();
    const a = await newOrganization();
    const b = await newOrganization();
    await expect(setSubscription(adminId, { organizationId: a.organizationId, status: "SUSPENDED" })).rejects.toMatchObject({ key: "errors.reasonRequired" });
    await setSubscription(adminId, { organizationId: a.organizationId, status: "SUSPENDED", reason: "Factuur niet betaald" });
    const year = String(2090 + Math.floor(Math.random() * 9));
    // Tests never truncate: earlier runs may already hold numbers for this year. Gapless means "the next ones".
    const before = await systemDb.subscriptionInvoice.count({ where: { number: { startsWith: `SUB-${year}-` } } });
    const no = (n: number) => `SUB-${year}-${String(before + n).padStart(5, "0")}`;
    const i1 = await createSubscriptionInvoice(adminId, { organizationId: a.organizationId, periodFrom: `${year}-01-01`, periodTo: `${year}-01-31`, currency: "SRD", amount: "1500" });
    const i2 = await createSubscriptionInvoice(adminId, { organizationId: b.organizationId, periodFrom: `${year}-01-01`, periodTo: `${year}-01-31`, currency: "USD", amount: "40" });
    expect([i1.number, i2.number]).toEqual([no(1), no(2)]);
    await expect(confirmPayment(adminId, { invoiceId: i1.id, reference: "", reactivate: true })).rejects.toMatchObject({ key: "saas.referenceRequired" });
    await confirmPayment(adminId, { invoiceId: i1.id, reference: "DSB overboeking 123", reactivate: true });
    expect((await systemDb.organization.findUniqueOrThrow({ where: { id: a.organizationId } })).status).toBe("ACTIVE");
    await expect(confirmPayment(adminId, { invoiceId: i1.id, reference: "nogmaals", reactivate: true })).rejects.toMatchObject({ key: "ledger.wrongStatus" });
    await withTenant(a.access, async (tx) => {
      expect((await tx.subscriptionInvoice.findMany()).map((i) => i.number)).toEqual([i1.number]);
      await expect(tx.subscriptionInvoice.update({ where: { id: i1.id }, data: { amount: "1" } })).rejects.toThrow();
    });
  });
});

describe("Phase 11: practice management (workflow 10)", () => {
  it("the portfolio shows every client administration with quality, workload and BTW status; tasks can be assigned and completed", async () => {
    const firm = await newOrganization("ACCOUNTING_FIRM");
    const c1 = await createCompany(firm.access, { ...companyInput("Klant Albina NV"), isBtwRegistered: false });
    const c2 = await createCompany(firm.access, { ...companyInput("Klant Moengo NV"), isBtwRegistered: true });
    const access = await refresh(firm.access);
    const a1 = await createAdministration(access, { companyId: c1.id, code: "HOOFD", name: "Albina", baseCurrency: "SRD", startYear: new Date().getUTCFullYear(), startMonth: 1 });
    await createAdministration(access, { companyId: c2.id, code: "HOOFD", name: "Moengo", baseCurrency: "SRD", startYear: new Date().getUTCFullYear(), startMonth: 1 });
    await scanNow(access, a1.administration.id);
    const rows = await withTenant(access, (tx) => portfolio(tx, access));
    expect(rows.map((r) => r.company.name)).toEqual(["Klant Albina NV", "Klant Moengo NV"]);
    const scan = await systemDb.qualityScan.findFirstOrThrow({ where: { administrationId: a1.administration.id } });
    expect(rows[0]!.score).toBe(scan.score);
    expect(rows[1]!.score).toBeNull(); // never scanned
    expect(rows[0]!.btw).toBeNull(); // not BTW-registered
    expect(rows[1]!.btw).toMatchObject({ done: false, deadlineIsPlaceholder: true });

    const inv = await inviteMember(access, { email: `${uid("s")}@example.test`, name: "Medewerker", roleCode: "BOOKKEEPER" });
    const m = await systemDb.organizationMembership.update({ where: { id: inv.membershipId }, data: { status: "ACTIVE" } });
    const task = await createTask(access, { title: "BTW-aangifte Moengo opstellen", companyId: c2.id, dueDate: "2026-12-16", assigneeId: m.userId });
    expect(await systemDb.notification.count({ where: { userId: m.userId, type: "taskAssigned" } })).toBe(1);
    expect((await withTenant(access, (tx) => portfolio(tx, access)))[1]!.openTasks).toBe(1);
    await setTaskStatus(access, task.id, "DONE");
    expect((await systemDb.practiceTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("DONE");
  });
});
