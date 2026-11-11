# ARA Accounting — Production Readiness

Generated from `src/modules/readiness/register.ts` by `npm run readiness:report`. The **live** dashboard is in the
application: **Platformbeheer → Productiegereedheid** (platform administrators). It re-checks configuration, plans,
compliance reviews, bank formats and recorded evidence in the running environment, so it can show items as completed
that are still open here.

## Gates

| Gate | Verdict | Open P1 items |
| --- | --- | --- |
| Controlled pilot | **NOT READY** | O1, O2, O10, O11 |
| General availability | **NOT READY** | O1, O2, O3, O4, O5, O6, O10, O11, O12, O13 |

Status counts: ✅ Completed 18 · 🔄 In progress 0 · ⏳ Waiting for owner input 8 · ⏳ Waiting for external specialist 5 · ⛔ Blocked 0 · ◻️ Not started 3

## Owner and external specialists

| ID | Requirement | Status | Responsible | Priority · gate | Depends on | Acceptance criterion |
| --- | --- | --- | --- | --- | --- | --- |
| O1 | Production database (Neon) and secrets in Vercel | ⏳ Waiting for owner input | Owner (ARA) | P1 · Pilot | T1, T2 | npm run check:env without errors in Production; /api/health returns 200. |
| O2 | SMTP credentials | ⏳ Waiting for owner input | Owner (ARA) | P1 · Pilot | O1, T5 | Test message from Platformbeheer received; invitation and password reset work. |
| O3 | Plans, prices, limits and trial length | ⏳ Waiting for owner input | Owner (ARA) | P1 · General availability | T15 | At least one active plan with a price; trial length set. |
| O4 | ARA payment details for subscription invoices | ⏳ Waiting for owner input | Owner (ARA) | P1 · General availability | O3 | Payment instructions set and visible on the subscription page. |
| O5 | Tax rules verified by a Surinamese tax adviser | ⏳ Waiting for external specialist | Tax adviser | P1 · General availability | T16 | All tax rules and BTW codes have an approved review. |
| O6 | Annual-accounts frameworks reviewed by a SUVA accountant | ⏳ Waiting for external specialist | SUVA accountant | P1 · General availability | T16 | All four frameworks approved, or changed and reviewed again. |
| O7 | Real sample files from the local banks | ⏳ Waiting for owner input | Owner (ARA) | P2 · General availability | T17 | A validated format for every bank customers use. |
| O8 | Statutory retention period for books and records | ⏳ Waiting for external specialist | Tax adviser | P2 · General availability | T16 | Approved review of the retention period. |
| O9 | Optional: ANTHROPIC_API_KEY for AI recognition | ⏳ Waiting for owner input | Owner (ARA) | P3 · Later | O1 | A scanned photo is recognised in ARA Scan with AI switched on. |
| O10 | Off-site backup storage and first restore drill on Neon | ⏳ Waiting for owner input | Owner (ARA) | P1 · Pilot | O1, T4 | Daily dump outside Neon; restore drill passed and recorded. |
| O11 | Error monitoring / alerting account | ⏳ Waiting for owner input | Owner (ARA) | P1 · Pilot | O1, T8 | ERROR_REPORT_URL set; a test error arrives. |
| O12 | External security test (DAST or penetration test) | ⏳ Waiting for external specialist | Security tester | P1 · General availability | O1 | Report without open high or critical findings. |
| O13 | Terms of service and privacy statement | ⏳ Waiting for external specialist | Lawyer | P1 · General availability | — | Published and accepted by customers at registration. |

## Independent technical work (development)

