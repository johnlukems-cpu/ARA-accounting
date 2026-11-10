import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { createAccountAction, updateAccountAction } from "@/actions/ledger";
import { ACCOUNT_CATEGORIES, CONTROL_TYPES } from "@/modules/ledger/schemas";
import { ActionForm, Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { Badge, Card, PageHeader, Table, Td, TextLink } from "@/components/ui/misc";

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const t = await getTranslations();
  const ctx = await requireApp("ledger.view", { needCompany: true });
  if (!ctx.administration) redirect("/onboarding");
  const admin = ctx.administration;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 60);
  const showArchived = sp.status === "all";
  const accounts = await withTenant(ctx.access, (tx) =>
    tx.account.findMany({
      where: {
        administrationId: admin.id,
        ...(showArchived ? {} : { status: "ACTIVE" }),
        ...(q ? { OR: [{ number: { startsWith: q } }, { name: { contains: q, mode: "insensitive" } }] } : {}),
      },
      orderBy: { number: "asc" },
    }),
  );
  const headers = accounts.filter((a) => a.type === "HEADER");
  const mayEdit = can(ctx.access, "administrations.edit", admin.companyId);

  return (
    <>
      <PageHeader title={t("ledger.accountsTitle")} description={`${admin.code} · ${admin.name}`} />
      <Card>
        <form className="mb-4 flex flex-wrap gap-2" role="search">
          <input name="q" defaultValue={q} placeholder={t("ledger.searchAccounts")} aria-label={t("ledger.searchAccounts")} className="h-9 flex-1 rounded-lg border border-border px-3 text-sm" />
          <select name="status" defaultValue={showArchived ? "all" : ""} aria-label={t("common.status")} className="h-9 rounded-lg border border-border px-2 text-sm">
            <option value="">{t("ledger.activeOnly")}</option>
            <option value="all">{t("ledger.includeArchived")}</option>
          </select>
          <button className="h-9 rounded-lg border border-border px-3 text-sm">{t("common.filter")}</button>
        </form>
        <Table head={[t("ledger.number"), t("ledger.accountName"), t("ledger.category"), t("ledger.normalBalance"), t("ledger.controlType"), t("common.status"), ""]}>
          {accounts.map((a) => (
            <tr key={a.id} className={a.type === "HEADER" ? "bg-muted/60 font-semibold" : ""}>
              <Td className="amount">{a.number}</Td>
              <Td className={a.parentId ? "pl-9" : ""}>
                {a.type === "DETAIL" ? <TextLink href={`/app/ledger/general-ledger?account=${a.id}`}>{a.name}</TextLink> : a.name}
                {a.currency && <span className="ml-2 text-xs text-muted-foreground">{a.currency}</span>}
              </Td>
              <Td className="text-xs">{t(`ledger.categories.${a.category}`)}</Td>
              <Td className="text-xs">{a.type === "DETAIL" ? t(`ledger.${a.normalBalance === "DEBIT" ? "debit" : "credit"}`) : ""}</Td>
              <Td className="text-xs">{a.controlType !== "NONE" ? t(`ledger.controlTypes.${a.controlType}`) : ""}</Td>
              <Td>{a.status === "ARCHIVED" && <Badge>{t("common.statuses.ARCHIVED")}</Badge>}</Td>
              <Td>
                {mayEdit && (
                  <details>
                    <summary className="cursor-pointer text-xs text-accent">{t("common.edit")}</summary>
                    <ActionForm action={updateAccountAction} className="mt-2 w-72 space-y-2">
                      <input type="hidden" name="id" value={a.id} />
                      <Field label={t("ledger.accountName")} name="name"><Input name="name" defaultValue={a.name} required /></Field>
                      <Field label={t("ledger.parent")} name="parentId">
                        <Select name="parentId" defaultValue={a.parentId ?? ""}>
                          <option value="">—</option>
                          {headers.filter((h) => h.id !== a.id).map((h) => <option key={h.id} value={h.id}>{h.number} · {h.name}</option>)}
                        </Select>
                      </Field>
                      <Field label={t("common.status")} name="status">
                        <Select name="status" defaultValue={a.status}>
                          <option value="ACTIVE">{t("common.statuses.ACTIVE")}</option>
                          <option value="ARCHIVED">{t("common.statuses.ARCHIVED")}</option>
                        </Select>
                      </Field>
                      <SubmitButton variant="secondary">{t("common.save")}</SubmitButton>
                    </ActionForm>
                  </details>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      {mayEdit && (
        <Card title={t("ledger.newAccount")} className="mt-6">
          <ActionForm action={createAccountAction} resetOnSuccess>
            <input type="hidden" name="administrationId" value={admin.id} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("ledger.number")} name="number"><Input name="number" required /></Field>
              <Field label={t("ledger.accountName")} name="name"><Input name="name" required /></Field>
              <Field label={t("ledger.category")} name="category">
                <Select name="category" defaultValue="OPERATING_EXPENSE">
                  {ACCOUNT_CATEGORIES.map((c) => <option key={c} value={c}>{t(`ledger.categories.${c}`)}</option>)}
                </Select>
              </Field>
              <Field label={t("ledger.parent")} name="parentId">
                <Select name="parentId" defaultValue="">
                  <option value="">—</option>
                  {headers.map((h) => <option key={h.id} value={h.id}>{h.number} · {h.name}</option>)}
                </Select>
              </Field>
              <Field label={t("ledger.accountType")} name="type">
                <Select name="type" defaultValue="DETAIL">
                  <option value="DETAIL">{t("ledger.typeDetail")}</option>
                  <option value="HEADER">{t("ledger.typeHeader")}</option>
                </Select>
              </Field>
              <Field label={t("ledger.controlType")} name="controlType">
                <Select name="controlType" defaultValue="NONE">
                  {CONTROL_TYPES.map((c) => <option key={c} value={c}>{c === "NONE" ? "—" : t(`ledger.controlTypes.${c}`)}</option>)}
                </Select>
              </Field>
              <Field label={t("ledger.restrictCurrency")} name="currency" hint={t("ledger.restrictCurrencyHint")}>
                <Select name="currency" defaultValue="">
                  <option value="">—</option>
                  {["SRD", "USD", "EUR", "GBP"].map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
            </div>
            <SubmitButton>{t("ledger.createAccount")}</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
