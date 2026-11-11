# ARA Accounting — Accounting Rules

These rules are binding for every module. Surinamese defaults and their legal sources are in [SURINAME_MARKET.md](SURINAME_MARKET.md). Each rule lists where it is enforced (A = application/service, D = database, T = automated test).

> **Implementation status (Phase 2, 2026-11-10).** L1–L5, P1–P6 and F1–F3 are implemented in `src/core/ledger` (engine and pure `domain.ts`) and in the database migration `20261110205400_phase2_ledger_integrity` (immutability trigger, deferred balance trigger, closed-period trigger, line/account trigger, CHECK constraints). Opening balances are entries in the opening journal (OPN) in period 0, dated on the first day of the fiscal year; they may use control accounts. Period 13 is reserved for entries of kind ADJUSTMENT/CLOSING dated on the last day of the fiscal year. Soft-closed periods accept postings only from users with `periods.close`. Segregation of duties is on by default (`Administration.settings.segregationOfDuties`).

## 1. Double entry
| # | Rule | Enforced |
| --- | --- | --- |
| L1 | A posted entry has ≥ 2 lines and Σ debit (base) = Σ credit (base), exactly to the base currency's minor unit. | A, D, T |
| L2 | A line has either a debit or a credit (> 0), never both and never zero. A zero-amount line is allowed only as an explicit memo line in a non-posted draft. | A, D |
| L3 | Lines post to DETAIL accounts that are ACTIVE in the same administration. | A, D (FK + check) |
| L4 | Control accounts (receivable, payable, bank, cash, current account, fixed asset) accept postings only from their owning module. Exception: opening balances, which require `ledger.postControl`. | A, T |
| L5 | All amounts are decimal. Rounding is half away from zero to `Currency.decimals`. A conversion rounding residual is posted to the configured rounding account, never spread silently over lines. | A, T |

## 2. Lifecycle and immutability
| # | Rule | Enforced |
| --- | --- | --- |
| P1 | States: DRAFT → (SUBMITTED → APPROVED) → POSTED. Approval is required when the journal, the amount threshold or the automation mode says so. | A |
| P2 | POSTED entries and lines are never updated or deleted. Corrections are a **reversal** (a full mirror entry dated in an open period) plus a new entry, or a **correction entry** for the difference. Both link to the original. | A, D, T |
| P3 | Posting is atomic: the entry, its lines, the number, the source-document status, the open items, balance snapshots and the audit record are written in one DB transaction. | A, T |
| P4 | Each proposal carries an idempotency key. A repeated key returns the existing entry and creates nothing. | A, D, T |
| P5 | Entry numbers are gapless per journal per fiscal year and assigned at posting. | A, D, T |
| P6 | Segregation of duties (configurable): the creator of an entry, invoice or budget cannot approve it. | A, T |

## 3. Periods and fiscal years
| # | Rule | Enforced |
| --- | --- | --- |
| F1 | Fiscal years per administration do not overlap. Periods are 0 (opening), 1..n and 13 (year-end adjustments). | D |
| F2 | The posting date decides the period. OPEN periods accept postings. SOFT_CLOSED periods accept them only with `periods.postInSoftClosed`. CLOSED periods never do. | A, D |
| F3 | Closing a period requires no DRAFT/APPROVED-but-unposted entries dated in it, or an explicit carry-forward. | A |
| F4 | A fiscal year closes only when every mandatory year-end checklist item is COMPLETED and approved. | A, T |
| F5 | Year close: P&L accounts are closed to retained earnings in period 13 (closing journal). Balance-sheet balances (including open items per party and currency) are carried to the new year's period 0. Opening equals the prior closing, and this is verified. | A, T |
| F6 | Reopening a closed year needs `periods.reopenYear`, a reason, and is audited. Next-year opening balances are then recalculated through a reversal and repost, never by editing. | A |

## 4. Sub-ledgers
| # | Rule |
| --- | --- |
| S1 | Every posted sales or purchase invoice creates one OpenItem. Its remaining amount is only changed by Allocations. |
| S2 | Σ open items (base, at historical rate) per control account = control-account balance after revaluation entries. The Quality Monitor flags any difference. |
| S3 | Allocations may be partial. Over-allocation is rejected. A credit note can be allocated against an invoice of the same party and currency. |
| S4 | Bank transactions are traceable to statement, line and file hash. A matched bank transaction always results in a posted bank-journal entry. |
| S5 | Current-account transactions post to the linked ledger account and keep a per-counterparty open-item balance. |

