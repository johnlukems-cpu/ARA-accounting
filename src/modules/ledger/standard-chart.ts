import type { AccountCategory, BalanceSide, ControlType, JournalType } from "@prisma/client";

/**
 * "ARA Standaard Suriname" — the base chart of accounts and journals created for a new administration.
 * Numbering follows the Dutch-Surinamese class system (0 fixed assets/equity/long-term, 1 current accounts,
 * 3 inventory, 4 expenses, 7 cost of sales, 8 revenue, 9 financial). Phase 4 adds industry templates on top.
 * Status: to be reviewed by a SUVA-registered accountant before launch (docs/SURINAME_MARKET.md §7).
 */
export interface ChartAccount {
  number: string;
  name: string;
  nameEn: string;
  category: AccountCategory;
  header?: boolean;
  parent?: string;
  normal?: BalanceSide;
  control?: ControlType;
  currency?: string;
}

export const BALANCE_SHEET_CATEGORIES: AccountCategory[] = ["ASSET", "LIABILITY", "EQUITY", "TAX", "SUSPENSE"];

export function defaultNormalBalance(category: AccountCategory): BalanceSide {
  return ["LIABILITY", "EQUITY", "REVENUE", "FINANCIAL_INCOME"].includes(category) ? "CREDIT" : "DEBIT";
}

export function isBalanceSheet(category: AccountCategory): boolean {
  return BALANCE_SHEET_CATEGORIES.includes(category);
}

const A = (number: string, name: string, nameEn: string, category: AccountCategory, extra: Partial<ChartAccount> = {}): ChartAccount => ({ number, name, nameEn, category, ...extra });

