import type { Tx } from "@/core/db/client";

/** Accounts and BTW codes offered as party defaults. */
export async function partyFormData(tx: Tx, administrationId: string) {
  const [revenue, expense, taxCodes] = await Promise.all([
    tx.account.findMany({ where: { administrationId, type: "DETAIL", status: "ACTIVE", category: { in: ["REVENUE", "FINANCIAL_INCOME"] } }, select: { id: true, number: true, name: true }, orderBy: { number: "asc" } }),
    tx.account.findMany({ where: { administrationId, type: "DETAIL", status: "ACTIVE", controlType: "NONE", category: { in: ["OPERATING_EXPENSE", "COST_OF_SALES", "ASSET", "FINANCIAL_EXPENSE"] } }, select: { id: true, number: true, name: true }, orderBy: { number: "asc" } }),
    tx.taxCode.findMany({ where: { administrationId, status: "ACTIVE" }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
  ]);
  return { revenue, expense, taxCodes };
}
