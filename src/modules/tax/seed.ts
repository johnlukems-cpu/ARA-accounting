import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Surinamese tax rule versions (docs/SURINAME_MARKET.md §5). Nothing is VERIFIED yet: every return that uses these
 * rules shows a warning and needs an explicit acknowledgement on approval (ACCOUNTING_RULES T2).
 * Existing versions are never changed by the seed (they may already be used by returns).
 */
export const TAX_RULES: { taxType: "BTW" | "IB_RECHTSPERSONEN" | "DIVIDENDBELASTING"; effectiveFrom: string; parameters: Record<string, unknown>; legalStatus: "SOURCE_FOUND" | "PENDING_VERIFICATION"; legalSource: string; notes: string }[] = [
  {
    taxType: "BTW", effectiveFrom: "2023-01-01",
    parameters: { period: "MONTH", rates: { general: 10, annex3: 25, zero: 0 }, filingDayOfFollowingMonth: 16 },
    legalStatus: "SOURCE_FOUND", legalSource: "Wet BTW 2022, S.B. 2022 no. 121; wijziging S.B. 2022 no. 148",
    notes: "Tarieven gevonden in de wettekst. Aangiftetermijn (dag 16 van de volgende maand) is een plaatshouder: PENDING_VERIFICATION.",
  },
  {
    taxType: "IB_RECHTSPERSONEN", effectiveFrom: "2020-01-01",
    parameters: { rate: 36 },
    legalStatus: "SOURCE_FOUND", legalSource: "EITI Suriname, belastingoverzicht (secundaire overheidsbron); Inkomstenbelasting 1922",
    notes: "Tarief 36% uit secundaire bron; ingangsdatum, verliesverrekening en termijnen nog te verifiëren.",
  },
  {
    taxType: "DIVIDENDBELASTING", effectiveFrom: "2020-01-01",
    parameters: { rate: 25 },
    legalStatus: "SOURCE_FOUND", legalSource: "EITI Suriname, belastingoverzicht",
    notes: "Inhoudingspercentage 25% uit secundaire bron; ingangsdatum en vrijstellingen nog te verifiëren.",
  },
];

export async function seedTaxRules(db: PrismaClient) {
  for (const r of TAX_RULES) {
    const effectiveFrom = new Date(`${r.effectiveFrom}T00:00:00Z`);
    const existing = await db.taxRuleVersion.findUnique({ where: { taxType_effectiveFrom: { taxType: r.taxType, effectiveFrom } } });
    if (!existing) await db.taxRuleVersion.create({ data: { taxType: r.taxType, effectiveFrom, parameters: r.parameters as Prisma.InputJsonValue, legalStatus: r.legalStatus, legalSource: r.legalSource, notes: r.notes } });
  }
}