export const STANDARD_CHART: ChartAccount[] = [
  A("0000", "Vaste activa", "Fixed assets", "ASSET", { header: true }),
  A("0100", "Terreinen en gebouwen", "Land and buildings", "ASSET", { parent: "0000", control: "FIXED_ASSET" }),
  A("0105", "Cumulatieve afschrijving gebouwen", "Accumulated depreciation buildings", "ASSET", { parent: "0000", normal: "CREDIT", control: "FIXED_ASSET" }),
  A("0200", "Machines en installaties", "Machinery and installations", "ASSET", { parent: "0000", control: "FIXED_ASSET" }),
  A("0205", "Cumulatieve afschrijving machines", "Accumulated depreciation machinery", "ASSET", { parent: "0000", normal: "CREDIT", control: "FIXED_ASSET" }),
  A("0300", "Inventaris", "Furniture and equipment", "ASSET", { parent: "0000", control: "FIXED_ASSET" }),
  A("0305", "Cumulatieve afschrijving inventaris", "Accumulated depreciation equipment", "ASSET", { parent: "0000", normal: "CREDIT", control: "FIXED_ASSET" }),
  A("0400", "Vervoermiddelen", "Vehicles", "ASSET", { parent: "0000", control: "FIXED_ASSET" }),
  A("0405", "Cumulatieve afschrijving vervoermiddelen", "Accumulated depreciation vehicles", "ASSET", { parent: "0000", normal: "CREDIT", control: "FIXED_ASSET" }),
  A("0500", "Computers en software", "Computers and software", "ASSET", { parent: "0000", control: "FIXED_ASSET" }),
  A("0505", "Cumulatieve afschrijving computers", "Accumulated depreciation computers", "ASSET", { parent: "0000", normal: "CREDIT", control: "FIXED_ASSET" }),

  A("0600", "Eigen vermogen", "Equity", "EQUITY", { header: true }),
  A("0610", "Geplaatst kapitaal", "Share capital", "EQUITY", { parent: "0600" }),
  A("0620", "Overige reserves", "Other reserves", "EQUITY", { parent: "0600" }),
  A("0630", "Ingehouden winsten", "Retained earnings", "EQUITY", { parent: "0600", control: "RETAINED_EARNINGS" }),
  A("0650", "Privé-opnamen", "Owner's drawings", "EQUITY", { parent: "0600", normal: "DEBIT" }),

  A("0700", "Langlopende schulden", "Long-term liabilities", "LIABILITY", { header: true }),
  A("0710", "Leningen o/g", "Loans payable", "LIABILITY", { parent: "0700" }),
  A("0720", "Hypotheek", "Mortgage", "LIABILITY", { parent: "0700" }),
  A("0800", "Voorzieningen", "Provisions", "LIABILITY", { parent: "0700" }),

  A("1000", "Liquide middelen", "Cash and cash equivalents", "ASSET", { header: true }),
  A("1010", "Kas SRD", "Cash SRD", "ASSET", { parent: "1000", control: "CASH", currency: "SRD" }),
  A("1020", "Kas USD", "Cash USD", "ASSET", { parent: "1000", control: "CASH", currency: "USD" }),
  A("1030", "Kas EUR", "Cash EUR", "ASSET", { parent: "1000", control: "CASH", currency: "EUR" }),
  A("1090", "Kruisposten", "Transfers in transit", "ASSET", { parent: "1000" }),
  A("1100", "Banken", "Banks", "ASSET", { header: true }),

  A("1300", "Vorderingen", "Receivables", "ASSET", { header: true }),
  A("1310", "Debiteuren", "Accounts receivable", "ASSET", { parent: "1300", control: "RECEIVABLE" }),
  A("1320", "Vooruitbetaalde kosten", "Prepaid expenses", "ASSET", { parent: "1300" }),
  A("1330", "Nog te ontvangen bedragen", "Accrued income", "ASSET", { parent: "1300" }),
  A("1340", "Overige vorderingen", "Other receivables", "ASSET", { parent: "1300" }),
  A("1350", "Rekening-courant directie", "Current account directors", "ASSET", { parent: "1300", control: "CURRENT_ACCOUNT" }),

  A("1400", "Belastingen", "Taxes", "TAX", { header: true }),
  A("1410", "Te vorderen BTW", "BTW receivable (input)", "TAX", { parent: "1400", control: "TAX" }),
  A("1420", "Af te dragen BTW", "BTW payable (output)", "TAX", { parent: "1400", normal: "CREDIT", control: "TAX" }),
  A("1430", "BTW-afdrachtrekening", "BTW settlement", "TAX", { parent: "1400", normal: "CREDIT", control: "TAX" }),
  A("1440", "Te betalen inkomstenbelasting", "Income tax payable", "TAX", { parent: "1400", normal: "CREDIT", control: "TAX" }),
  A("1450", "Betaalde voorlopige aanslag", "Provisional tax paid", "TAX", { parent: "1400", control: "TAX" }),
  A("1460", "Te betalen loonbelasting en AOV", "Wage tax and AOV payable", "TAX", { parent: "1400", normal: "CREDIT", control: "TAX" }),
  A("1470", "Te betalen dividendbelasting", "Dividend tax payable", "TAX", { parent: "1400", normal: "CREDIT", control: "TAX" }),

  A("1600", "Kortlopende schulden", "Current liabilities", "LIABILITY", { header: true }),
  A("1610", "Crediteuren", "Accounts payable", "LIABILITY", { parent: "1600", control: "PAYABLE" }),
  A("1620", "Nog te betalen kosten", "Accrued expenses", "LIABILITY", { parent: "1600" }),
  A("1630", "Vooruit ontvangen bedragen", "Deferred income", "LIABILITY", { parent: "1600" }),
  A("1640", "Te betalen salarissen", "Salaries payable", "LIABILITY", { parent: "1600" }),
  A("1650", "Rekening-courant aandeelhouders", "Current account shareholders", "LIABILITY", { parent: "1600", control: "CURRENT_ACCOUNT" }),
  A("1660", "Te betalen dividend", "Dividend payable", "LIABILITY", { parent: "1600" }),
  A("1690", "Overige schulden", "Other liabilities", "LIABILITY", { parent: "1600" }),

  A("1900", "Tussenrekeningen", "Suspense accounts", "SUSPENSE", { header: true }),
  A("1910", "Vraagposten", "Suspense", "SUSPENSE", { parent: "1900", control: "SUSPENSE" }),
  A("1920", "Tussenrekening salarissen", "Payroll clearing", "SUSPENSE", { parent: "1900" }),

  A("3000", "Voorraden", "Inventory", "ASSET", { header: true }),
  A("3010", "Voorraad handelsgoederen", "Merchandise inventory", "ASSET", { parent: "3000" }),

  A("4000", "Bedrijfskosten", "Operating expenses", "OPERATING_EXPENSE", { header: true }),
  A("4010", "Salarissen en lonen", "Salaries and wages", "OPERATING_EXPENSE", { parent: "4000" }),
  A("4020", "Sociale lasten en pensioen", "Social charges and pension", "OPERATING_EXPENSE", { parent: "4000" }),
  A("4100", "Huur", "Rent", "OPERATING_EXPENSE", { parent: "4000" }),
  A("4110", "Elektriciteit en water", "Electricity and water", "OPERATING_EXPENSE", { parent: "4000" }),
  A("4120", "Telefoon en internet", "Telephone and internet", "OPERATING_EXPENSE", { parent: "4000" }),
  A("4200", "Kantoorkosten", "Office expenses", "OPERATING_EXPENSE", { parent: "4000" }),
  A("4300", "Autokosten", "Vehicle expenses", "OPERATING_EXPENSE", { parent: "4000" }),
  A("4310", "Brandstof", "Fuel", "OPERATING_EXPENSE", { parent: "4000" }),
  A("4400", "Verkoop- en reclamekosten", "Selling and advertising", "OPERATING_EXPENSE", { parent: "4000" }),
  A("4500", "Onderhoud en reparaties", "Maintenance and repairs", "OPERATING_EXPENSE", { parent: "4000" }),
  A("4600", "Verzekeringen", "Insurance", "OPERATING_EXPENSE", { parent: "4000" }),
  A("4700", "Accountants- en advieskosten", "Accounting and advisory fees", "OPERATING_EXPENSE", { parent: "4000" }),
  A("4800", "Afschrijvingen", "Depreciation", "OPERATING_EXPENSE", { parent: "4000" }),
  A("4900", "Overige bedrijfskosten", "Other operating expenses", "OPERATING_EXPENSE", { parent: "4000" }),
  A("4950", "Belastingen naar de winst", "Income tax expense", "OPERATING_EXPENSE", { parent: "4000" }),

  A("7000", "Kostprijs van de omzet", "Cost of sales", "COST_OF_SALES", { header: true }),
  A("7010", "Inkoopwaarde van de omzet", "Cost of goods sold", "COST_OF_SALES", { parent: "7000" }),
  A("7020", "Invoerrechten en vrachtkosten", "Import duties and freight", "COST_OF_SALES", { parent: "7000" }),

  A("8000", "Opbrengsten", "Revenue", "REVENUE", { header: true }),
  A("8010", "Omzet BTW 10%", "Revenue BTW 10%", "REVENUE", { parent: "8000" }),
  A("8020", "Omzet BTW 25%", "Revenue BTW 25%", "REVENUE", { parent: "8000" }),
  A("8030", "Omzet 0% en export", "Revenue 0% and export", "REVENUE", { parent: "8000" }),
  A("8040", "Omzet vrijgesteld", "Exempt revenue", "REVENUE", { parent: "8000" }),
  A("8090", "Overige opbrengsten", "Other income", "REVENUE", { parent: "8000" }),

  A("9000", "Financiële baten en lasten", "Financial income and expenses", "FINANCIAL_EXPENSE", { header: true }),
  A("9010", "Rentebaten", "Interest income", "FINANCIAL_INCOME", { parent: "9000" }),
  A("9020", "Rentelasten en bankkosten", "Interest and bank charges", "FINANCIAL_EXPENSE", { parent: "9000" }),
  A("9030", "Gerealiseerde koersverschillen", "Realised exchange differences", "FINANCIAL_EXPENSE", { parent: "9000", control: "FX_RESULT" }),
  A("9040", "Ongerealiseerde koersverschillen", "Unrealised exchange differences", "FINANCIAL_EXPENSE", { parent: "9000", control: "FX_RESULT" }),
  A("9050", "Afrondingsverschillen", "Rounding differences", "FINANCIAL_EXPENSE", { parent: "9000", control: "ROUNDING" }),
];

export const STANDARD_JOURNALS: Array<{ code: string; name: string; type: JournalType; requiresApproval?: boolean }> = [
  { code: "MEM", name: "Memoriaal", type: "GENERAL" },
  { code: "OPN", name: "Openingsbalans", type: "OPENING", requiresApproval: true },
  { code: "INK", name: "Inkoopboek", type: "PURCHASE" },
  { code: "VRK", name: "Verkoopboek", type: "SALES" },
  { code: "KAS", name: "Kasboek", type: "CASH" },
  { code: "BNK", name: "Bankboek", type: "BANK" },
  { code: "VA", name: "Vaste activa", type: "FIXED_ASSET" },
  { code: "AFS", name: "Afschrijvingen", type: "DEPRECIATION", requiresApproval: true },
  { code: "BTW", name: "Belastingen", type: "TAX", requiresApproval: true },
  { code: "KV", name: "Koersverschillen en herwaardering", type: "FX_ADJUSTMENT", requiresApproval: true },
  { code: "AFSL", name: "Jaarafsluiting", type: "CLOSING", requiresApproval: true },
];
