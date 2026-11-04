# ARA Accounting — Suriname Market Profile

ARA Accounting is designed **for the Surinamese market**. Every default, template, tax rule, report, identifier, bank format and piece of terminology is Surinamese. There is no other country profile in scope.

How to read this document
- Each statutory item carries a **verification status**: `VERIFIED` (checked against the primary legal text by a qualified professional), `SOURCE_FOUND` (a primary source is identified but not professionally reviewed), or `PENDING_VERIFICATION` (only secondary sources or none).
- The application stores these items as **data** (versioned rules with this status), never as code. Until an item is `VERIFIED`, the app shows "wettelijke verificatie in behandeling" and requires an acknowledgement when it is used for a return or annual accounts. This is the same pattern ARA Payroll uses.
- Nothing in this document is legal or tax advice. It is the starting configuration that a Surinamese tax advisor and a SUVA-registered accountant must review before launch.

---

## 1. Language and terminology
- Interface language: **Dutch as used in Suriname**, with English secondary. Examples: *debiteuren/crediteuren*, *grootboek*, *dagboek*, *memoriaal*, *rekening-courant directeur*, *BTW-aangifte*, *inkomstenbelasting*, *jaarrekening*, *samenstellingsverklaring*, *kasboek*, *cambio*.
- Number and date format `nl-SR`: `SRD 38.000,00`, `31-12-2026`. Amounts always show the ISO code (SRD, USD, EUR) and never only a symbol, because "$" is ambiguous between SRD and USD in daily use.
- Input accepts both `1.234,56` and `1,234.56` (ARA Payroll behaviour).

## 2. Legal entities and registration
| Item | Surinamese implementation | Status |
| --- | --- | --- |
| Legal forms (`Company.legalForm`) | Eenmanszaak, Vennootschap onder firma (VOF), Commanditaire vennootschap (CV), Naamloze vennootschap (NV), Stichting, Vereniging, Coöperatieve vereniging, Overheids-NV / parastataal bedrijf, Kerkgenootschap | PENDING_VERIFICATION (list to be confirmed against the Wetboek van Koophandel / Burgerlijk Wetboek SR) |
| Trade register | **KKF-nummer** (Kamer van Koophandel en Fabrieken), `Company.kkfNumber` | SOURCE_FOUND |
| Tax identification | Fiscaal nummer at the Belastingdienst Suriname (`Company.taxNumber`). A separate **BTW-registratienummer** is stored when the company is a BTW-ondernemer (`Company.btwNumber`) | PENDING_VERIFICATION (format and whether these are one number) |
| Address | Street, number, area/ressort, **district** (enum: Paramaribo, Wanica, Nickerie, Coronie, Saramacca, Commewijne, Marowijne, Para, Brokopondo, Sipaliwini) | Fact |
| Fiscal year | Default = calendar year. A deviating fiscal year (gebroken boekjaar) is supported but flagged for review | PENDING_VERIFICATION |

