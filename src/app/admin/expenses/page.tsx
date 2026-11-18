import { getTranslations } from "next-intl/server";
import { withTenant } from "@/core/tenancy/tenant";
import { requireAdmin, adminCan } from "@/modules/admin/guard";
import { EXPENSE_CATEGORIES } from "@/modules/admin/home";
import { adminReport } from "@/modules/admin/reports";
import { recordExpenseAction } from "@/actions/admin";
import { ActionForm, Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { Card, PageHeader, Table, Td } from "@/components/ui/misc";
import { OpenBooks } from "@/components/admin/open-books";

/** Company expenses of ARA: recorded as purchase invoices on the matching cost account (normal approval rules). */
export default async function ExpensesPage() {
  const t = await getTranslations();
  const a = await requireAdmin("purchase.view");
  const year = new Date().getUTCFullYear();
  const { suppliers, taxCodes, accounts, report } = await withTenant(a.access, async (tx) => ({
    suppliers: await tx.party.findMany({ where: { administrationId: a.home.administrationId, isSupplier: true, status: "ACTIVE" }, orderBy: { name: "asc" } }),
    taxCodes: await tx.taxCode.findMany({ where: { administrationId: a.home.administrationId, status: "ACTIVE", direction: { in: ["PURCHASE", "BOTH"] } }, orderBy: { code: "asc" } }),
    accounts: await tx.financialAccount.findMany({ where: { administrationId: a.home.administrationId, status: "ACTIVE" } }),
    report: await adminReport(tx, a.home, "expenses", year),
  }));
  return (
    <>
      <PageHeader title={t("admin.nav.expenses")} description={t("admin.expenses.intro")} actions={<OpenBooks to="/app/relations" label={t("admin.purchases.suppliers")} />} />
      {adminCan(a, "purchase.create") && (
        <Card title={t("admin.expenses.record")} description={t("admin.expenses.recordIntro")}>
          {suppliers.length === 0 ? <p className="text-sm text-muted-foreground">{t("admin.expenses.noSuppliers")}</p> : (
            <ActionForm action={recordExpenseAction} resetOnSuccess>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label={t("invoicing.supplier")} name="supplierId"><Select name="supplierId" required defaultValue="">{[<option key="" value="">—</option>, ...suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)]}</Select></Field>
                <Field label={t("admin.expenses.category")} name="category"><Select name="category" defaultValue="OTHER">{Object.entries(EXPENSE_CATEGORIES).map(([k, n]) => <option key={k} value={k}>{t(`admin.expenseCategories.${k}`)} ({n})</option>)}</Select></Field>
                <Field label={t("invoicing.supplierInvoiceNumber")} name="externalNumber"><Input name="externalNumber" required /></Field>
                <Field label={t("common.date")} name="date"><Input type="date" name="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></Field>
                <Field label={t("invoicing.reference")} name="description" className="sm:col-span-2"><Input name="description" required /></Field>
                <Field label={t("ledger.currency")} name="currency"><Input name="currency" defaultValue="SRD" maxLength={3} required /></Field>
                <Field label={t("admin.expenses.net")} name="netAmount"><Input name="netAmount" inputMode="decimal" required /></Field>
                <Field label={t("invoicing.taxCode")} name="taxCodeId"><Select name="taxCodeId" defaultValue="">{[<option key="" value="">—</option>, ...taxCodes.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)]}</Select></Field>
                <Field label={t("admin.expenses.dueDays")} name="dueDays"><Input type="number" min={0} name="dueDays" defaultValue={30} /></Field>
                <Field label={t("admin.expenses.rate")} name="exchangeRate" hint={t("admin.payment.rateHint")}><Input name="exchangeRate" inputMode="decimal" /></Field>
                <Field label={t("admin.expenses.paidFrom")} name="paidFromAccountId" hint={t("admin.expenses.paidFromHint")}><Select name="paidFromAccountId" defaultValue="">{[<option key="" value="">—</option>, ...accounts.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.currency})</option>)]}</Select></Field>
              </div>
              <SubmitButton>{t("admin.expenses.save")}</SubmitButton>
            </ActionForm>
          )}
        </Card>
      )}
      <Card title={t("admin.expenses.analysis", { year })} className="mt-6">
        <Table head={report.columns}>{report.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <Td key={j} className={j ? "amount text-right" : ""}>{v}</Td>)}</tr>)}</Table>
      </Card>
    </>
  );
}
