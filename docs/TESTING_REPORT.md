# ARA Accounting — Testing Report

Only results from real runs are recorded here. Environment: Node 22, PostgreSQL 16.15 (local), Chromium (Playwright 1.63).

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
