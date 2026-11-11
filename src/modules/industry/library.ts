import type { TemplateAccount, TemplateContent } from "./content";

/**
 * Platform industry templates for the Surinamese economy (docs/SURINAME_MARKET.md §7).
 * Each one adds accounts, journals, asset categories, dimensions and KPI choices to "ARA Standaard Suriname".
 * Status: proposals to be reviewed by a SUVA-registered accountant before launch. Changing a definition here
 * publishes a new version on the next seed; administrations are never changed without an approved upgrade.
 */
export interface PlatformTemplate {
  code: string;
  name: string;
  nameEn: string;
  description: string;
  descriptionEn: string;
  proposed?: boolean;
  content: TemplateContent;
}

const acc = (number: string, name: string, nameEn: string, category: TemplateAccount["category"], parent: string, extra: Partial<TemplateAccount> = {}): TemplateAccount => ({ ref: `a${number}`, number, name, nameEn, category, parent, ...extra });
const fixed = (number: string, name: string, nameEn: string) => [
  acc(number, name, nameEn, "ASSET", "0000", { control: "FIXED_ASSET" }),
  acc(String(Number(number) + 5).padStart(4, "0"), `Cumulatieve afschrijving ${name.toLowerCase()}`, `Accumulated depreciation ${nameEn.toLowerCase()}`, "ASSET", "0000", { control: "FIXED_ASSET", normal: "CREDIT" }),
];
const content = (c: Partial<TemplateContent>): TemplateContent => ({ accounts: [], journals: [], assetCategories: [], dimensions: [], kpis: [], ...c });
const BASE_KPIS = ["grossMargin", "netMargin", "currentRatio", "solvency"];

