# ARA Accounting — Testing Report

Only results from real runs are recorded here. Environment: Node 22, PostgreSQL 16.15 (local), Chromium (Playwright 1.63).

## Phase 11 — SaaS & practice management (2026-11-11)

| Suite | Result |
| --- | --- |
| Unit | **116 / 116 passed** |
| Integration (PostgreSQL) | **81 / 81 passed** (4 new) |
| End-to-end | **20 / 20 passed** (1 new) |
| Typecheck / lint / build / migration drift | passed |

| Acceptance | Evidence |
| --- | --- |
| Entitlement enforcement | integration "plan limits are enforced on companies, administrations, users and documents…" |
| Trial / read-only / tenant cannot change subscription | integration "a new organisation gets a trial…" (database trigger) |
| Subscription invoices and manual payment | integration "subscription invoices: gapless numbers, manual payment confirmation…" |
| Workflow 10 practice management | integration "the portfolio shows every client administration…"; e2e practice dashboard + subscription page |

## Phase 10 — Quality & automation (2026-11-11)

| Suite | Result |
| --- | --- |
| Unit | **116 / 116 passed** |
| Integration (PostgreSQL) | **77 / 77 passed** (2 new) |
| End-to-end | **19 / 19 passed** (1 new) |
| Typecheck / lint / build / migration drift | passed |

| Acceptance | Evidence |
| --- | --- |
| Each check has a positive and a negative fixture | integration "each of the 12 checks finds its positive fixture; a clean administration has no findings" |
| Issues never auto-resolve | integration "rescans never duplicate; issues never resolve themselves…" |
| UI: scan, close with note | e2e quality monitor |

## Phase 9 — Year-end & tax (2026-11-11)

| Suite | Result |
| --- | --- |
| Unit | **114 / 114 passed** |
| Integration (PostgreSQL) | **75 / 75 passed** (9 new: 9A 3, 9B 4, 9C 2) |
| End-to-end | **18 / 18 passed** (3 new: year-end, BTW return, annual accounts) |
| Typecheck / lint / build / migration drift / seed | passed |

| Acceptance | Evidence |
| --- | --- |
| Workflow 7 / F4 checklist and approval | integration "F4: the checklist blocks until mandatory items pass…"; e2e year-end UI |
| F5 closing, carry-forward, verification | same test (result 8,000 to retained earnings; opening equals closing per account); foreign-currency carry-forward after revaluation (USD 1,000 / SRD 38,000) |
| F6 reopening | integration "F6: reopening needs a reason, reverses opening and closing…" |
| Workflow 8 / T1 rules as data, T2 acknowledgement, T4 filing evidence, T5 BTW reconciliation | integration "calculates output and input BTW per code…", "a difference with the BTW ledger accounts needs an explanation…"; e2e BTW return |
| T6 IB rechtspersonen, dividend tax | integration "commercial result + fiscal adjustments × rate − voorlopige aanslag…", "a fiscal loss gives no tax; a dividend declaration…" |
| Workflow 9 annual accounts | integration "generates statements with notes and asset schedule…", "cannot be finalized when the year is open or the ledger changed…"; e2e annual accounts + PDF |

## Phase 8 — Financial reporting (2026-11-11)

| Suite | Result |
| --- | --- |
| Unit | **114 / 114 passed** (mapping rules, KPI null handling, forecast buckets and scenarios) |
| Integration (PostgreSQL) | **66 / 66 passed** (2 new) |
| End-to-end | **15 / 15 passed** (acceptance workflow 6) |
| Typecheck / lint / build / migration drift | passed |

| Phase 8 acceptance | Evidence |
| --- | --- |
| Statements consistent with each other and the ledger | integration "balance sheet, P&L, cash flow, equity and KPIs…" — a fully worked example: P&L net 1,650; balance 18,950 = 18,950; cash flow −950 / −3,600 / +5,000 = cash change 450 |
| KPI formulas (R2) | same test (gross margin 60.0%, net margin 33.0%, current ratio 6.72, solvency 61.5%, n.v.t. where undefined) + unit test |
| Report fingerprint reproducibility (R1) | integration "fingerprint: identical for the same ledger…" (drafts do not change it; a posting does; archived runs append-only) |
| Workflow 6 in the browser | e2e P&L → balance → cash flow → KPIs → PDF/CSV download → forecast |

