import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { systemDb } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { resolveAccess } from "@/core/auth/access";
import { adminAccess, getHome } from "@/modules/admin/home";
import { addActivity, addContact, createCustomer, linkOrganization, setStage, uploadAdminDocument, downloadAdminDocument } from "@/modules/admin/crm";
import { saveProduct } from "@/modules/admin/products";
import { convertToInvoice, decideQuote, reviseQuote, saveQuote, sendQuote } from "@/modules/admin/quotes";
import { createSubscription, runBilling, setSubscriptionStatus, changeSubscription, addMonths } from "@/modules/admin/billing";
import { allocateRemainder, confirmPayment, failPayment, refundPayment, registerPending } from "@/modules/admin/payments";
import { recordExpense } from "@/modules/admin/expenses";
import { createTicket, portalCreateTicket, portalReply } from "@/modules/admin/support";
import { dashboard } from "@/modules/admin/metrics";
import { adminReport, ADMIN_REPORTS } from "@/modules/admin/reports";
import { portalDecideQuote, portalInvoicePdf, portalOverview, portalQuotePdf } from "@/modules/admin/portal";
import { inviteStaff } from "@/modules/admin/staff";
import { approveInvoice, postInvoice, saveParty, createFinancialAccount, submitInvoice } from "@/modules/invoicing/service";
import { importStatement, matchToOpenItems, saveImportProfile } from "@/modules/banking/service";
import { inviteMember } from "@/modules/organization/service";
import { newOrganization, uid } from "./helpers";
import { staff } from "./admin-helpers";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
const year = new Date().getUTCFullYear();
const d = (m: number, day: number) => `${year}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const todayIso = new Date().toISOString().slice(0, 10);

async function bank(ctx: Awaited<ReturnType<typeof staff>>, currency = "SRD") {
  return createFinancialAccount(ctx.access, { administrationId: ctx.home.administrationId, kind: "BANK", name: `Testbank ${uid()}`, accountNumber: uid().slice(1, 9), currency });
}

describe("ARA admin portal: bootstrap and isolation", () => {
  it("ARA's own organisation has the ARA accounts and the initial catalogue without prices", async () => {
    const ctx = await staff();
    const home = (await getHome())!;
    expect(ctx.home).toEqual(home);
    await withTenant(ctx.access, async (tx) => {
      const nums = (await tx.account.findMany({ where: { administrationId: home.administrationId, number: { in: ["8110", "8120", "8130", "8140", "4130", "4140"] } } })).map((a) => a.number).sort();
      expect(nums).toEqual(["4130", "4140", "8110", "8120", "8130", "8140"]);
      const products = await tx.product.findMany({ where: { code: { in: ["ARA-ACC", "ARA-PAY", "ARA-TAX", "ARA-IMPL", "ARA-ONB", "ARA-SUP", "ARA-CONS"] } } });
      expect(products).toHaveLength(7);
      expect(products.every((p) => p.defaultPrice === null)).toBe(true); // prices are the owner's decision
    });
  });

  it("customers' organisations cannot read ARA's CRM, quotations, subscriptions or payments; staff roles are home-only", async () => {
    const ctx = await staff();
    await createCustomer(ctx, { name: `Geheim ${uid()}`, stage: "LEAD" });
    const outsider = await newOrganization();
    await withTenant(outsider.access, async (tx) => {
      expect(await tx.crmCustomer.count()).toBe(0);
      expect(await tx.quotation.count()).toBe(0);
      expect(await tx.araSubscription.count()).toBe(0);
      expect(await tx.araPayment.count()).toBe(0);
      expect(await tx.product.count()).toBe(0);
    });
    await expect(adminAccess(outsider.userId)).rejects.toMatchObject({ key: "errors.forbidden" });
    await expect(inviteMember(outsider.access, { email: `${uid("x")}@example.test`, name: "X", roleCode: "FINANCE_MANAGER" })).rejects.toMatchObject({ key: "errors.roleNotAllowed" });
  });

  it("role permissions: support and sales staff cannot confirm payments; read-only staff cannot create", async () => {
    const support = await staff("SUPPORT_EMPLOYEE");
    const sales = await staff("SALES_MANAGER");
    const ro = await staff("READONLY_EMPLOYEE");
    await expect(confirmPayment(support, "x", "bank")).rejects.toMatchObject({ key: "errors.forbidden" });
    await expect(confirmPayment(sales, "x", "bank")).rejects.toMatchObject({ key: "errors.forbidden" });
    await expect(createCustomer(ro, { name: "Nee" })).rejects.toMatchObject({ key: "errors.forbidden" });
    expect((await createCustomer(sales, { name: `Sales ${uid()}` })).stage).toBe("LEAD");
  });
});

describe("ARA admin portal: acceptance workflows 1–16", () => {
  it("1–10: prospect → customer → product → quotation → send → accept → invoice → payment → allocation → paid", async () => {
    const ctx = await staff();
    // 1. Prospect
    const lead = await createCustomer(ctx, { name: `Wanica Handel ${uid()}`, email: "info@wanica-handel.example", stage: "LEAD", kkfNumber: "12345" });
    expect(lead.number).toMatch(/^CUS-\d{5}$/);
    await addContact(ctx, { customerId: lead.id, name: "R. Ramdin", email: "r.ramdin@wanica-handel.example", isPrimary: true });
    await addActivity(ctx, { customerId: lead.id, type: "CALL", subject: "Kennismaking" });
    await setStage(ctx, lead.id, "QUALIFIED");
    // 2. Convert on the SAME record: debtor created, no duplicate
    const customer = await setStage(ctx, lead.id, "CUSTOMER", "Getekend");
    expect(customer.id).toBe(lead.id);
    expect(customer.partyId).toBeTruthy();
    const party = await systemDb.party.findUniqueOrThrow({ where: { id: customer.partyId! } });
    expect(party).toMatchObject({ administrationId: ctx.home.administrationId, isCustomer: true, name: customer.name });
    // 3. Product (price set by the owner in this test)
    const product = await saveProduct(ctx, { code: `IMP${uid().slice(1, 5).toUpperCase()}`, name: "Implementatiedag", category: "IMPLEMENTATION", billingType: "ONE_TIME", defaultPrice: "2500", currency: "SRD" });
    // 4. Quotation with a discount on a custom line
    const q = await saveQuote(ctx, { customerId: customer.id, quoteDate: todayIso, validUntil: d(12, 31), currency: "SRD", lines: [{ productId: product.id, description: "Implementatiedag", quantity: "2", unitPrice: "2500" }, { description: "Reiskosten", quantity: "1", unitPrice: "300", discountPct: "50" }] });
    expect(q.number).toMatch(new RegExp(`^OFF-${new Date().getUTCFullYear()}-\\d{5}$`));
    expect([q.netAmount.toString(), q.discountAmount.toString(), q.grossAmount.toString()]).toEqual(["5150", "150", "5150"]);
    // 5. Send: no SMTP in tests → e-mail is refused, manual hand-over is recorded instead (no pretend e-mail)
    await expect(sendQuote(ctx, q.id, {})).rejects.toMatchObject({ key: "admin.noEmail" });
    expect((await sendQuote(ctx, q.id, { manual: true })).status).toBe("SENT");
    // Revision history: revise keeps a snapshot, then re-send
    await reviseQuote(ctx, q.id, "Klant vraagt extra dag");
    await saveQuote(ctx, { customerId: customer.id, quoteDate: todayIso, validUntil: d(12, 31), currency: "SRD", lines: [{ productId: product.id, description: "Implementatiedag", quantity: "3", unitPrice: "2500" }] }, q.id);
    await sendQuote(ctx, q.id, { manual: true });
    expect(await systemDb.quotationRevision.count({ where: { quotationId: q.id } })).toBe(1);
    // 6. Accept
    await expect(decideQuote(ctx, q.id, "ACCEPTED", "")).rejects.toMatchObject({ key: "admin.decidedByRequired" });
    await decideQuote(ctx, q.id, "ACCEPTED", "R. Ramdin");
    // 7. Convert → draft invoice with identical totals; the quotation is kept
    const inv = await convertToInvoice(ctx, q.id);
    expect(inv).toMatchObject({ status: "DRAFT", type: "SALES" });
    expect(inv.grossAmount.toString()).toBe("7500");
    expect((await systemDb.quotation.findUniqueOrThrow({ where: { id: q.id } }))).toMatchObject({ status: "CONVERTED", invoiceId: inv.id });
    await expect(convertToInvoice(ctx, q.id)).rejects.toMatchObject({ key: "ledger.wrongStatus" });
    const posted = await postInvoice(ctx.access, inv.id);
    expect(posted.number).toBeTruthy();
    // 8. Register a payment: PENDING changes nothing
    const fa = await bank(ctx);
    const pay = await registerPending(ctx, { customerId: customer.id, method: "BANK_TRANSFER", reference: "DSB-001", paymentDate: todayIso, amount: "8000", financialAccountId: fa.id, allocations: [{ invoiceId: inv.id, amount: "7500" }] });
    expect(pay.status).toBe("PENDING");
    expect((await systemDb.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("POSTED");
    // 9–10. Confirm (verification required) → posted, allocated, invoice PAID, 500 unallocated
    await expect(confirmPayment(ctx, pay.id, "")).rejects.toMatchObject({ key: "admin.verificationRequired" });
    const confirmed = await confirmPayment(ctx, pay.id, "Bankafschrift DSB regel 12");
    expect(confirmed.status).toBe("CONFIRMED");
    expect((await systemDb.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PAID");
    await expect(confirmPayment(ctx, pay.id, "nogmaals")).rejects.toMatchObject({ key: "ledger.wrongStatus" });
    await expect(systemDb.araPayment.update({ where: { id: pay.id }, data: { amount: "1" } })).rejects.toThrow(/immutable/);
    // The 500 on account: refund 200, keep 300
    await refundPayment(ctx, pay.id, { financialAccountId: fa.id, date: todayIso, amount: "200", reason: "Te veel betaald" });
    const onAccount = await systemDb.openItem.findFirstOrThrow({ where: { sourceType: "PAYMENT", sourceId: confirmed.ledgerPaymentId! } });
    expect(onAccount.remainingAmount.toString()).toBe("-300");
    // A failed pending payment never posts
    const bad = await registerPending(ctx, { customerId: customer.id, method: "BANK_TRANSFER", paymentDate: todayIso, amount: "10", financialAccountId: fa.id });
    await failPayment(ctx, bad.id, "Niet op afschrift");
    expect((await systemDb.araPayment.findUniqueOrThrow({ where: { id: bad.id } })).ledgerPaymentId).toBeNull();
  });

  it("allocating an unallocated remainder later; over-allocation is refused", async () => {
    const ctx = await staff();
    const c = await createCustomer(ctx, { name: `Later ${uid()}`, stage: "CUSTOMER" });
    const product = await saveProduct(ctx, { code: `SV${uid().slice(1, 6).toUpperCase()}`, name: "Supportuur", category: "SUPPORT", billingType: "ONE_TIME", defaultPrice: "100", currency: "SRD" });
    const q = await saveQuote(ctx, { customerId: c.id, quoteDate: todayIso, validUntil: d(12, 31), currency: "SRD", lines: [{ productId: product.id, description: "Supportuur", quantity: "4", unitPrice: "100" }] });
    await sendQuote(ctx, q.id, { manual: true });
    await decideQuote(ctx, q.id, "ACCEPTED", "Klant");
    const inv = await postInvoice(ctx.access, (await convertToInvoice(ctx, q.id)).id);
    const fa = await bank(ctx);
    const p = await confirmPayment(ctx, (await registerPending(ctx, { customerId: c.id, method: "BANK_TRANSFER", paymentDate: todayIso, amount: "500", financialAccountId: fa.id })).id, "Afschrift");
    await expect(allocateRemainder(ctx, p.id, inv.id, "450")).rejects.toThrow();
    await allocateRemainder(ctx, p.id, inv.id, "400");
    expect((await systemDb.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PAID");
  });

  it("11–12: subscription, trial without auto-conversion, idempotent recurring invoicing, upgrade, suspension only by decision", async () => {
    const ctx = await staff();
    const c = await createCustomer(ctx, { name: `Abonnee ${uid()}`, stage: "CUSTOMER", paymentTermDays: 10 });
    const acc = await systemDb.product.findFirstOrThrow({ where: { organizationId: ctx.home.organizationId, code: "ARA-ACC" } });
    await expect(createSubscription(ctx, { customerId: c.id, productId: acc.id, interval: "MONTHLY", startDate: d(1, 1) })).rejects.toMatchObject({ key: "admin.priceRequired" });
    const start = `${year - 1}-11-15`;
    const sub = await createSubscription(ctx, { customerId: c.id, productId: acc.id, interval: "MONTHLY", unitPrice: "750", startDate: start });
    expect(sub.status).toBe("ACTIVE");
    // Two runs on the same day: periods since the start are invoiced exactly once (max 12 per run).
    const asOf = `${year}-01-20`;
    const r1 = await runBilling(ctx, asOf);
    const mine = r1.invoiced.filter((i) => i.subscription === sub.number);
    expect(mine.map((i) => i.period)).toEqual([`${year - 1}-11-15 – ${year - 1}-12-14`, `${year - 1}-12-15 – ${year}-01-14`, `${year}-01-15 – ${year}-02-14`]);
    const r2 = await runBilling(ctx, asOf);
    expect(r2.invoiced.filter((i) => i.subscription === sub.number)).toEqual([]);
    expect(await systemDb.subscriptionBilling.count({ where: { subscriptionId: sub.id } })).toBe(3);
    const inv = await systemDb.invoice.findUniqueOrThrow({ where: { id: mine[0]!.invoiceId } });
    expect(inv).toMatchObject({ status: "DRAFT", currency: "SRD" });
    expect(inv.grossAmount.toString()).toBe("750");
    await expect(systemDb.subscriptionBilling.create({ data: { organizationId: ctx.home.organizationId, subscriptionId: sub.id, periodStart: new Date(`${year - 1}-11-15T00:00:00Z`), periodEnd: new Date(), invoiceId: inv.id } })).rejects.toThrow(); // unique period
    // Upgrade takes effect next period; history kept
    await changeSubscription(ctx, { subscriptionId: sub.id, unitPrice: "900", reason: "Meer gebruikers" });
    expect((await systemDb.subscriptionEvent.findMany({ where: { subscriptionId: sub.id } })).map((e) => e.type)).toEqual(expect.arrayContaining(["CREATED", "INVOICED", "UPGRADED"]));
    // Trial: never billed, ended trial reported once, not converted automatically
    const trial = await createSubscription(ctx, { customerId: c.id, productId: acc.id, interval: "ANNUAL", unitPrice: "6000", startDate: `${year - 1}-12-01`, trialDays: 30 });
    const r3 = await runBilling(ctx, asOf);
    expect(r3.trialsEnded).toContain(trial.number);
    expect(r3.invoiced.filter((i) => i.subscription === trial.number)).toEqual([]);
    expect((await systemDb.araSubscription.findUniqueOrThrow({ where: { id: trial.id } })).status).toBe("TRIAL");
    await setSubscriptionStatus(ctx, trial.id, "ACTIVATE", "Klant heeft getekend");
    // Suspension needs an explicit decision with a reason
    await expect(setSubscriptionStatus(ctx, sub.id, "SUSPEND", "")).rejects.toMatchObject({ key: "errors.reasonRequired" });
    await setSubscriptionStatus(ctx, sub.id, "SUSPEND", "Op verzoek klant");
    const r4 = await runBilling(ctx, `${year}-06-30`);
    expect(r4.invoiced.filter((i) => i.subscription === sub.number)).toEqual([]);
    expect(addMonths(new Date("2026-01-31T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe("2026-02-28");
  });

  it("subscription with a plan keeps the customer's ARA Accounting organisation in line (plan and status)", async () => {
    const ctx = await staff();
    const customerOrg = await newOrganization();
    const c = await createCustomer(ctx, { name: `Gekoppeld ${uid()}`, stage: "CUSTOMER" });
    await linkOrganization(ctx, c.id, customerOrg.organizationId);
    const plan = await systemDb.plan.create({ data: { code: `P${uid().slice(1, 8).toUpperCase()}`, name: "Testpakket" } });
    const acc = await systemDb.product.findFirstOrThrow({ where: { organizationId: ctx.home.organizationId, code: "ARA-ACC" } });
    const sub = await createSubscription(ctx, { customerId: c.id, productId: acc.id, interval: "MONTHLY", unitPrice: "500", startDate: todayIso, planId: plan.id });
    expect(await systemDb.organization.findUniqueOrThrow({ where: { id: customerOrg.organizationId } })).toMatchObject({ planId: plan.id, status: "ACTIVE" });
    await setSubscriptionStatus(ctx, sub.id, "CANCEL", "Opgezegd");
    expect((await systemDb.organization.findUniqueOrThrow({ where: { id: customerOrg.organizationId } })).status).toBe("CANCELLED");
  });

  it("13–16: expense, bank import, reconciliation and monthly finance reports", async () => {
    const ctx = await staff();
    // 13. Expense (purchase invoice on the hosting account), paid at once
    const supplier = await saveParty(ctx.access, { administrationId: ctx.home.administrationId, code: `HOST${uid().slice(1, 5).toUpperCase()}`, name: "Hostingbedrijf", isCustomer: false, isSupplier: true, currency: "SRD", paymentTermDays: 30 });
    const fa = await bank(ctx);
    const e = await recordExpense(ctx, { supplierId: supplier.id, category: "HOSTING", externalNumber: `H-${uid()}`, date: todayIso, description: "Hosting november", currency: "SRD", netAmount: "1200", paidFromAccountId: fa.id });
    // ARA's administration requires purchase approval (segregation of duties): a finance manager approves, then posts.
    expect(e.posted).toBe(false);
    const finance = await staff("FINANCE_MANAGER");
    await submitInvoice(ctx.access, e.invoice.id);
    await approveInvoice(finance.access, e.invoice.id);
    await postInvoice(finance.access, e.invoice.id);
    const lines = await systemDb.invoiceLine.findMany({ where: { invoiceId: e.invoice.id } });
    expect((await systemDb.account.findUniqueOrThrow({ where: { id: lines[0]!.accountId } })).number).toBe("4140");
    // 14. Bank import (synthetic statement built by the test, not a bank sample)
    const c = await createCustomer(ctx, { name: `Betaler ${uid()}`, stage: "CUSTOMER" });
    const product = await saveProduct(ctx, { code: `CN${uid().slice(1, 6).toUpperCase()}`, name: "Consultancy", category: "CONSULTANCY", billingType: "ONE_TIME", defaultPrice: "1000", currency: "SRD" });
    const q = await saveQuote(ctx, { customerId: c.id, quoteDate: todayIso, validUntil: d(12, 31), currency: "SRD", lines: [{ productId: product.id, description: "Advies", quantity: "1", unitPrice: "1000" }] });
    await sendQuote(ctx, q.id, { manual: true });
    await decideQuote(ctx, q.id, "ACCEPTED", "Klant");
    const inv = await postInvoice(ctx.access, (await convertToInvoice(ctx, q.id)).id);
    await saveImportProfile(ctx.access, fa.id, { delimiter: ";", hasHeader: true, dateColumn: 0, dateFormat: "YYYY-MM-DD", amountColumn: 2, decimalSeparator: ",", descriptionColumn: 1 });
    const imported = await importStatement(ctx.access, { financialAccountId: fa.id, fileName: "test.csv", content: `Datum;Omschrijving;Bedrag\n${todayIso};Betaling ${inv.number};1000,00\n` });
    expect(imported.lineCount ?? imported).toBeTruthy();
    await expect(importStatement(ctx.access, { financialAccountId: fa.id, fileName: "test.csv", content: `Datum;Omschrijving;Bedrag\n${todayIso};Betaling ${inv.number};1000,00\n` })).rejects.toMatchObject({ key: "banking.fileAlreadyImported" });
    // 15. Reconcile: match the bank line to the invoice
    const tx = await systemDb.bankTransaction.findFirstOrThrow({ where: { financialAccountId: fa.id } });
    const item = await systemDb.openItem.findFirstOrThrow({ where: { sourceType: "INVOICE", sourceId: inv.id } });
    await matchToOpenItems(ctx.access, { transactionId: tx.id, allocations: [{ openItemId: item.id, amount: "1000" }] });
    expect((await systemDb.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PAID");
    // 16. Reports and dashboard from real records
    const dash = await withTenant(ctx.access, (t) => dashboard(t, ctx.home));
    expect(Number(dash.money.invoicedYear)).toBeGreaterThan(0);
    expect(Number(dash.money.collectedYear)).toBeGreaterThan(0);
    expect(dash.customers.total).toBeGreaterThan(0);
    for (const kind of ADMIN_REPORTS) {
      const r = await withTenant(ctx.access, (t) => adminReport(t, ctx.home, kind, new Date().getUTCFullYear()));
      expect(r.columns.length).toBeGreaterThan(1);
    }
    const monthly = await withTenant(ctx.access, (t) => adminReport(t, ctx.home, "revenueMonthly", new Date().getUTCFullYear()));
    expect(new Decimal(String(monthly.rows.at(-1)![2])).gt(0)).toBe(true);
  });
});

describe("ARA admin portal: documents, staff, support and the customer portal", () => {
  it("documents: stored privately (database backend without Supabase config), authorised download, append-only", async () => {
    const ctx = await staff();
    const c = await createCustomer(ctx, { name: `Doc ${uid()}`, stage: "CUSTOMER" });
    await expect(uploadAdminDocument(ctx, { category: "CONTRACT", customerId: c.id }, { fileName: "x.exe", bytes: Buffer.from("MZ...") })).rejects.toMatchObject({ key: "scan.unsupportedType" });
    const doc = await uploadAdminDocument(ctx, { category: "CONTRACT", customerId: c.id }, { fileName: "contract.pdf", bytes: PDF });
    expect(doc.storage).toBe("DATABASE");
    const { bytes } = await downloadAdminDocument(ctx, doc.id);
    expect(Buffer.from(bytes).equals(PDF)).toBe(true);
    await expect(systemDb.adminDocument.update({ where: { id: doc.id }, data: { fileName: "x" } })).rejects.toThrow();
    const outsider = await newOrganization();
    await withTenant(outsider.access, async (tx) => expect(await tx.adminDocument.count()).toBe(0));
  });

  it("staff invitations use staff roles in ARA's organisation only", async () => {
    const ctx = await staff();
    const r = await inviteStaff(ctx, { email: `${uid("emp")}@example.test`, name: "Nieuwe Medewerker", roleCode: "SUPPORT_EMPLOYEE", jobTitle: "Support" });
    expect(r.membershipId).toBeTruthy();
    expect(await systemDb.employee.count({ where: { organizationId: ctx.home.organizationId, name: "Nieuwe Medewerker" } })).toBeGreaterThan(0);
  });

  it("customer portal: own subscriptions, invoices and quotations only; accept as customer administrator; tickets both ways", async () => {
    const ctx = await staff();
    const a = await newOrganization();
    const b = await newOrganization();
    const ca = await createCustomer(ctx, { name: `Portaal A ${uid()}`, stage: "CUSTOMER" });
    const cb = await createCustomer(ctx, { name: `Portaal B ${uid()}`, stage: "CUSTOMER" });
    await linkOrganization(ctx, ca.id, a.organizationId);
    await linkOrganization(ctx, cb.id, b.organizationId);
    await expect(linkOrganization(ctx, cb.id, a.organizationId)).rejects.toMatchObject({ key: "admin.organizationLinked" });
    const product = await saveProduct(ctx, { code: `PT${uid().slice(1, 6).toUpperCase()}`, name: "Training", category: "ONBOARDING", billingType: "ONE_TIME", defaultPrice: "400", currency: "SRD" });
    const qa = await saveQuote(ctx, { customerId: ca.id, quoteDate: todayIso, validUntil: d(12, 31), currency: "SRD", lines: [{ productId: product.id, description: "Training", quantity: "1", unitPrice: "400" }] });
    const draftB = await saveQuote(ctx, { customerId: cb.id, quoteDate: todayIso, validUntil: d(12, 31), currency: "SRD", lines: [{ description: "x", quantity: "1", unitPrice: "1" }] });
    await sendQuote(ctx, qa.id, { manual: true });
    const ov = await portalOverview(a.access);
    expect(ov.quotations.map((q) => q.id)).toEqual([qa.id]);
    await expect(portalQuotePdf(a.access, draftB.id, "nl")).rejects.toMatchObject({ key: "errors.notFound" });
    await expect(portalQuotePdf(b.access, qa.id, "nl")).rejects.toMatchObject({ key: "errors.notFound" });
    const pdf = await portalQuotePdf(a.access, qa.id, "nl");
    expect(Buffer.from(pdf.bytes).subarray(0, 4).toString()).toBe("%PDF");
    expect((await systemDb.quotation.findUniqueOrThrow({ where: { id: qa.id } })).status).toBe("VIEWED");
    // A read-only member cannot accept; the owner (customer administrator) can.
    const inv = await inviteMember(a.access, { email: `${uid("ro")}@example.test`, name: "Lezer", roleCode: "READ_ONLY" });
    const ro = await systemDb.organizationMembership.update({ where: { id: inv.membershipId }, data: { status: "ACTIVE" } });
    await expect(portalDecideQuote((await resolveAccess(ro.userId, a.organizationId))!, qa.id, "ACCEPTED", "Lezer")).rejects.toMatchObject({ key: "errors.forbidden" });
    await portalDecideQuote(a.access, qa.id, "ACCEPTED", "Eigenaar A");
    const invoice = await postInvoice(ctx.access, (await convertToInvoice(ctx, qa.id)).id);
    expect((await portalOverview(a.access)).invoices.map((i) => i.id)).toEqual([invoice.id]);
    expect((await portalOverview(b.access)).invoices).toEqual([]);
    await expect(portalInvoicePdf(b.access, invoice.id, "nl")).rejects.toMatchObject({ key: "errors.notFound" });
    expect(Buffer.from((await portalInvoicePdf(a.access, invoice.id, "nl")).bytes).subarray(0, 4).toString()).toBe("%PDF");
    // Support: customer opens a ticket, staff sees it, internal notes stay internal
    const t = await portalCreateTicket({ userId: a.userId, organizationId: a.organizationId }, { subject: "Vraag over factuur", body: "Kunt u dit toelichten?" });
    expect(t.customerId).toBe(ca.id);
    const { replyTicket } = await import("@/modules/admin/support");
    await replyTicket(ctx, t.id, "Interne notitie", true);
    await replyTicket(ctx, t.id, "Natuurlijk, zie bijlage.", false);
    await portalReply({ userId: a.userId, organizationId: a.organizationId }, t.id, "Dank u.");
    await expect(portalReply({ userId: b.userId, organizationId: b.organizationId }, t.id, "Inbraak")).rejects.toMatchObject({ key: "errors.notFound" });
    const visible = (await portalOverview(a.access)).tickets.find((x) => x.id === t.id)!;
    expect(visible.messages.map((m) => m.body)).toEqual(["Kunt u dit toelichten?", "Natuurlijk, zie bijlage.", "Dank u."]);
    expect((await portalOverview(b.access)).tickets.find((x) => x.id === t.id)).toBeUndefined();
    await createTicket(ctx, { subject: "Intern", body: "Voorbeeld", customerId: ca.id });
  });
});
