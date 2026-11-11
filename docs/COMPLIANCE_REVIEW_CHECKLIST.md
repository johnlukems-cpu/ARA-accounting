# ARA Accounting — Suriname Compliance Review Checklist

For the external reviewers: a **Surinamese tax adviser** (§1–§3, §5) and a **SUVA-registered accountant** (§4).

> **Status.** ARA Accounting does **not** claim compliance with Surinamese legislation. Each legal item below is
> configurable data with a legal status. It becomes *Geverifieerd* only when a review with the adviser's name,
> qualification, date and reference is recorded in Platformbeheer → Compliance. The record is append-only. Until then,
> every tax calculation shows that its rules are unverified, and approving a return requires an explicit
> acknowledgement.

How to use: for each line, give a decision (**Approved / Changes required / Rejected**) and, if needed, the correct
value with its legal source. ARA records the decision; development implements any change as a **new rule version** with
an effective date, so earlier returns stay reproducible.

## Part I — Legal items (need external verification)

### 1. Tax rules (platform data, `TaxRuleVersion`)

| Key | Current parameters | Source found by development | Question for the adviser |
| --- | --- | --- | --- |
| BTW@2023-01-01 | period MONTH; rates: general 10 %, annex 3 25 %, zero 0 %; filing day 16 of the following month | Wet BTW 2022, S.B. 2022 no. 121; amendment S.B. 2022 no. 148 | Are the rates and effective date correct? Is the filing and payment deadline the 16th? Is the return period monthly for every registered entrepreneur? |
| IB_RECHTSPERSONEN@2020-01-01 | rate 36 % | EITI Suriname tax overview (secondary source); Inkomstenbelasting 1922 | Rate and effective date? Loss carry-forward rules, provisional assessments, filing deadline? |
| DIVIDENDBELASTING@2020-01-01 | withholding 25 % | EITI Suriname tax overview | Rate, effective date, exemptions (participations), payment deadline? |

### 2. BTW codes created in every administration (`STANDARD_TAX_CODES`)

| Code | Name | Rate | Use | Question |
| --- | --- | --- | --- | --- |
| BTW10 | General rate | 10 % | sales and purchases | Correct? Which goods and services? |
| BTW25 | Annex 3 rate | 25 % | sales and purchases | Correct? |
| BTW0 | Zero rate (annex 1) | 0 % | sales and purchases | Correct? Which supplies (export …)? |
| VRIJ | Exempt | 0 % | sales and purchases | Which supplies are exempt, and is input BTW then non-deductible? |
| INV10 / INV25 | Import BTW | 10 % / 25 % | purchases | How is import BTW levied and deducted (customs)? |
| GEEN | Not registered | 0 % | — | Turnover threshold for registration? |

Also confirm the **return layout** (boxes) used by the BTW return in ARA (Belastingen → BTW-aangifte).

### 3. Other legal items

| Key | Current behaviour | Question |
| --- | --- | --- |
| INVOICE_REQUIREMENTS | The sales invoice PDF shows:<br>• name, address and tax number of the seller and the customer;<br>• a gapless invoice number and the date;<br>• a description;<br>• the amount excluding BTW, then rate and BTW amount per rate;<br>• the total. | Which contents are mandatory under the Wet BTW 2022? Is anything missing (e.g. a statement for zero rate/exempt supplies, the BTW amount in SRD on foreign-currency invoices)? |
| FX_RATE_FOR_TAX | Configurable rate policy per administration (default: CBvS selling rate of the invoice date). | Which rate must be used for BTW on invoices in USD/EUR? |
| DIGITAL_RECORDS | Originals stored immutably with SHA-256; paper originals are not replaced. | May digital copies replace paper originals? Under what conditions? |

### 4. Annual-accounts frameworks (SUVA-registered accountant)

| Framework | Content to review |
| --- | --- |
| NV_IFRS_SME | Layout of the balance sheet and P&L, statement of changes in equity, cash flow (indirect), accounting principles, and draft notes under the Wet op de Jaarrekening (S.B. 2017 no. 84). |
| NV_FULL_IFRS | Same, for full IFRS: which disclosures are missing? |
| SOLE_PROPRIETOR | Jaarstukken (annual statements) for a sole proprietorship or VOF: what is customary, and what does the tax return require? |
| FOUNDATION | Foundation, association or church: layout and terminology. |

### 5. Retention

| Key | Current setting | Question |
| --- | --- | --- |
| BOOKS_AND_RECORDS | 10 years from the end of the fiscal year; deletion only after retention, by the owner. | What is the statutory retention period for books, records and supporting documents? |

## Part II — Software rules (product design, no legal verification needed)

These rules are part of how ARA Accounting works as accounting software. They are deliberately strict and are not
claims about Surinamese law. Reviewers may still comment on them.

| Rule | Where |
| --- | --- |
| Double entry: every posted entry balances (database constraint trigger) | ACCOUNTING_RULES §1 |
| Posted entries are immutable; corrections through reversal or correction entries | ACCOUNTING_RULES §2 |
| Gapless numbering per journal and fiscal year; invoice numbers assigned at posting | ACCOUNTING_RULES §2, §4 |
| Period and year locks; period 13 for year-end adjustments | ACCOUNTING_RULES §3 |
| Segregation of duties for approvals | ACCOUNTING_RULES §2 |
| FX policy defaults, revaluation with automatic reversal | ACCOUNTING_RULES §5 |
| Depreciation methods (straight-line, declining balance) and default useful lives (commercial estimates) | ACCOUNTING_RULES §6 |
| Budget workflow, KPI definitions, forecast assumptions | ACCOUNTING_RULES §8 |
| AI only suggests; auto-posting only within explicit rules | ACCOUNTING_RULES §9 |
| Quality checks and their thresholds | Kwaliteitsmonitor |

Note: the **fiscal** depreciation rules (allowed methods and rates for the IB return) are a legal question and belong
under §1 if ARA is to compute them. They are not built.

## Recording a review

Platformbeheer → **Compliance** → *Review vastleggen*:

1. Choose the item.
2. Choose the decision.
3. Enter the date of the opinion, the adviser's name and qualification, and the reference of the letter or report.
4. Add notes; they are required when the decision is not *Approved*.

The signed opinion itself stays in ARA's archive.