## Phase 7 — ARA Scan & AI (2026-11-11)

| Suite | Result |
| --- | --- |
| Unit | **109 / 109 passed** (magic-byte sniffing, text-layer extraction, supplier matching) |
| Integration (PostgreSQL) | **64 / 64 passed** (5 new; real PDFs generated with pdf-lib, read through unpdf) |
| End-to-end | **14 / 14 passed** (acceptance workflow 2, scan variant) |
| Typecheck / lint / build / migration drift | passed |

| Phase 7 acceptance | Evidence |
| --- | --- |
| AI1 suggestions apart from confirmed values | integration "manual review creates a draft purchase invoice…" (`confirmed` JSON vs append-only `DocumentExtraction`) |
| AI2 automation conditions | integration "rules: DRAFT submits…; AUTO_POST posts only within its limits and confidence" (limit, confidence, amount mismatch; monitor counts) |
| AI3 duplicates | integration "rejects non-document files and flags the same file…", "manual review … blocks a suspected duplicate unless accepted" |
| AI off by default, consent recorded, isolation | integration "AI is an organisation decision with recorded consent…"; first test shows only the text-layer provider ran |
| Workflow 2 (scan) in the browser | e2e upload → suggestions → purchase invoice → rule |

The Claude extractor itself was not called (no API key in this environment). It is covered by typechecking against the SDK and by the fixture extractor that plays its role.

## Phase 6 — Budgets (2026-11-11)

| Suite | Result |
| --- | --- |
| Unit | **106 / 106 passed** (variance and favourability rules, alerts, distribution without lost cents, CSV import) |
| Integration (PostgreSQL) | **59 / 59 passed** (4 new) |
| End-to-end | **13 / 13 passed** (acceptance workflow 5) |
| Typecheck / lint / build / migration drift | passed |

| Phase 6 acceptance | Evidence |
| --- | --- |
| B1 actuals = posted only | integration "budget versus actual uses posted entries only…" (a draft of SRD 99,999 is ignored) |
| B2 variance, %, utilisation, favourable for revenue vs costs | same test + unit "variance, percentage and utilisation…" |
| B3 approved versions immutable; new version supersedes | integration "submitted and approved versions are immutable…" (database triggers, segregation of duties) |
| Prior-year basis, seasonal distribution, forecast | integration "builds next year's budget from last year's actuals (+5%)…" |
| Workflow 5 in the browser | e2e budget → grid → distribution → report with alert → forecast |

## Phase 5 — Multi-currency (2026-11-11)

| Suite | Result |
| --- | --- |
| Unit | **100 / 100 passed** (CBvS CSV parsing, revaluation calculation, base-only lines, policy defaults) |
| Integration (PostgreSQL) | **55 / 55 passed** (5 new) |
| End-to-end | **12 / 12 passed** (1 new) |
| Typecheck / lint / build / migration drift | passed |

| Phase 5 acceptance | Evidence |
| --- | --- |
| Workflow 4: USD invoice paid at another rate | integration "takes the CBvS selling rate from the policy … books the realised difference on payment" (Dr 4500 SRD 38,000; FX loss SRD 500) |
| C1 original amounts never recalculated | revaluation lines keep tx amount 0; the invoice line keeps USD 1,000 at 38 |
| C2 policy rate, audited override with permission | same test (override refused without `currency.edit`; audit `fx.rateOverride`) |
| C3 rate storage and immutability | integration "rates are entered, approved by someone else, immutable once decided…" |
| C5 revaluation, approval, auto-reversal | integration "revalues the USD receivable at the closing rate…"; e2e proposal SRD 1,050 |
| C6 one active revaluation, recalculation via reversal | integration "cumulative mode … a recalculation first reverses…" |
| C7 non-monetary items untouched | USD prepayment on 1320 not revalued |