| ID | Requirement | Status | Responsible | Priority · gate | Depends on | Acceptance criterion |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | Environment variable validation | ✅ Completed | Development | P1 · Pilot | — | The build fails on missing or invalid secrets; values are never printed.<br>*Evidence:* src/core/ops/env.ts · npm run check:env · build stops on errors |
| T2 | Neon PostgreSQL configuration (pooled + direct, TLS) | ✅ Completed | Development | P1 · Pilot | — | Pooled URL for the app, direct URL for migrations, sslmode=require enforced.<br>*Evidence:* prisma/schema.prisma (url + directUrl) · env checks sslRequired/neonNotPooled/pooledDirect |
| T3 | Database migration verification on every deploy | ✅ Completed | Development | P1 · Pilot | — | No failed or pending migrations; no drift between schema and migrations.<br>*Evidence:* scripts/vercel-build.mjs (migrate deploy + migrate status) · drift check in CI |
| T4 | Backup and restore procedure | ✅ Completed | Development | P1 · Pilot | — | Restore drill proves identical rows, RLS, balances and audit chain.<br>*Evidence:* scripts/backup-restore-drill.sh · DEPLOYMENT_GUIDE |
| T5 | SMTP integration prepared (connection test + test message) | ✅ Completed | Development | P1 · Pilot | — | Once SMTP is set, a platform admin can send a test message with one click.<br>*Evidence:* testEmailDelivery · npm run smtp:test · Platformbeheer → Gereedheid |
| T6 | Cron authentication (fail closed, constant time) | ✅ Completed | Development | P1 · Pilot | — | Without or with a short CRON_SECRET every call is refused.<br>*Evidence:* src/core/ops/cron.ts · unit tests |
| T7 | Application URL handling | ✅ Completed | Development | P1 · Pilot | — | E-mail links only use the configured https origin.<br>*Evidence:* appUrl() uses APP_URL / Vercel domain, never the Host header · env check httpsRequired/originOnly |
| T8 | Error monitoring prepared (provider-neutral) | ✅ Completed | Development | P1 · Pilot | — | Every server error is logged redacted and sent to the webhook once configured.<br>*Evidence:* src/instrumentation.ts onRequestError · src/core/ops/monitoring.ts · ERROR_REPORT_URL |
| T9 | Production logging without sensitive data | ✅ Completed | Development | P1 · Pilot | — | Logs hold ids and codes, never passwords, tokens, e-mail addresses or amounts.<br>*Evidence:* src/core/ops/log.ts · unit tests (redaction) · guard test: no console.* outside the logger |
| T10 | Tenant isolation review | ✅ Completed | Development | P1 · Pilot | — | Every table with organisation data has RLS; cross-tenant access is proven impossible.<br>*Evidence:* tests/integration/readiness.test.ts (every table with organizationId has RLS) · phase 1 isolation tests |
| T11 | Document security review | ✅ Completed | Development | P1 · Pilot | — | Files only via an authorised route, with sandbox CSP and limits.<br>*Evidence:* magic-byte check, 20 MB CHECK, append-only files, sandbox CSP, download throttle |
| T12 | Authentication and permission review | ✅ Completed | Development | P1 · Pilot | — | Every server action checks session and permission; platform actions only for platform admins.<br>*Evidence:* tests/unit/readiness-guards.test.ts (every server action authenticates) · PRODUCTION_AUDIT §5 |
| T13 | No secrets in frontend code | ✅ Completed | Development | P1 · Pilot | — | No secret variable in client code or in the built browser bundle.<br>*Evidence:* guard test: no process.env in client components · env check publicSecret · scripts/check-bundle.mjs |
| T14 | Rate limits on uploads, exports, downloads and AI | ✅ Completed | Development | P2 · Pilot | — | Scripts and loops are refused after the limit (HTTP 429); AI falls back to the text layer.<br>*Evidence:* src/core/ops/throttle.ts |
| T15 | Configurable subscription management | ✅ Completed | Development | P1 · Pilot | — | The owner configures plans without code; no hard-coded prices.<br>*Evidence:* Platformbeheer → Pakketten (prijzen maand/jaar, limieten, opslag, modules, proefduur, voorbeeld) |
| T16 | Compliance register and external review records | ✅ Completed | Development | P1 · Pilot | — | A rule is only 'verified' with the adviser's name, qualification, date and reference.<br>*Evidence:* Platformbeheer → Compliance · ComplianceReview (append-only) · docs/COMPLIANCE_REVIEW_CHECKLIST.md |
| T17 | Bank format library and validation | ✅ Completed | Development | P1 · Pilot | — | A format is only 'validated' after a real file whose count and totals equal the bank statement.<br>*Evidence:* Platformbeheer → Bankformaten · npm run bank:validate · docs/BANK_IMPORT_VALIDATION.md |
| T18 | CI pipeline (lint, typecheck, tests, drift, audit) | ✅ Completed | Development | P2 · Pilot | — | Every push runs all checks against PostgreSQL 16.<br>*Evidence:* .github/workflows/ci.yml |
| T19 | Upgrade to Prisma 7 (deepmerge-ts advisory) | ◻️ Not started | Development | P3 · Later | — | npm audit clean; all suites green.<br>*Evidence:* PRODUCTION_AUDIT §5.3 |
| T20 | Full organisation export (ZIP) | ◻️ Not started | Development | P2 · General availability | — | The owner downloads all data and documents in one file. |
| T21 | Step-up MFA for year-end closing and bulk export | ◻️ Not started | Development | P3 · Later | — | Sensitive actions ask for a fresh MFA code. |

Details per owner item: [OWNER_ACTION_REGISTER.md](OWNER_ACTION_REGISTER.md).
