# ARA Accounting — API Documentation

Status: **conventions defined (Phase 0)**. Endpoints are added to this file as they are implemented. Only implemented and tested endpoints are listed under §3.

## 1. Interface types
| Type | Used for | Auth |
| --- | --- | --- |
| Server actions (`src/actions/*`) | All UI mutations | Session cookie + Next.js origin check |
| Route handlers `GET /api/...` | File downloads (PDF, Excel, CSV, documents), exports, health | Session cookie |
| Route handlers `POST /api/scan/upload` | PWA / mobile document upload (multipart) | Session cookie |
| Public REST API `/api/v1/...` (Phase 11) | Integrations (bank, webshop, ARA Payroll) | Organisation API keys (hashed, scoped, rate-limited) |
| Webhooks in `/api/webhooks/...` (Phase 11+) | Provider callbacks | HMAC signature |

## 2. Conventions
- Inputs are validated by a Zod schema in `src/modules/<module>/schemas.ts`. The same schema backs the action and the REST endpoint, and its TypeScript types are exported.
- Amounts travel as **decimal strings** (`"1234.56"`) with an explicit ISO currency code. Rates are decimal strings with up to 10 decimals. Dates are ISO `YYYY-MM-DD`.
- Action result: `{ ok: boolean, message?: string, errors?: Record<field, string[]>, data?: T }`. Messages are translated (nl/en).
- Errors: `UserError(key, values)` → 4xx-equivalent, `AuthError` → 401/403, unexpected → 500 with request id (no stack to the client).
- Every mutating call that creates financial data accepts an `idempotencyKey` (generated client-side per form submission).
- Pagination is cursor-based (`cursor`, `limit` ≤ 200). Sorting uses a whitelist.
- REST versioning: `/api/v1`. Breaking changes need a new version.

## 3. Implemented endpoints
### `GET /api/health`
Liveness check for Vercel and monitoring. No authentication. Returns no tenant data. `Cache-Control: no-store`.

```json
{ "status": "ok", "service": "ara-accounting", "version": "0.1.0", "commit": "17067ee", "region": "iad1", "time": "2026-11-10T19:38:08.304Z" }
```
`commit` and `region` are `null` outside Vercel.

### Server action `setLocale(formData)`
Sets the interface language cookie (`ARA_ACC_LOCALE`, HttpOnly, 1 year). `locale` must be `nl` or `en`; other values are ignored.

### Server actions — Phase 1 (`src/actions/*`)
All mutations validate input with the Zod schemas in `src/modules/organization/schemas.ts`, check permissions on the server (`requireActionContext` / `assertCan`), run tenant writes through `withTenant` (row-level security) and write an audit record in the same transaction.

| Action | File | Permission | Notes |
| --- | --- | --- | --- |
| `registerAction` | auth.ts | public, rate-limited | Creates user, organisation (BUSINESS or ACCOUNTING_FIRM) and owner membership |
| `loginAction`, `verifyMfaAction`, `logoutAction` | auth.ts | public / session | Rate-limited; TOTP or single-use recovery code |
| `requestPasswordResetAction`, `resetPasswordAction` | auth.ts | public | Requires SMTP for self-service; same answer whether the e-mail exists or not |
| `acceptInvitationAction`, `verifyEmail` | auth.ts | token | Single-use tokens |
| `startMfaSetupAction`, `confirmMfaAction`, `disableMfaAction`, `changePasswordAction`, `updateProfileAction` | account.ts | own account | Password/MFA changes revoke other sessions |
| `switchContextAction` | organization.ts | session | Organisation, company, administration, fiscal year; validated against access |
| `updateOrganizationAction` | organization.ts | `organization.edit` (+ `manageSettings` to turn MFA enforcement off) | |
| `createCompanyAction`, `updateCompanyAction`, `setCompanyStatusAction`, `createBranchAction` | organization.ts | `companies.create` / `companies.edit` | KKF number unique per organisation |
| `createAdministrationAction`, `createNextFiscalYearAction` | organization.ts | `administrations.create` / `administrations.edit` | Creates fiscal year with periods 0–13 |
| `setPeriodStatusAction` | organization.ts | `periods.close` | Reopening requires a reason |
| `inviteMemberAction`, `updateMembershipAction`, `memberResetLinkAction` | organization.ts | `organization.manageUsers` | Owner and own membership are protected |
| `assignCompanyAction`, `removeAssignmentAction` | organization.ts | `organization.manageUsers` or `companies.manageUsers` for that company | |
| `markNotificationsReadAction` | organization.ts | session | |