Defects found and fixed:
- posting re-validated stored lines without recognising revaluation lines (`storedLineInput`);
- the rate column was not localised;
- an ambiguous "Opslaan" button now reads "Koers opslaan".

## Phase 4 — Industry templates (2026-11-11)

| Suite | Result |
| --- | --- |
| Unit | **96 / 96 passed** (25 new: each of the 20 templates validates against the base chart; validation, hash and diff rules) |
| Integration (PostgreSQL) | **50 / 50 passed** (5 new) |
| End-to-end | **11 / 11 passed** (acceptance workflow 1) |
| Typecheck / lint / build / migration drift / seed idempotency | passed (second seed run creates no new versions) |

| Phase 4 acceptance | Evidence |
| --- | --- |
| Applying a template | integration "a construction administration gets the template's accounts…"; e2e workflow 1 |
| Applying is reproducible | integration "is reproducible: the same template version gives the same chart…" |
| An upgrade never overwrites | integration "builds, publishes, applies and upgrades without overwriting…" (renamed account kept; conflicting number skipped; stale proposal refused) |
| Versioning, immutability, tenant rules | integration "platform templates are read-only…", "exports and re-imports…" |
| Builder, publish, export | e2e workflow 1 (own template, account added, published, JSON downloaded) |

## Phase 3 — Financial operations (2026-11-11)

| Suite | Result |
| --- | --- |
| Unit | **71 / 71 passed** (adds invoicing/BTW calculation, CSV bank import parsing, depreciation schedules) |
| Integration (PostgreSQL) | **45 / 45 passed** (16 new: 3A invoices/open items, 3B banking, 3C assets/current accounts) |
| End-to-end | **10 / 10 passed** (4 new) |
| Typecheck / lint / build / migration drift | passed |

| Phase 3 acceptance | Evidence |
| --- | --- |
| Sales/purchase invoices with BTW, posting through the engine | integration phase3a; e2e phase3a (invoice → post → PDF) |
| Open items, allocations, FX result, aging, sub-ledger = control account | integration phase3a |
| Bank import without duplicates, matching, reconciliation with approval | integration phase3b; e2e phase3b |
| Depreciation: monthly proposal, approval required, never twice, withdrawal, posted lines immutable (DB trigger) | integration "registers an asset … never twice" |
| Disposal only after depreciation is up to date; gain/loss; history append-only | integration "disposes with a loss…", "sells with a gain…" |
| Current accounts: own control account, closed to manual entries, confirmations with difference | integration "books movements through its own control account…"; e2e phase3c |
| Tenant isolation of the new tables | integration "asset data of another organisation is invisible" |

Defects found and fixed:
- withdrawing a posted proposal surfaced a raw database error instead of a message (a service check was added; the database guard remains);
- an e2e race in phase3b continued before the relation was saved (the test now waits for it);
- the `-0` sign bug in settlement (always `lt(0)`).

## Phase 2 — Accounting core (2026-11-10)

| Suite | Result |
| --- | --- |
| Unit | **54 / 54 passed** (adds ledger domain incl. a 2 000-case property test: every accepted entry balances, every line has exactly one side) |
| Integration (PostgreSQL) | **29 / 29 passed** (17 new) |
| End-to-end | **6 / 6 passed** (2 new) |
| Typecheck / lint (incl. engine-only write rule) / build | passed |

