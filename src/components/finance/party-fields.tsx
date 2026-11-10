import { getTranslations } from "next-intl/server";
import type { Party } from "@prisma/client";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { DistrictSelect } from "./org-fields";

export async function PartyFields({ party, revenue, expense, taxCodes }: {
  party?: Party | null;
  revenue: { id: string; number: string; name: string }[];
  expense: { id: string; number: string; name: string }[];
  taxCodes: { id: string; code: string; name: string }[];
}) {
  const t = await getTranslations();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-6">
        <Checkbox name="isCustomer" label={t("invoicing.isCustomer")} defaultChecked={party?.isCustomer ?? true} />
        <Checkbox name="isSupplier" label={t("invoicing.isSupplier")} defaultChecked={party?.isSupplier ?? false} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("administration.code")} name="code"><Input name="code" defaultValue={party?.code} readOnly={!!party} required /></Field>
        <Field label={t("company.name")} name="name" className="sm:col-span-2"><Input name="name" defaultValue={party?.name} required /></Field>
        <Field label={t("company.kkfNumber")} name="kkfNumber"><Input name="kkfNumber" defaultValue={party?.kkfNumber ?? ""} /></Field>
        <Field label={t("company.taxNumber")} name="taxNumber"><Input name="taxNumber" defaultValue={party?.taxNumber ?? ""} /></Field>
        <Field label={t("company.btwNumber")} name="btwNumber"><Input name="btwNumber" defaultValue={party?.btwNumber ?? ""} /></Field>
        <Field label={t("company.email")} name="email"><Input name="email" type="email" defaultValue={party?.email ?? ""} /></Field>
        <Field label={t("company.phone")} name="phone"><Input name="phone" defaultValue={party?.phone ?? ""} /></Field>
        <Field label={t("company.district")} name="district"><DistrictSelect defaultValue={party?.district} /></Field>
        <Field label={t("company.address")} name="address" className="sm:col-span-3"><Input name="address" defaultValue={party?.address ?? ""} /></Field>
        <Field label={t("ledger.currency")} name="currency">
          <Select name="currency" defaultValue={party?.currency ?? "SRD"}>{["SRD", "USD", "EUR", "GBP"].map((c) => <option key={c} value={c}>{c}</option>)}</Select>
        </Field>
        <Field label={t("invoicing.paymentTerm")} name="paymentTermDays"><Input name="paymentTermDays" type="number" min={0} max={365} defaultValue={party?.paymentTermDays ?? 30} /></Field>
        <Field label={t("invoicing.defaultTaxCode")} name="defaultTaxCodeId">
          <Select name="defaultTaxCodeId" defaultValue={party?.defaultTaxCodeId ?? ""}><option value="">—</option>{taxCodes.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</Select>
        </Field>
        <Field label={t("invoicing.defaultRevenueAccount")} name="defaultRevenueAccountId">
          <Select name="defaultRevenueAccountId" defaultValue={party?.defaultRevenueAccountId ?? ""}><option value="">—</option>{revenue.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)}</Select>
        </Field>
        <Field label={t("invoicing.defaultExpenseAccount")} name="defaultExpenseAccountId">
          <Select name="defaultExpenseAccountId" defaultValue={party?.defaultExpenseAccountId ?? ""}><option value="">—</option>{expense.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)}</Select>
        </Field>
        <Field label={t("invoicing.bankName")} name="bankName"><Input name="bankName" defaultValue={party?.bankName ?? ""} /></Field>
        <Field label={t("invoicing.bankAccountNumber")} name="bankAccountNumber"><Input name="bankAccountNumber" defaultValue={party?.bankAccountNumber ?? ""} /></Field>
      </div>
    </div>
  );
}