## 3. Currency and exchange rates
| Item | Implementation | Status |
| --- | --- | --- |
| Functional currency | **SRD** default for every administration. USD or EUR is possible as functional currency (for example mining/oil service companies), with a warning that this is an accounting-policy choice to agree with the accountant | Design |
| Common transaction currencies | SRD, USD, EUR (activated by default); GBP, BRL, GYD, XCD, TTD, CNY available | Design |
| Official rate source | **Centrale Bank van Suriname (CBvS)** publishes weighted-average **buying and selling** rates daily, plus monthly averages ([CBvS monthly averages](https://www.cbvs.sr/images/content/publicaties/Wisselkoersen/2025/Maandoverzichten_2025/EN/Monthlyaverageexchangerates1994-2025_EN.pdf)) | SOURCE_FOUND |
| Rate types | `CBVS_BUY`, `CBVS_SELL`, `CBVS_MID`, `CBVS_MONTH_AVG`, `BANK` (the bank's rate on the actual conversion, from the bank statement), `CAMBIO` (a documented cambio receipt), `MANUAL` | Design |
| Default policy (`ExchangeRatePolicy`) | Sales invoices: CBvS buy on invoice date. Purchase invoices: CBvS sell on invoice date. Bank and cambio conversions: the **actual rate on the bank statement or receipt**. Period-end revaluation: CBvS closing rate (last business day). P&L reporting: CBvS monthly average. Every default is configurable per administration and **must be agreed with the accountant**. | Design, review by accountant |
| Rate provider | `CbvsRateProvider` adapter (scrape or parse the published table; no official API confirmed). Rates are imported as PENDING and approved by a user, unless the administration auto-approves CBvS rates | Integration to be tested |
| Volatility | The SRD has seen large devaluations, so revaluation, realised FX differences and USD/EUR bank accounts are core features, not extras | Design |

## 4. Banking
| Item | Implementation |
| --- | --- |
| Banks (seed list for bank-account creation and import profiles) | De Surinaamsche Bank (DSB), Hakrinbank, Finabank, Republic Bank (Suriname), Southern Commercial Bank, Coöperatieve Spaar- en Kredietbank Godo, Volkscredietbank, Surinaamse Postspaarbank, Trustbank Amanah. Each is confirmed and given an import profile only after a real sample file is received. |
| Account numbers | Local bank account numbers (no IBAN), with a separate account per currency (SRD, USD, EUR accounts at the same bank are common). `BankAccount.accountNumber` is free-format; uniqueness is per bank + account number + currency. |
| Statement import | **CSV/Excel import with a saved column mapping per bank** (primary). PDF statement extraction through ARA Scan (secondary). CAMT.053/MT940 parsers are **not** in scope until a Surinamese bank is confirmed to supply them. |
| Cash and cambio | A cash book per currency. Cambio exchanges are recorded as a currency transfer between two cash or bank accounts at the receipt rate, with the receipt attached. |
| Payments out | Exportable payment lists (CSV) per bank, with formats added once the bank specifications are confirmed. There is no direct bank API (none confirmed). |

## 5. Taxes (configuration seeds, all versioned data)
| Tax | Seed configuration | Primary source | Status |
| --- | --- | --- | --- |
| **BTW** (Belasting over de Toegevoegde Waarde, replaced omzetbelasting from 1 January 2023) | General rate **10%**; **25%** on goods listed in bijlage 3; **0%** for goods/services in bijlage 1; exempt supplies; a reported 5% category to be verified. Tax codes: `BTW10`, `BTW25`, `BTW0`, `VRIJGESTELD`, `INVOER10`, `INVOER25`, `GEEN_BTW` (non-BTW-ondernemer). Return period: **calendar month**. Filing deadline seeded as day 16 of the following month **only as a placeholder** to be confirmed. | [S.B. 2022 no. 121](https://belastingdienst.sr/wp-content/uploads/2022/11/S.B.-2022-No.-121-WET-van-12-okt-2022-houdende-vaststelling-van-een-belasting-over-de-toegevoegde-waarde-2022.pdf), [S.B. 2022 no. 148](https://www.sris.sr/wp-content/uploads/2023/01/S.B.-2022-no.-148-wijziging-van-de-Wet-Belasting-over-de-Toegevoegde-Waarde-2022.pdf) | SOURCE_FOUND (rates), PENDING_VERIFICATION (deadline, 5%, input-tax deduction rules, BTW-factuur requirements) |
| **Inkomstenbelasting rechtspersonen** (profit tax for NV etc.) | Rate **36%** of taxable profit (unless a tax holiday applies). Supports fiscal adjustments, a voorlopige aanslag (provisional assessment) and its instalments, and a definitive return | [EITI Suriname, tax overview](https://eitisuriname.gov.sr/?p=642) (secondary government source); primary: Inkomstenbelasting 1922 as amended | SOURCE_FOUND (rate), PENDING_VERIFICATION (loss carry-forward, depreciation rules, filing deadlines) |
| **Inkomstenbelasting natuurlijke personen** (eenmanszaak, VOF partners) | Bracket table stored as data; the profit from the business is calculated by ARA Accounting and exported as a schedule for the owner's personal return | Wet Inkomstenbelasting (brackets shared with ARA Payroll's verified tables when available) | PENDING_VERIFICATION |
| **Dividendbelasting** | 25% withheld on dividend distributions, recorded through a dividend-declaration flow (equity → payable → tax payable) | [EITI Suriname](https://eitisuriname.gov.sr/?p=642) | SOURCE_FOUND |
| **Loonbelasting / AOV / AKB / pensioen / FVO** | Not calculated here. Posted from **ARA Payroll** through the payroll journal import (wage costs, LB, AOV and contributions payable) | ARA Payroll legal register | Inherits Payroll status |
| Other | Huurwaardebelasting, import duties (invoerrechten), consent fees (statistiekrecht), concession royalties for mining are configurable tax types (no seed rates) | — | PENDING_VERIFICATION |

## 6. Annual accounts (jaarrekening)
| Item | Implementation | Status |
| --- | --- | --- |
| Law | **Wet op de Jaarrekening, S.B. 2017 no. 84** ([text](https://www.sris.sr/wp-content/uploads/2018/08/sb_2017___84_wet_op_de_jaarrekening.pdf)). It applies to NV's, coöperaties, onderlinge waarborgmaatschappijen and CBvS-supervised institutions regardless of legal form. Size categories, filing/publication duties and audit requirements must be extracted from the law text. | SOURCE_FOUND |
| Reporting framework | The IFRS Foundation profile states that Surinamese law does not prescribe a specific framework ([IFRS jurisdiction profile](https://www.ifrs.org/use-around-the-world/use-of-ifrs-standards-by-jurisdiction/view-jurisdiction/suriname)), so this must be checked against the 2017 law. Templates: **(1) "Jaarrekening NV — IFRS for SMEs-grondslag"**, **(2) "Jaarrekening NV — volledige IFRS"** (banks and large entities), **(3) "Jaarstukken eenmanszaak / VOF" with a samenstellingsverklaring** (for the tax return and banks), **(4) "Jaarrekening stichting / vereniging / kerkgenootschap"** (income and expenses, fund balances). | PENDING_VERIFICATION |
| Accountant statements | Templates for a samenstellingsverklaring and the hand-off to an auditor (controleverklaring is issued by the accountant, not generated as final by the app) | Review by SUVA member |
| Language | Annual accounts in Dutch, with an optional English version (often required by foreign lenders or parent companies) | Design |

## 7. Industry templates (Surinamese economy)
All 15 required templates are built with a Surinamese chart of accounts (account classes 0–9 in the Dutch-Surinamese tradition, SRD/USD/EUR bank accounts, BTW codes, Surinamese payroll liability accounts that match ARA Payroll). Additional Surinamese templates are proposed:

| Template | Surinamese specifics |
| --- | --- |
| General trading / Wholesale / Retail | Import duties and BTW on import (`INVOER10/25`), USD purchasing, cambio cash |
| Construction / Technical installations | Project dimension mandatory, term invoicing, retentions (*retentie*), government contracts |
| Hospitality / Tourism | Lodges in the interior, USD/EUR guest payments, tips, seasonal reporting |
| Transport & logistics | Boat and river transport, vehicles as fixed assets, fuel |
| Real estate | Rental income, huurwaardebelasting, property depreciation, deposits |
| Professional services | Time-based billing, USD contracts |
| Manufacturing | Inventory, cost price, production results |
| Agriculture | Rice, bananas, horticulture; biological assets; seasonal crops |
| Non-profit / Churches & religious organisations | Fund accounting (bestemmingsfondsen), donations and collections (*collecten*), income and expense statement, no profit tax |
| Accounting firms | Client billing by engagement |
| Healthcare administration | Medical practices, insurer receivables (SZF and private insurers) |
| **Proposed: Mining & mining services** | Small-scale gold, USD functional-currency option, royalties, concession costs |
| **Proposed: Oil & gas suppliers** | USD contracts, offshore service companies, performance bonds |
| **Proposed: Forestry & timber** | Concessions, retribution fees, log inventory |
| **Proposed: Fisheries** | Vessels, export in USD |

## 8. Invoicing requirements
Sales invoices default to a **BTW-factuur** layout: supplier name, address, KKF and BTW numbers, customer details, invoice number and date, description, quantity, amount excluding BTW per rate, BTW per rate, total, and the currency (with the SRD equivalent when the invoice is in a foreign currency). The exact mandatory fields must be verified against the BTW law (PENDING_VERIFICATION). Templates are in Dutch, with English optional.

## 9. Working calendar
Surinamese public holidays (fixed holidays plus the movable ones: Holi Phagwa, Ied-ul-Fitr, Diwali, Easter, Chinese New Year; ARA Payroll has the same open item) drive due dates, aging and deadline reminders. The movable dates are entered per year by the platform administrator.

## 10. Practical constraints
- **Connectivity.** ARA Scan works as an offline-tolerant PWA: documents are queued on the device and uploaded when the connection returns.
- **Payments for subscriptions.** Manual bank transfer in SRD or USD to an ARA bank account, confirmed by the platform administrator. No card processor is assumed.
- **Hosting and data location.** There is no local hyperscale cloud. Hosting will be at a reputable provider (closest region: US-East or Brazil). This is disclosed in the terms, with full data export available.
- **Integration with the ARA suite.** ARA Payroll (salary journals) and later ARA Tax.

## 11. Professional review required before launch
1. Surinamese tax advisor: BTW (rates, annexes, deadlines, invoice requirements, input-tax rules), profit tax (adjustments, losses, depreciation, deadlines), dividend tax.
2. SUVA-registered accountant: annual-accounts templates under S.B. 2017 no. 84, chart-of-accounts templates, FX policy defaults, year-end checklist.
3. Sample statement files from each supported bank.