| Phase 2 acceptance | Evidence |
| --- | --- |
| Journal creation, debit/credit validation | unit `buildLines`; integration "refuses unbalanced entries…"; e2e live difference + refusal message |
| Posting, gapless numbering, idempotency | integration "draft → post…", "concurrent postings never share or skip a number" (8 parallel), "an idempotency key never creates a second entry" |
| Reversal and correction | integration "reversal creates a linked mirror entry…", "correction = reversal + editable draft copy"; e2e reversal |
| Opening balances | integration "opening balances go to period 0…" (approval + segregation of duties) |
| General ledger movements, trial balance | integration "shows opening, period and closing columns…" (exact figures, drafts excluded, account range, running balance); e2e TB → GL drill-down, CSV export |
| Period locking | integration "posting into a CLOSED period is refused by the database", "a period with unposted entries cannot be closed" |
| Audit history / immutability | integration "posted entries and lines cannot be updated or deleted, even by the database owner", "an unbalanced entry cannot be committed as POSTED", "lines cannot point to an account of another administration" |
| Permissions and isolation | integration "a bookkeeper can post but not reverse or approve" (bookkeepers lack `ledger.post`), "ledger data of another organisation is invisible" |

Defects found and fixed: trial-balance query dropped accounts with lines only in other years/drafts (moved filters into a subquery); a component defined during render (lint); editor showed `500.00` instead of `500,00`.

## Phase 1 — Foundation (2026-11-10)

| Suite | Command | Result |
| --- | --- | --- |
| Unit | `npm test` | **47 / 47 passed** (money 26, auth/TOTP/crypto/permissions 13, periods 4, i18n 4) |
| Integration (PostgreSQL) | `npm run test:integration` | **12 / 12 passed** |
| End-to-end (Playwright, production build) | `npm run test:e2e` | **4 / 4 passed** |
| Typecheck / lint / production build | `npm run typecheck`, `npm run lint`, `npm run build` | passed, 0 errors, 0 warnings |
| Visual check | screenshots 1280 px and 390 px | no horizontal overflow; no console errors under the CSP |

### Phase 1 acceptance criteria → evidence
| Criterion | Test |
| --- | --- |
| A user can create an organisation (business and accounting firm) | integration "a user can register…", "an accounting firm registers…"; e2e register flow |
| An organisation can create companies; companies can have multiple administrations | integration "an organisation can create several companies…"; e2e adds a USD administration with a deviating fiscal year |
| Users can be assigned to organisations and have different permissions | integration "members get different permissions per company through assignments", "disabled members lose all access", "a business cannot hand out accounting-firm roles"; unit permission-matrix tests |
| Users cannot access another organisation's data | integration "one organisation can never read or change another organisation's data" (reads, updates, deletes, inserts, sessions blocked by PostgreSQL RLS), "services refuse ids from another organisation"; e2e "another organisation cannot open a company by URL" (HTTP 404) |
| Administration switching loads the correct environment | e2e: switch from USD (2026/2027) to HOOFD (2026) → dashboard shows periods of 2026 |
| Fiscal years and periods can be configured | unit calendar tests (calendar and deviating years, leap year); integration overlap refused by the exclusion constraint, next fiscal year, close/reopen with reason; e2e close and reopen-without-reason |
| Audit trail | integration "records actions in a verifiable hash chain that cannot be altered" (UPDATE/DELETE refused even for the database owner); e2e audit page shows "Keten intact" |
| Authentication, MFA, rate limiting | unit RFC 4226/6238 vectors, scrypt, AES-GCM tampering; e2e MFA set-up, wrong code refused, correct code accepted; wrong password refused |

### Defects found by the tests and fixed before release
1. `buttonClass` was defined in a client module and called from server components (runtime error on several pages) → moved to `src/components/ui/button-class.ts`.
2. After enabling MFA the page re-rendered and the one-time recovery codes were never shown → removed the revalidation in `confirmMfaAction`.
3. MFA enforcement for owners blocked onboarding of a brand-new organisation → 7-day grace period with a visible deadline (documented in SECURITY.md).
4. Function props passed from server to client components (`render`) → replaced by serialisable `dataLabels`.
5. Missing colour token `navy-900` left the top bar transparent → token registered.

### Not yet covered (planned)
- Mobile e2e project and English-language e2e run (Phase 12).
- E-mail delivery against a real SMTP server (no SMTP configured; code path returns "not configured" instead of pretending).
- Load tests (Phase 12).