export const PLATFORM_TEMPLATES: PlatformTemplate[] = [
  {
    code: "GENERAL", name: "Algemeen (ARA Standaard Suriname)", nameEn: "General (ARA Standard Suriname)",
    description: "Het standaard Surinaamse rekeningschema zonder branche-aanvullingen.", descriptionEn: "The standard Surinamese chart without industry additions.",
    content: content({ kpis: [...BASE_KPIS, "dso", "dpo"] }),
  },
  {
    code: "TRADE", name: "Algemene handel", nameEn: "General trading",
    description: "Import en handel: goederen onderweg, inkoopkortingen, voorraadverschillen, vracht.", descriptionEn: "Import and trade: goods in transit, purchase discounts, stock differences, freight.",
    content: content({
      accounts: [
        acc("3020", "Goederen onderweg", "Goods in transit", "ASSET", "3000"),
        acc("7030", "Ontvangen inkoopkortingen", "Purchase discounts received", "COST_OF_SALES", "7000", { normal: "CREDIT" }),
        acc("7040", "Voorraadverschillen", "Inventory differences", "COST_OF_SALES", "7000"),
        acc("8110", "Omzet handelsgoederen", "Revenue merchandise", "REVENUE", "8000"),
        acc("4410", "Vrachtkosten verkoop", "Outbound freight", "OPERATING_EXPENSE", "4000"),
      ],
      kpis: [...BASE_KPIS, "inventoryTurnover", "dso", "dpo"],
    }),
  },
  {
    code: "WHOLESALE", name: "Groothandel", nameEn: "Wholesale",
    description: "Groothandel met import (douane, entrepot) en export in USD.", descriptionEn: "Wholesale with imports (customs, bonded warehouse) and USD exports.",
    content: content({
      accounts: [
        acc("3020", "Goederen onderweg", "Goods in transit", "ASSET", "3000"),
        acc("3030", "Voorraad in entrepot", "Inventory in bonded warehouse", "ASSET", "3000"),
        acc("7030", "Ontvangen inkoopkortingen", "Purchase discounts received", "COST_OF_SALES", "7000", { normal: "CREDIT" }),
        acc("7050", "Douaneafhandeling en inklaring", "Customs clearance", "COST_OF_SALES", "7000"),
        acc("8110", "Omzet groothandel", "Wholesale revenue", "REVENUE", "8000"),
        acc("8120", "Omzet export", "Export revenue", "REVENUE", "8000"),
      ],
      kpis: [...BASE_KPIS, "inventoryTurnover", "dso", "dpo"],
    }),
  },
  {
    code: "RETAIL", name: "Detailhandel", nameEn: "Retail",
    description: "Winkels met kassaomzet, pinkosten, derving en kasverschillen.", descriptionEn: "Shops with till revenue, card fees, shrinkage and cash differences.",
    content: content({
      accounts: [
        acc("3040", "Winkelvoorraad", "Shop inventory", "ASSET", "3000"),
        acc("7040", "Voorraadverschillen en derving", "Inventory differences and shrinkage", "COST_OF_SALES", "7000"),
        acc("8130", "Kassaomzet", "Till revenue", "REVENUE", "8000"),
        acc("4430", "Kosten pinbetalingen", "Card payment fees", "OPERATING_EXPENSE", "4000"),
        acc("1930", "Kasverschillen", "Cash differences", "SUSPENSE", "1900"),
      ],
      dimensions: [{ type: "COST_CENTER", code: "WINKEL1", name: "Winkel 1" }],
      kpis: [...BASE_KPIS, "inventoryTurnover", "personnelCostRatio"],
    }),
  },
  {
    code: "CONSTRUCTION", name: "Bouw en aannemerij", nameEn: "Construction",
    description: "Projecten, termijnfacturering, retenties en bouwmaterieel.", descriptionEn: "Projects, progress billing, retentions and construction equipment.",
    content: content({
      accounts: [
        ...fixed("0210", "Bouwmaterieel", "Construction equipment"),
        acc("3110", "Onderhanden projecten", "Work in progress (projects)", "ASSET", "3000"),
        acc("1345", "Retentievorderingen", "Retentions receivable", "ASSET", "1300"),
        acc("1625", "Vooruitgefactureerde termijnen", "Progress billings in advance", "LIABILITY", "1600"),
        acc("7100", "Materialen projecten", "Project materials", "COST_OF_SALES", "7000"),
        acc("7110", "Onderaanneming", "Subcontracting", "COST_OF_SALES", "7000"),
        acc("7120", "Inhuur materieel", "Equipment hire", "COST_OF_SALES", "7000"),
        acc("8140", "Opbrengst aanneming", "Contract revenue", "REVENUE", "8000"),
      ],
      assetCategories: [{ code: "BOUWM", name: "Bouwmaterieel", asset: "0210", accumulated: "0215", lifeMonths: 84 }],
      dimensions: [{ type: "PROJECT", code: "ALG", name: "Algemeen (geen project)" }],
      kpis: [...BASE_KPIS, "dso"],
    }),
  },
  {
    code: "INSTALLATION", name: "Technische installatiebedrijven", nameEn: "Technical installations",
    description: "Installatie- en onderhoudswerk met projecten en onderhoudscontracten.", descriptionEn: "Installation and maintenance work with projects and service contracts.",
    content: content({
      accounts: [
        acc("3110", "Onderhanden werk", "Work in progress", "ASSET", "3000"),
        acc("1625", "Vooruitgefactureerde termijnen", "Progress billings in advance", "LIABILITY", "1600"),
        acc("7100", "Materialen", "Materials", "COST_OF_SALES", "7000"),
        acc("7110", "Onderaanneming", "Subcontracting", "COST_OF_SALES", "7000"),
        acc("8150", "Opbrengst installatiewerk", "Installation revenue", "REVENUE", "8000"),
        acc("8160", "Opbrengst onderhoudscontracten", "Service contract revenue", "REVENUE", "8000"),
      ],
      dimensions: [{ type: "PROJECT", code: "ALG", name: "Algemeen (geen project)" }],
      kpis: [...BASE_KPIS, "dso"],
    }),
  },
  {
    code: "HOSPITALITY", name: "Horeca", nameEn: "Hospitality",
    description: "Hotels, restaurants en bars: logies, food & beverage, fooien, aanbetalingen.", descriptionEn: "Hotels, restaurants and bars: rooms, food & beverage, tips, deposits.",
    content: content({
      accounts: [
        acc("3050", "Voorraad dranken en levensmiddelen", "Food and beverage inventory", "ASSET", "3000"),
        acc("7200", "Inkoop dranken en levensmiddelen", "Food and beverage purchases", "COST_OF_SALES", "7000"),
        acc("8200", "Omzet logies", "Room revenue", "REVENUE", "8000"),
        acc("8210", "Omzet food & beverage", "Food and beverage revenue", "REVENUE", "8000"),
        acc("1635", "Ontvangen fooien (te verdelen)", "Tips received (to distribute)", "LIABILITY", "1600"),
        acc("1636", "Ontvangen aanbetalingen reserveringen", "Reservation deposits received", "LIABILITY", "1600"),
        acc("4030", "Seizoens- en uitzendkrachten", "Seasonal and temporary staff", "OPERATING_EXPENSE", "4000"),
      ],
      kpis: [...BASE_KPIS, "personnelCostRatio"],
    }),
  },
  {
    code: "TOURISM", name: "Toerisme", nameEn: "Tourism",
    description: "Touroperators en lodges in het binnenland; gasten betalen vaak in USD of EUR.", descriptionEn: "Tour operators and interior lodges; guests often pay in USD or EUR.",
    content: content({
      accounts: [
        acc("8220", "Omzet tours en excursies", "Tours and excursions revenue", "REVENUE", "8000"),
        acc("8230", "Omzet lodges binnenland", "Interior lodge revenue", "REVENUE", "8000"),
        acc("7210", "Inkoop excursies en transport", "Excursion and transport purchases", "COST_OF_SALES", "7000"),
        acc("7220", "Commissies reisagenten", "Travel agent commissions", "COST_OF_SALES", "7000"),
        acc("1636", "Ontvangen aanbetalingen reserveringen", "Reservation deposits received", "LIABILITY", "1600"),
        acc("4320", "Boot- en vliegkosten binnenland", "Interior boat and flight costs", "OPERATING_EXPENSE", "4000"),
      ],
      dimensions: [{ type: "COST_CENTER", code: "LODGE1", name: "Lodge 1" }],
      kpis: [...BASE_KPIS, "revenueGrowth"],
    }),
  },
  {
    code: "TRANSPORT", name: "Transport en logistiek", nameEn: "Transport and logistics",
    description: "Weg-, rivier- en boottransport: vaartuigen, brandstof, tol en havengeld.", descriptionEn: "Road, river and boat transport: vessels, fuel, tolls and port fees.",
    content: content({
      accounts: [
        ...fixed("0410", "Boten en vaartuigen", "Boats and vessels"),
        acc("4330", "Brandstof wagenpark en boten", "Fleet and boat fuel", "OPERATING_EXPENSE", "4000"),
        acc("4340", "Onderhoud wagenpark", "Fleet maintenance", "OPERATING_EXPENSE", "4000"),
        acc("4350", "Tol, havengeld en vergunningen", "Tolls, port fees and permits", "OPERATING_EXPENSE", "4000"),
        acc("8300", "Opbrengst wegtransport", "Road transport revenue", "REVENUE", "8000"),
        acc("8310", "Opbrengst rivier- en boottransport", "River and boat transport revenue", "REVENUE", "8000"),
      ],
      assetCategories: [{ code: "BOOT", name: "Boten en vaartuigen", asset: "0410", accumulated: "0415", lifeMonths: 120 }],
      kpis: [...BASE_KPIS, "dso"],
    }),
  },
  {
    code: "REALESTATE", name: "Vastgoed", nameEn: "Real estate",
    description: "Verhuur van onroerend goed: huur, servicekosten, waarborgsommen, huurwaardebelasting.", descriptionEn: "Property rental: rent, service charges, deposits, rental value tax.",
    content: content({
      accounts: [
        ...fixed("0110", "Verhuurd vastgoed", "Rental property"),
        acc("1637", "Ontvangen waarborgsommen", "Security deposits received", "LIABILITY", "1600"),
        acc("8400", "Huuropbrengsten", "Rental income", "REVENUE", "8000"),
        acc("8410", "Doorberekende servicekosten", "Service charges recharged", "REVENUE", "8000"),
        acc("4130", "Huurwaardebelasting", "Rental value tax", "OPERATING_EXPENSE", "4000"),
        acc("4140", "Beheer en onderhoud vastgoed", "Property management and maintenance", "OPERATING_EXPENSE", "4000"),
      ],
      assetCategories: [{ code: "VASTG", name: "Verhuurd vastgoed", asset: "0110", accumulated: "0115", lifeMonths: 480 }],
      kpis: [...BASE_KPIS, "dso"],
    }),
  },
  {
    code: "SERVICES", name: "Zakelijke dienstverlening", nameEn: "Professional services",
    description: "Advies en dienstverlening op uurbasis, vaak met USD-contracten.", descriptionEn: "Time-based advisory services, often with USD contracts.",
    content: content({
      accounts: [
        acc("8500", "Honoraria", "Fees", "REVENUE", "8000"),
        acc("8510", "Doorberekende kosten", "Recharged costs", "REVENUE", "8000"),
        acc("4710", "Inhuur derden", "Contractors", "OPERATING_EXPENSE", "4000"),
        acc("4720", "Opleidingskosten", "Training", "OPERATING_EXPENSE", "4000"),
      ],
      dimensions: [{ type: "PROJECT", code: "ALG", name: "Algemeen (geen opdracht)" }],
      kpis: [...BASE_KPIS, "dso", "personnelCostRatio"],
    }),
  },
  {
    code: "MANUFACTURING", name: "Productie en industrie", nameEn: "Manufacturing",
    description: "Grondstoffen, halffabricaten, gereed product en kostprijs van productie.", descriptionEn: "Raw materials, work in process, finished goods and production cost.",
    content: content({
      accounts: [
        acc("3060", "Voorraad grondstoffen", "Raw materials", "ASSET", "3000"),
        acc("3070", "Halffabricaten", "Work in process", "ASSET", "3000"),
        acc("3080", "Gereed product", "Finished goods", "ASSET", "3000"),
        acc("7300", "Verbruik grondstoffen", "Raw materials consumed", "COST_OF_SALES", "7000"),
        acc("7310", "Directe productielonen", "Direct production labour", "COST_OF_SALES", "7000"),
        acc("7320", "Productie-overhead", "Production overhead", "COST_OF_SALES", "7000"),
        acc("7330", "Voorraadmutatie gereed product", "Change in finished goods", "COST_OF_SALES", "7000"),
        acc("8600", "Omzet eigen producten", "Revenue own products", "REVENUE", "8000"),
      ],
      kpis: [...BASE_KPIS, "inventoryTurnover", "personnelCostRatio"],
    }),
  },
  {
    code: "AGRICULTURE", name: "Landbouw", nameEn: "Agriculture",
    description: "Rijst, bananen en tuinbouw: biologische activa, seizoensarbeid, landbouwmachines.", descriptionEn: "Rice, bananas and horticulture: biological assets, seasonal labour, farm machinery.",
    content: content({
      accounts: [
        acc("0120", "Biologische activa", "Biological assets", "ASSET", "0000"),
        ...fixed("0220", "Landbouwmachines", "Farm machinery"),
        acc("3090", "Voorraad oogst en zaaigoed", "Harvest and seed inventory", "ASSET", "3000"),
        acc("7400", "Zaaigoed, kunstmest en gewasbescherming", "Seed, fertiliser and crop protection", "COST_OF_SALES", "7000"),
        acc("7410", "Seizoensarbeid", "Seasonal labour", "COST_OF_SALES", "7000"),
        acc("8700", "Opbrengst rijst", "Rice revenue", "REVENUE", "8000"),
        acc("8710", "Opbrengst bananen en fruit", "Banana and fruit revenue", "REVENUE", "8000"),
        acc("8720", "Opbrengst tuinbouw", "Horticulture revenue", "REVENUE", "8000"),
      ],
      assetCategories: [{ code: "LANDB", name: "Landbouwmachines", asset: "0220", accumulated: "0225", lifeMonths: 120 }],
      kpis: [...BASE_KPIS, "inventoryTurnover"],
    }),
  },
  {
    code: "NONPROFIT", name: "Stichtingen, kerken en religieuze organisaties", nameEn: "Non-profit, churches and religious organisations",
    description: "Fondsadministratie: bestemmingsfondsen, collecten, giften, subsidies en contributies.", descriptionEn: "Fund accounting: designated funds, collections, donations, grants and membership fees.",
    content: content({
      accounts: [
        acc("0640", "Bestemmingsfondsen", "Designated funds", "EQUITY", "0600"),
        acc("0645", "Bestemmingsreserves", "Designated reserves", "EQUITY", "0600"),
        acc("8800", "Collecten", "Collections", "REVENUE", "8000"),
        acc("8810", "Giften en donaties", "Gifts and donations", "REVENUE", "8000"),
        acc("8820", "Subsidies", "Grants", "REVENUE", "8000"),
        acc("8830", "Contributies leden", "Membership fees", "REVENUE", "8000"),
        acc("4910", "Bestedingen aan doelstelling", "Spending on objectives", "OPERATING_EXPENSE", "4000"),
        acc("4920", "Kosten fondsenwerving", "Fundraising costs", "OPERATING_EXPENSE", "4000"),
      ],
      dimensions: [{ type: "PROJECT", code: "ALG", name: "Algemene middelen" }],
      kpis: ["fundBalance", "currentRatio", "solvency"],
    }),
  },
  {
    code: "ACCOUNTING_FIRM", name: "Accountants- en administratiekantoren", nameEn: "Accounting firms",
    description: "Honoraria per soort opdracht en onderhanden opdrachten.", descriptionEn: "Fees per engagement type and work in progress.",
    content: content({
      accounts: [
        acc("1338", "Onderhanden opdrachten", "Engagements in progress", "ASSET", "1300"),
        acc("8500", "Honoraria samenstelling en controle", "Compilation and audit fees", "REVENUE", "8000"),
        acc("8520", "Honoraria belastingadvies", "Tax advisory fees", "REVENUE", "8000"),
        acc("8530", "Honoraria salarisadministratie", "Payroll service fees", "REVENUE", "8000"),
        acc("4730", "Vakliteratuur en permanente educatie", "Professional literature and CPD", "OPERATING_EXPENSE", "4000"),
      ],
      dimensions: [{ type: "PROJECT", code: "ALG", name: "Algemeen (geen opdracht)" }],
      kpis: [...BASE_KPIS, "dso", "personnelCostRatio"],
    }),
  },
  {
    code: "HEALTHCARE", name: "Gezondheidszorg", nameEn: "Healthcare",
    description: "Praktijken en klinieken: vorderingen op SZF en particuliere verzekeraars, medische middelen.", descriptionEn: "Practices and clinics: receivables from SZF and private insurers, medical supplies.",
    content: content({
      accounts: [
        acc("1315", "Vorderingen op SZF", "Receivables from SZF", "ASSET", "1300"),
        acc("1316", "Vorderingen op particuliere verzekeraars", "Receivables from private insurers", "ASSET", "1300"),
        acc("3095", "Voorraad medicijnen en verbruiksmiddelen", "Medicines and supplies", "ASSET", "3000"),
        acc("7500", "Medische verbruiksmiddelen", "Medical supplies", "COST_OF_SALES", "7000"),
        acc("8900", "Opbrengst consulten", "Consultation revenue", "REVENUE", "8000"),
        acc("8910", "Opbrengst verrichtingen", "Procedure revenue", "REVENUE", "8000"),
        acc("4740", "Waarneming", "Locum costs", "OPERATING_EXPENSE", "4000"),
      ],
      kpis: [...BASE_KPIS, "dso", "personnelCostRatio"],
    }),
  },
  {
    code: "MINING", name: "Mijnbouw en mijnbouwdiensten", nameEn: "Mining and mining services", proposed: true,
    description: "Kleinschalige goudwinning en diensten: concessies, retributie, royalty's, materieel.", descriptionEn: "Small-scale gold mining and services: concessions, fees, royalties, equipment.",
    content: content({
      accounts: [
        acc("0130", "Concessierechten", "Concession rights", "ASSET", "0000"),
        ...fixed("0230", "Mijnbouwmaterieel", "Mining equipment"),
        acc("4150", "Concessie- en retributiekosten", "Concession and retribution fees", "OPERATING_EXPENSE", "4000"),
        acc("4960", "Royalty's", "Royalties", "OPERATING_EXPENSE", "4000"),
        acc("7600", "Verwerkingskosten", "Processing costs", "COST_OF_SALES", "7000"),
        acc("8740", "Opbrengst goudverkoop", "Gold sales revenue", "REVENUE", "8000"),
      ],
      assetCategories: [{ code: "MIJN", name: "Mijnbouwmaterieel", asset: "0230", accumulated: "0235", lifeMonths: 60 }],
      kpis: [...BASE_KPIS],
    }),
  },
  {
    code: "OILGAS", name: "Toeleveranciers olie en gas", nameEn: "Oil and gas suppliers", proposed: true,
    description: "Offshore dienstverlening met USD-contracten, garanties en certificering.", descriptionEn: "Offshore services with USD contracts, guarantees and certification.",
    content: content({
      accounts: [
        acc("1346", "Performance bonds en bankgaranties", "Performance bonds and bank guarantees", "ASSET", "1300"),
        acc("1638", "Vooruitontvangen contractbedragen", "Contract advances received", "LIABILITY", "1600"),
        acc("7610", "Inhuur offshore personeel", "Offshore personnel hire", "COST_OF_SALES", "7000"),
        acc("4360", "Certificering en HSE", "Certification and HSE", "OPERATING_EXPENSE", "4000"),
        acc("8750", "Opbrengst offshore dienstverlening", "Offshore services revenue", "REVENUE", "8000"),
      ],
      dimensions: [{ type: "PROJECT", code: "ALG", name: "Algemeen (geen contract)" }],
      kpis: [...BASE_KPIS, "dso"],
    }),
  },
  {
    code: "FORESTRY", name: "Bosbouw en houtverwerking", nameEn: "Forestry and timber", proposed: true,
    description: "Houtconcessies, retributie, rondhoutvoorraad en zagerij.", descriptionEn: "Timber concessions, fees, log inventory and sawmill.",
    content: content({
      accounts: [
        acc("0140", "Houtconcessies", "Timber concessions", "ASSET", "0000"),
        acc("3096", "Voorraad rondhout", "Log inventory", "ASSET", "3000"),
        acc("4160", "Retributie houtkap", "Logging retribution", "OPERATING_EXPENSE", "4000"),
        acc("7620", "Kap- en sleepkosten", "Felling and skidding costs", "COST_OF_SALES", "7000"),
        acc("8760", "Opbrengst rondhout", "Log revenue", "REVENUE", "8000"),
        acc("8770", "Opbrengst gezaagd hout", "Sawn timber revenue", "REVENUE", "8000"),
      ],
      kpis: [...BASE_KPIS, "inventoryTurnover"],
    }),
  },
  {
    code: "FISHERIES", name: "Visserij", nameEn: "Fisheries", proposed: true,
    description: "Vissersvaartuigen, bemanningsaandelen en export van vis in USD.", descriptionEn: "Fishing vessels, crew shares and USD fish exports.",
    content: content({
      accounts: [
        ...fixed("0420", "Vissersvaartuigen", "Fishing vessels"),
        acc("3097", "Voorraad vis", "Fish inventory", "ASSET", "3000"),
        acc("4370", "Brandstof en ijs", "Fuel and ice", "OPERATING_EXPENSE", "4000"),
        acc("7630", "Bemanningsaandelen", "Crew shares", "COST_OF_SALES", "7000"),
        acc("8780", "Opbrengst export vis", "Fish export revenue", "REVENUE", "8000"),
        acc("8790", "Opbrengst lokale verkoop", "Local sales revenue", "REVENUE", "8000"),
      ],
      assetCategories: [{ code: "VAART", name: "Vissersvaartuigen", asset: "0420", accumulated: "0425", lifeMonths: 180 }],
      kpis: [...BASE_KPIS, "inventoryTurnover"],
    }),
  },
];
