import type { Tx } from "@/core/db/client";

/**
 * Surinamese BTW codes created for every administration (docs/SURINAME_MARKET.md §5).
 * Rates are data with a legal status; nothing here is a claim of legal correctness.
 */
export const STANDARD_TAX_CODES = [
  { code: "BTW10", name: "BTW algemeen tarief 10%", nameEn: "BTW general rate 10%", kind: "STANDARD", direction: "BOTH", rate: "10", legalStatus: "SOURCE_FOUND", legalSource: "Wet BTW 2022, S.B. 2022 no. 121", reportBox: "10" },
  { code: "BTW25", name: "BTW tarief 25% (bijlage 3)", nameEn: "BTW 25% (annex 3)", kind: "LUXURY", direction: "BOTH", rate: "25", legalStatus: "SOURCE_FOUND", legalSource: "S.B. 2022 no. 148, bijlage 3", reportBox: "25" },
  { code: "BTW0", name: "BTW nultarief (bijlage 1)", nameEn: "BTW zero rate (annex 1)", kind: "ZERO", direction: "BOTH", rate: "0", legalStatus: "SOURCE_FOUND", legalSource: "Wet BTW 2022, bijlage 1", reportBox: "0" },
  { code: "VRIJ", name: "Vrijgesteld van BTW", nameEn: "Exempt from BTW", kind: "EXEMPT", direction: "BOTH", rate: "0", legalStatus: "PENDING_VERIFICATION", legalSource: null, reportBox: "VRIJ" },
  { code: "INV10", name: "BTW bij invoer 10%", nameEn: "Import BTW 10%", kind: "IMPORT", direction: "PURCHASE", rate: "10", legalStatus: "PENDING_VERIFICATION", legalSource: null, reportBox: "INV" },
  { code: "INV25", name: "BTW bij invoer 25%", nameEn: "Import BTW 25%", kind: "IMPORT", direction: "PURCHASE", rate: "25", legalStatus: "PENDING_VERIFICATION", legalSource: null, reportBox: "INV" },
  { code: "GEEN", name: "Geen BTW (niet BTW-plichtig)", nameEn: "No BTW (not registered)", kind: "NONE", direction: "BOTH", rate: "0", legalStatus: "PENDING_VERIFICATION", legalSource: null, reportBox: null },
] as const;

/** Installs BTW codes and the SRD cash account for a new administration (runs inside its creation transaction). */
export async function installOperations(tx: Tx, organizationId: string, administrationId: string) {
  const acc = async (number: string) => (await tx.account.findFirst({ where: { administrationId, number } }))?.id ?? null;
  const output = await acc("1420");
  const input = await acc("1410");
  await tx.taxCode.createMany({
    data: STANDARD_TAX_CODES.map((c) => ({
      organizationId, administrationId, code: c.code, name: c.name, nameEn: c.nameEn, kind: c.kind, direction: c.direction, rate: c.rate,
      outputAccountId: c.direction === "PURCHASE" ? null : output, inputAccountId: input, legalStatus: c.legalStatus, legalSource: c.legalSource, reportBox: c.reportBox,
    })),
  });
  const cash = await acc("1010");
  const kas = await tx.journal.findFirst({ where: { administrationId, code: "KAS" } });
  if (cash && kas) {
    await tx.financialAccount.create({ data: { organizationId, administrationId, kind: "CASH", name: "Kas SRD", currency: "SRD", ledgerAccountId: cash, journalId: kas.id } });
  }
}
