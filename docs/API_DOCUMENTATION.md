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
