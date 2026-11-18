import { getTranslations } from "next-intl/server";
import type { CrmCustomer } from "@prisma/client";
import { Field, Input, Select, Textarea } from "@/components/ui/form";

/** Shared fields of the CRM customer form (create and edit). */
export async function CustomerFields({ c, staff }: { c?: CrmCustomer; staff: { id: string; name: string }[] }) {
  const t = await getTranslations();
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label={t("admin.customer.name")} name="name"><Input name="name" defaultValue={c?.name} required /></Field>
      <Field label={t("admin.customer.kind")} name="kind"><Select name="kind" defaultValue={c?.kind ?? "COMPANY"}><option value="COMPANY">{t("admin.customer.kinds.COMPANY")}</option><option value="PERSON">{t("admin.customer.kinds.PERSON")}</option></Select></Field>
      {!c && <Field label={t("admin.customer.stage")} name="stage"><Select name="stage" defaultValue="LEAD">{["LEAD", "CONTACTED", "QUALIFIED", "PROPOSAL", "CUSTOMER"].map((s) => <option key={s} value={s}>{t(`admin.stages.${s}`)}</option>)}</Select></Field>}
      <Field label={t("admin.customer.legalName")} name="legalName"><Input name="legalName" defaultValue={c?.legalName ?? ""} /></Field>
      <Field label={t("admin.customer.email")} name="email"><Input type="email" name="email" defaultValue={c?.email ?? ""} /></Field>
      <Field label={t("admin.customer.phone")} name="phone"><Input name="phone" defaultValue={c?.phone ?? ""} /></Field>
      <Field label={t("admin.customer.address")} name="address"><Input name="address" defaultValue={c?.address ?? ""} /></Field>
      <Field label={t("admin.customer.district")} name="district"><Input name="district" defaultValue={c?.district ?? ""} /></Field>
      <Field label={t("admin.customer.country")} name="country"><Input name="country" defaultValue={c?.country ?? "SR"} maxLength={2} /></Field>
      <Field label={t("admin.customer.kkf")} name="kkfNumber"><Input name="kkfNumber" defaultValue={c?.kkfNumber ?? ""} /></Field>
      <Field label={t("admin.customer.taxNumber")} name="taxNumber"><Input name="taxNumber" defaultValue={c?.taxNumber ?? ""} /></Field>
      <Field label={t("admin.customer.website")} name="website"><Input name="website" defaultValue={c?.website ?? ""} /></Field>
      <Field label={t("admin.customer.category")} name="category"><Input name="category" defaultValue={c?.category ?? ""} placeholder={t("admin.customer.categoryHint")} /></Field>
      <Field label={t("admin.customer.source")} name="source"><Input name="source" defaultValue={c?.source ?? ""} /></Field>
      <Field label={t("admin.customer.manager")} name="accountManagerId"><Select name="accountManagerId" defaultValue={c?.accountManagerId ?? ""}>{[<option key="" value="">—</option>, ...staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)]}</Select></Field>
      <Field label={t("admin.customer.currency")} name="preferredCurrency"><Input name="preferredCurrency" defaultValue={c?.preferredCurrency ?? "SRD"} maxLength={3} /></Field>
      <Field label={t("admin.customer.paymentTerm")} name="paymentTermDays"><Input type="number" min={0} name="paymentTermDays" defaultValue={c?.paymentTermDays ?? 14} /></Field>
      <Field label={t("common.notes")} name="notes" className="sm:col-span-2 lg:col-span-3"><Textarea name="notes" rows={2} defaultValue={c?.notes ?? ""} /></Field>
    </div>
  );
}

export async function staffOptions(organizationId: string) {
  const { systemDb } = await import("@/core/db/client");
  const m = await systemDb.organizationMembership.findMany({ where: { organizationId, status: "ACTIVE" }, include: { user: { select: { id: true, name: true } } } });
  return m.map((x) => x.user).sort((a, b) => a.name.localeCompare(b.name));
}