### Server actions — Phase 2 (`src/actions/ledger.ts`)
| Action | Permission | Notes |
| --- | --- | --- |
| `createAccountAction`, `updateAccountAction` | `administrations.edit` | Number, category and type are fixed after creation; archiving requires zero balance and no drafts |
| `saveJournalAction`, `createDimensionAction` | `administrations.edit` | Journal type locked once the journal has entries |
| `saveEntryAction` | `ledger.create` / `ledger.edit` (+ `ledger.post` for "save and post") | Lines as JSON (`entrySchema`); idempotency key generated per form |
| `entryTransitionAction` (`submit`, `approve`, `post`, `delete`) | `ledger.create` / `ledger.approve` / `ledger.post` / `ledger.edit` | Approval: segregation of duties |
| `reverseEntryAction` (`reverse` or `correct`) | `ledger.reverse` | Reason required |

### Route handlers — Phase 2
| Route | Permission | Output |
| --- | --- | --- |
| `GET /api/ledger/trial-balance?fiscalYearId&fromPeriod&toPeriod&accountFrom&accountTo&journalId&hideZero` | `ledger.export` or `reports.export` | CSV (semicolon, UTF-8 BOM, formula-injection safe); audited |
| `GET /api/ledger/general-ledger?account&fiscalYearId&fromPeriod&toPeriod` | `ledger.export` or `reports.export` | CSV with running balance; audited |


