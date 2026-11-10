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