## 5. Multi-currency
| # | Rule |
| --- | --- |
| C1 | Each line stores the transaction currency amount, the rate, rate date, rate id, rate type and source, plus the base amount. The original amount is never recalculated. |
| C2 | The rate comes from the administration's rate policy (`Administration.settings.fxPolicy`: sales, purchases, revaluation, maximum rate age, approved-only, revaluation mode) for that transaction type. A typed rate that differs from the policy rate needs `currency.edit` and is audited (`fx.rateOverride`). Bank and cambio movements always use the actual rate of the statement or receipt. |
| C3 | Rates are stored as **1 unit of foreign currency = *r* units of base currency** (1 USD = 38.50 SRD, as the CBvS quotes them), with 10 decimals. Approved and rejected rates are immutable. |
| C4 | **Realised difference** on allocation = amount settled × (payment rate − item rate), sign by side. It is posted to FX gain or loss in the same transaction as the payment. |
| C5 | **Unrealised difference** (revaluation) at period end for monetary items (bank, cash, open AR/AP, current accounts, plus accounts listed in the policy such as foreign-currency loans) = closing-rate base value − carrying base value, per account and currency. It is a proposal in the FX journal (approval by another user). Revaluation lines change only the base value (transaction amount 0) and only the currency module may post them. Default policy is auto-reversal on day 1 of the next period (configurable: auto-reverse or cumulative). The sub-ledger check (S2) compares at original rates and leaves revaluations out. |
| C6 | Only one proposed or posted revaluation per (administration, period, scope) (partial unique index). A recalculation first reverses the previous one (possible until the automatic reversal has been booked; after that a correction is a memorial entry). |
| C7 | Non-monetary items (fixed assets, prepaid expenses, equity) are not revalued. |

**Reference example (acceptance workflow 4).** Administration in SRD. Rates are CBvS rates (illustrative).
1. Purchase invoice USD 1,000 at 38.0000 → Dr Expense SRD 38,000 / Cr Creditors SRD 38,000 (tx USD 1,000).
2. Payment USD 1,000 at 38.5000 → Dr Creditors SRD 38,000 / Dr FX loss SRD 500 / Cr Bank USD SRD 38,500.

## 6. Fixed assets
| # | Rule |
| --- | --- |
| A1 | Depreciable base = acquisition cost − residual value. Straight-line monthly = base / useful life in months. Declining balance = NBV × rate / 12, never below residual value. The schedule's last month absorbs rounding. |
| A2 | Depreciation starts in the month of `depreciationStart` (default: month after acquisition, configurable). Disposal stops depreciation from the month after disposal. |
| A3 | Depreciation runs create **proposals**, and posting follows the approval setting. One posted depreciation line per asset per period (unique). |
| A4 | Disposal/sale: remove cost and accumulated depreciation, book proceeds, and the result goes to the gain/loss account. |

## 7. Tax
| # | Rule |
| --- | --- |
| T1 | No tax rate, threshold or bracket is hard-coded. All come from `TaxRuleVersion` with an effective date and a legal status. |
| T2 | A rule with status other than VERIFIED can be used, but every return or calculation that uses it shows a warning, and approval requires an explicit acknowledgement that is stored and audited (the ARA Payroll pattern). |
| T3 | Tax amounts on invoices are calculated per line and rounded per line by default (configurable per jurisdiction: per line or per invoice total). |
| T4 | A tax return is never marked FILED without a filing-evidence document (Belastingdienst receipt or confirmation) and a user confirmation. |
| T5 | **BTW (Suriname):** monthly return per calendar month. Output BTW per rate (10%, 25%, 0%, exempt) from sales lines. Input BTW from purchase and import lines, deductible as configured. The return reconciles to the BTW ledger accounts per period, and the BTW payable/receivable is posted by the tax journal on approval. |
| T6 | **Inkomstenbelasting rechtspersonen:** commercial result → fiscal adjustments (non-deductible costs, fiscal depreciation differences, exempt income, loss offset) → taxable profit × rate from the rule version → minus voorlopige aanslag paid → payable or refundable. |
| T7 | **Foreign-currency invoices** show the SRD equivalent of the BTW at the rate used for the booking, and BTW is always reported in SRD. |

## 8. Budgets and reporting
| # | Rule |
| --- | --- |
| B1 | Actuals = POSTED lines only. Drafts never count. |
| B2 | Variance = actual − budget. % variance = variance / |budget| (n/a when budget = 0). Utilisation = actual / budget. For revenue accounts, a favourable variance is positive. |
| B3 | Approved budget versions are immutable. Changes create a new version. |
| R1 | Every report is generated from ledger data through report mappings. Generated reports store parameters and a ledger fingerprint (count and hash of the included entry ids) for reproducibility. |
| R2 | Every KPI shows its formula, source accounts or reporting lines and its period. Division by zero shows "n.v.t." and never 0. |
| R3 | Forecast and actual amounts are always labelled and kept in separate series. |

## 9. AI and automation
| # | Rule |
| --- | --- |
| AI1 | AI output is a **suggestion** with field confidence. It is stored separately from user-confirmed values. |
| AI2 | Automatic posting is allowed only when an enabled rule in mode AUTO matches, every required field meets the rule's minimum confidence, the supplier is known, there is no duplicate suspicion and the amount is under the threshold. Otherwise the item goes to REVIEW_REQUIRED. |
| AI3 | Duplicate suspicion: same file SHA-256, or the same supplier + invoice number, or the same supplier + date + gross amount. |