### Server actions — Phase 3 (`src/actions/invoicing.ts`, `banking.ts`, `assets.ts`)
Every action re-checks the permission inside the module service for the company of the record (never the client's claim).

| Action | Permission | Notes |
| --- | --- | --- |
| `savePartyAction` | `sales.create` / `purchase.create` | Customer and/or supplier; KKF number, district, default BTW code and account |
| `saveInvoiceAction` | `sales.create` / `purchase.create` | Draft with per-line BTW; "save and post" also needs `.post` |
| `invoiceTransitionAction` (`submit`, `approve`, `post`, `delete`, `credit`) | `.create` / `.approve` / `.post` | Purchase approval threshold per administration; credit note = linked draft |
| `sendInvoiceAction` | `sales.edit` | SMTP when configured, otherwise an explicit "not configured" message; PDF via `GET /api/invoices/[id]/pdf` |
| `registerPaymentAction`, `offsetItemsAction` | `banking.post` / `sales.post` / `purchase.post` | Allocations are append-only; realised FX difference on foreign-currency items |
| `createFinancialAccountAction` | `administrations.edit` | Creates bank/cash account + ledger account + journal |
| `saveProfileAction`, `importStatementAction` | `banking.edit` / `banking.create` | CSV ≤ 2 MB; file hash and line hash prevent double import |
| `matchAction`, `bookAction`, `ignoreAction`, `transferAction`, `cashEntryAction` | `banking.post` | Matching may be partial; cash entries split BTW |
| `reconcileAction`, `approveReconciliationAction` | `banking.edit` / `banking.approve` | Approval by another user; only a reconciliation with zero difference |
| `registerAssetAction` | `assets.create` | Books the acquisition (Dr category asset account / Cr chosen counter account, default 0090) unless "already booked" |
| `proposeDepreciationAction`, `cancelDepreciationAction` | `assets.create` | Proposal = DRAFT entry in journal AFS (approval required) + one `DepreciationLine` per asset; posting via the entry (`ledger.approve`, `assets.post`) |
| `disposeAssetAction`, `transferAssetAction` | `assets.post` / `assets.edit` | Disposal requires depreciation posted up to the previous month; gain → 8095, loss → 4810 |
| `createCurrentAccountAction` | `currentAccounts.create` | Own control account (1351+ under 1300, shareholders 1651+ under 1600) |
| `currentAccountMovementAction`, `confirmCurrentAccountAction` | `currentAccounts.post` / `currentAccounts.edit` | Movements through the engine (source `CURRENT_ACCOUNT`); confirmations append-only with difference |

### Route handlers — Phase 3
| Route | Permission | Output |
| --- | --- | --- |
| `GET /api/invoices/[id]/pdf` | `sales.view` / `purchase.view` | BTW invoice PDF (Dutch/English labels) |

### Server actions — Phase 4 (`src/actions/industry.ts`)
| Action | Permission | Notes |
| --- | --- | --- |
| `createAdministrationAction` (`templateId`) | `administrations.create` | Applies the latest published version of the chosen template (default GENERAL) |
| `createCustomTemplateAction`, `importTemplateAction` | `industry.create` (org-scoped) | Creates a custom template with draft version 1; import ≤ 512 kB JSON |
| `addTemplateAccountAction`, `removeTemplateAccountAction`, `saveTemplateJsonAction` | `industry.edit` | Draft only; schema errors rejected, business issues reported |
| `newDraftAction` | `industry.edit` | One draft at a time, copied from the latest version |
| `publishTemplateAction`, `templateStatusAction` | `industry.manageSettings` | Publishing requires zero issues; published versions are immutable |
| `applyUpgradeAction` | `administrations.manageSettings` | Adds selected new items of the latest version; never changes existing rows |

### Route handlers — Phase 4
| Route | Permission | Output |
| --- | --- | --- |
| `GET /api/templates/versions/[id]/export` | `industry.view` | JSON document `{ format: "ara-industry-template", formatVersion: 1, code, name, version, contentHash, content }`; audited |

### Server actions — Phase 5 (`src/actions/currency.ts`)
| Action | Permission | Notes |
| --- | --- | --- |
| `createRateAction` | `currency.create` | 1 foreign = r base; one pending/approved rate per pair, type and date |
| `decideRateAction` (`APPROVED`/`REJECTED`) | `currency.approve` | Not by the person who entered the rate; decided rates are immutable |
| `importCbvsAction` | `currency.create` | CSV `datum;valuta;aankoop;verkoop` ≤ 1 MB → CBVS_BUY + CBVS_SELL (pending); duplicates skipped |
| `savePolicyAction` | `administrations.manageSettings` | `fxPolicySchema` (sales, purchase, revaluation, maxAgeDays, requireApproved, revaluationMode, monetaryAccounts) |
| `proposeRevaluationAction` | `currency.create` | Draft entry in the FX journal (approval required), source FX_REVALUATION |
| `revaluationStepAction` (`post`, `cancel`, `completeReversal`, `reverse`) | `currency.post` / `currency.create` | Post = engine post + automatic reversal per policy; reverse requires a reason |
| `saveInvoiceAction` (changed) | as before + `currency.edit` for a rate that differs from the policy rate | Empty rate = policy rate |

### Server actions — Phase 6 (`src/actions/budgets.ts`)
| Action | Permission | Notes |
| --- | --- | --- |
| `createBudgetAction` | `budgets.create` | Basis MANUAL / PRIOR_ACTUALS / PRIOR_BUDGET with adjustment %; version 1 as draft |
| `saveCellsAction` | `budgets.edit` | Inputs `c:<accountId>:<period>`, amounts in the user's locale; draft only |
| `distributeAction` | `budgets.edit` | EVEN or PRIOR_YEAR pattern, no lost cents |
| `importBudgetAction` | `budgets.edit` | CSV ≤ 1 MB, wide or long layout |
| `budgetWorkflowAction` (`submit`, `approve`, `return`, `newVersion`) | `budgets.edit` / `budgets.approve` | Approval by someone other than the submitter |

### Route handlers — Phase 6
| Route | Permission | Output |
| --- | --- | --- |
| `GET /api/budgets/[id]/report?from&to&v` | `budgets.export` or `reports.export` | CSV budget vs actual; audited |

### Server actions — Phase 7 (`src/actions/scan.ts`)
| Action | Permission | Notes |
| --- | --- | --- |
| `uploadDocumentAction` | `scan.create` | Files (PDF/JPG/PNG by magic bytes, ≤ 4.4 MB per request); several images → one PDF; runs extraction and automation |
| `confirmDocumentAction` | `scan.edit` (+ `purchase.create`) | Creates a draft purchase invoice; `acceptDuplicate` required when a duplicate is suspected |
| `rejectDocumentAction` | `scan.edit` | Reason required |
| `saveRuleAction`, `toggleRuleAction` | `automation.edit` | Modes SUGGEST / DRAFT / AUTO_POST (AUTO_POST needs `maxAmount`) |
| `setAiAction` | `organization.manageSettings` | Switching on needs the consent checkbox; stored in `Organization.settings.ai` |

### Route handlers — Phase 7
| Route | Permission | Output |
| --- | --- | --- |
| `GET /api/documents/[id]/file` | `scan.view` | The stored file inline, with `Content-Security-Policy: sandbox`, `nosniff`, `no-store` |

### Route handlers — Phase 8
| Route | Permission | Output |
| --- | --- | --- |
| `GET /api/reports/[kind]?format=pdf\|csv&from&to&fiscalYearId` — kind `pl`, `balance`, `cashflow`, `equity`, `kpis`, `pack` | `reports.export` | PDF (A4, fingerprint in the footer) or CSV (plain decimals); every export is archived in `ReportRun` with parameters and fingerprint |

Report pages (`/app/reports?view=…`) are read-only server components; they need `reports.view`.

### Server actions — Phase 9
| Action | Permission | Notes |
| --- | --- | --- |
| `startYearEndAction`, `checklistItemAction`, `adjustmentAction` (year-end) | `yearEnd.edit` (+ `ledger.create/post` for adjustments) | 24-item checklist; auto items only when their check passes; period-13 adjustments |
| `yearEndStepAction` (`submit`, `approve`, `return`, `close`, `reopen`) | `yearEnd.edit` / `yearEnd.approve` / `yearEnd.close` | Approval by another user; close = closing + next year + opening + verification in one transaction; reopen needs a reason |
| `prepareReturnAction` (BTW month, IB year, dividend) | `tax.edit` | Rule version selected by date (T1) |
| `adjustmentAction` (tax) | `tax.edit` | IB fiscal adjustments, draft only |
| `approveReturnAction` | `tax.approve` | Not by the preparer; acknowledgement for unverified rules (T2); explanation for a BTW difference; posts the settlement |
| `fileReturnAction` | `tax.edit` | Evidence file (PDF/JPG/PNG) + confirmation (T4) |
| `generateAnnualAction`, `saveNoteAction` | `annualAccounts.edit` | Draft only |
| `annualStepAction` (`submit`, `approve`, `return`, `finalize`) | `annualAccounts.edit` / `annualAccounts.approve` | Finalise needs a closed year and an unchanged ledger fingerprint |

### Route handlers — Phase 9
| Route | Permission | Output |
| --- | --- | --- |
| `GET /api/annual-accounts/[id]/pdf` | `annualAccounts.export` | Annual accounts PDF (statements, asset schedule, notes); audited |
