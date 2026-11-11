import { getTranslations } from "next-intl/server";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { DISTRICTS, LEGAL_FORMS } from "@/modules/organization/schemas";
import type { TemplateChoice } from "@/modules/industry/queries";

type CompanyDefaults = Partial<{
  name: string; legalName: string | null; legalForm: string; kkfNumber: string | null; taxNumber: string | null;
  btwNumber: string | null; isBtwRegistered: boolean; address: string | null; district: string | null; email: string | null; phone: string | null;
}>;

export async function DistrictSelect({ name = "district", defaultValue }: { name?: string; defaultValue?: string | null }) {
  const t = await getTranslations();
  return (
    <Select name={name} defaultValue={defaultValue ?? ""}>
      <option value="">—</option>
      {DISTRICTS.map((d) => (
        <option key={d} value={d}>{t(`districts.${d}`)}</option>
      ))}
    </Select>
  );
}

export async function CompanyFields({ defaults = {} }: { defaults?: CompanyDefaults }) {
  const t = await getTranslations();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("company.name")} name="name">
        <Input name="name" defaultValue={defaults.name} required />
      </Field>
      <Field label={t("company.legalName")} name="legalName">
        <Input name="legalName" defaultValue={defaults.legalName ?? ""} />
      </Field>
      <Field label={t("company.legalForm")} name="legalForm">
        <Select name="legalForm" defaultValue={defaults.legalForm ?? "NV"}>
          {LEGAL_FORMS.map((f) => (
            <option key={f} value={f}>{t(`legalForms.${f}`)}</option>
          ))}
        </Select>
      </Field>
      <Field label={t("company.kkfNumber")} name="kkfNumber">
        <Input name="kkfNumber" defaultValue={defaults.kkfNumber ?? ""} />
      </Field>
      <Field label={t("company.taxNumber")} name="taxNumber">
        <Input name="taxNumber" defaultValue={defaults.taxNumber ?? ""} />
      </Field>
      <Field label={t("company.btwNumber")} name="btwNumber">
        <Input name="btwNumber" defaultValue={defaults.btwNumber ?? ""} />
      </Field>
      <Field label={t("company.address")} name="address">
        <Input name="address" defaultValue={defaults.address ?? ""} />
      </Field>
      <Field label={t("company.district")} name="district">
        <DistrictSelect defaultValue={defaults.district} />
      </Field>
      <Field label={t("company.email")} name="email">
        <Input name="email" type="email" defaultValue={defaults.email ?? ""} />
      </Field>
      <Field label={t("company.phone")} name="phone">
        <Input name="phone" defaultValue={defaults.phone ?? ""} />
      </Field>
      <div className="sm:col-span-2">
        <Checkbox name="isBtwRegistered" label={t("company.isBtwRegistered")} defaultChecked={defaults.isBtwRegistered ?? false} />
      </div>
    </div>
  );
}

export async function AdministrationFields({ companyId, templates = [] }: { companyId: string; templates?: TemplateChoice[] }) {
  const t = await getTranslations();
  const year = new Date().getUTCFullYear();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="companyId" value={companyId} />
      <Field label={t("administration.name")} name="name">
        <Input name="name" defaultValue={t("administration.defaultName")} required />
      </Field>
      <Field label={t("administration.code")} name="code" hint={t("administration.codeHint")}>
        <Input name="code" defaultValue="HOOFD" required />
      </Field>
      <Field label={t("administration.baseCurrency")} name="baseCurrency" hint={t("administration.baseCurrencyHint")}>
        <Select name="baseCurrency" defaultValue="SRD">
          {["SRD", "USD", "EUR"].map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
      </Field>
      <Field label={t("administration.startYear")} name="startYear">
        <Input name="startYear" type="number" min={2000} max={2100} defaultValue={year} required />
      </Field>
      <Field label={t("administration.startMonth")} name="startMonth" hint={t("administration.startMonthHint")}>
        <Select name="startMonth" defaultValue="1">
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i + 1} value={i + 1}>{t(`months.m${i + 1}`)}</option>
          ))}
        </Select>
      </Field>
      {templates.length > 0 && (
        <Field label={t("industry.wizardLabel")} name="templateId" hint={t("industry.wizardHint")} className="sm:col-span-2">
          <Select name="templateId" defaultValue={templates[0]?.id}>
            <optgroup label={t("industry.platform")}>
              {templates.filter((tpl) => !tpl.own).map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
            </optgroup>
            {templates.some((tpl) => tpl.own) && (
              <optgroup label={t("industry.own")}>
                {templates.filter((tpl) => tpl.own).map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
              </optgroup>
            )}
          </Select>
        </Field>
      )}
    </div>
  );
}
