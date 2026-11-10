import type { Tx } from "@/core/db/client";

/** Data for the entry editor: postable accounts, active journals and dimensions of one administration. */
export async function editorData(tx: Tx, administrationId: string) {
  const [accounts, journals, dimensions] = await Promise.all([
    tx.account.findMany({ where: { administrationId, type: "DETAIL", status: "ACTIVE" }, select: { id: true, number: true, name: true, currency: true }, orderBy: { number: "asc" } }),
    tx.journal.findMany({ where: { administrationId, status: "ACTIVE" }, select: { id: true, code: true, name: true, type: true, requiresApproval: true }, orderBy: { code: "asc" } }),
    tx.dimensionValue.findMany({ where: { administrationId, status: "ACTIVE" }, select: { id: true, code: true, name: true, type: true }, orderBy: [{ type: "asc" }, { code: "asc" }] }),
  ]);
  return { accounts, journals, dimensions };
}

export const EDITOR_CURRENCIES = ["SRD", "USD", "EUR", "GBP"];
