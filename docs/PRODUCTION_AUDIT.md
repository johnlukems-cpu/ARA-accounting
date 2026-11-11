# ARA Accounting — Production Audit

Date: 2026-11-12 (update after the production-readiness work; first version 2026-11-11) · Scope: the code on `main` · Author: development (to be countersigned by the owner)

Only results from real runs are recorded here. Anything not verified is marked as such.

## 1. Verdict

**NOT production-ready.** ARA Accounting must not be marked production-ready while critical security, financial-integrity
or compliance requirements are unresolved.

**Technically ready for a controlled pilot** as soon as the four P1 pilot items that need the owner are closed:
- O1 production database and secrets;
- O2 SMTP;
- O10 off-site backups and the first restore drill on Neon;
- O11 error monitoring.

Everything development could do without external information is done (§6, Part A of OWNER_ACTION_REGISTER).

**General availability** additionally needs:
- O3 plans and prices;
- O4 payment details;
- O5 the tax rules verified by a Surinamese tax adviser;
- O6 the annual-accounts frameworks reviewed by a SUVA accountant;
- O12 an external security test;
- O13 terms of service and privacy statement.

Until O5 and O6 are done, the software makes no claim of compliance with Surinamese law. Every tax calculation shows
that its rules are unverified, and approving a return requires an explicit acknowledgement.

The live verdict per gate is on **Platformbeheer → Productiegereedheid**. The static mirror is
[PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).

| Area | Status |
| --- | --- |
| Functionality, Phases 0–11 (workflows 1–10) | ✅ complete, covered by integration and e2e tests |
| Ledger integrity (double entry, immutability, periods) | ✅ enforced in the database (triggers and constraints), not only in code |
| Tenant isolation | ✅ RLS with a non-bypass role. An automated test proves every table with organisation data has RLS and a policy, or no app-role access at all |
| Volume (≥ 1 M journal lines in one administration) | ✅ tested; within budget (§3) |
| Backup / restore | ✅ drill script executed (§4). ❌ off-site storage and the drill on Neon are open (O10) |
| Configuration safety | ✅ environment validation stops the deploy on errors; the bundle scan stops it when a secret reaches the browser |
| Monitoring and logging | ✅ redacted structured logs, error hook and webhook ready. ❌ monitoring account open (O11) |
| Security review (ASVS L2) | ⚠️ passed with documented gaps (§5) |
| Dependency audit | ⚠️ 1 advisory (deepmerge-ts via the Prisma CLI), accepted risk (§5.3) |
| Dynamic scan (DAST) / pentest | ❌ not run: no scanner credentials (O12) |
| Suriname compliance | ❌ 0 legal items verified. Review workflow and checklist ready (O5, O6, O8) |
| Bank import | ⚠️ configurable and validated against synthetic data only. No real bank sample yet (O7) |
| Owner decisions and credentials | ❌ open (§6) |

## 2. Test results (run 2026-11-12)

| Suite | Result |
| --- | --- |
| Unit (Vitest) | **137 / 137 passed**. New: environment validation, log redaction, cron authentication, plan module filter, bank sample validation, and static guards (no secrets in client code, no `console.*` outside the logger, every server action and route authenticates) |
| Integration (PostgreSQL 16) | **90 / 90 passed**. New: RLS coverage, platform tables closed to tenants, plans with modules and storage, trial setting, compliance reviews, bank format validation, throttling, readiness evaluation |
| End-to-end (Playwright, production build) | **26 / 26 passed** (+1 screenshot run skipped): 21 desktop workflows including Platformbeheer, plus the release walk-through in nl and en on desktop and on a phone |
| Load test (1 000 000 lines) | passed (§3; not re-run, no ledger query changed) |
| Browser bundle secret scan | passed |
| Typecheck, lint, production build, migration drift | passed |

Defects found in this round and fixed:

1. Labels on pages with several forms pointed at the field of another form, because field ids were not unique. This was
   an accessibility defect; ids are now scoped per form.
2. `.env.example` listed S3 and Blob variables that the code never uses (documents are stored in PostgreSQL); they are
   removed.
3. Uploads, exports and AI calls had no per-minute limit; one is added (§5.2).

**Release walk-through** (`tests/e2e/release.spec.ts`). In both languages and on both devices, a new organisation registers,
completes onboarding and opens **every page in the navigation**. A page fails on any of these:

- an HTTP error;
- the error boundary appearing;
- an untranslated message key;
- the page being wider than the screen.

The first run found three real defects, fixed in this phase:

1. Registering after choosing English left the user in Dutch. The chosen language now becomes the user's preference.
2. The trial-balance filters were 17 px wider than a 1280 px desktop. The filter row now wraps.
3. The application had no error page of its own, so a server error showed Next.js's English default. There is now a
   translated error boundary that shows only the error reference (digest), never the message or stack.

## 3. Load test

`npm run test:load` (`tests/load/ledger-volume.test.ts`, separate database `ara_accounting_load`).

- 250 000 posted entries with 4 lines each (**1 000 000 lines**) in one administration, spread over 12 periods and 40 accounts.
- The data is inserted with set-based SQL as drafts and then posted in bulk. Every database guard therefore runs on
  every row: the account and administration check, the period check and the deferred balance check.
- The test checks that the trial balance balances on the full volume.

| Operation (one administration, 1 M lines) | Before | After Phase 12 optimisation | Budget |
| --- | --- | --- | --- |
| Trial balance (full year) | 9.7 s | **3.7 s** | < 6 s |
| General ledger (1 account, 1 period) | 0.9 s | **1.5 s** | < 3 s |
| Financial statements (all reports + prior year + fingerprint) | 6.7 s | **4.3 s** | < 8 s |
| Quality scan (12 checks) | 4.7 s | **3.9 s** | < 10 s |
| Bulk load incl. all guards | 82 s | 75 s | — |

*Environment:* one local PostgreSQL 16 in a shared cloud container. When measured, the database held about 4 M lines
across several runs. Production (Neon) timings will differ and must be re-measured after go-live (release checklist).
The general-ledger figure varies between runs; it was not part of the optimisation.

*Optimisation:* the trial balance and the statements first aggregate posted lines per account and period, then join the
accounts. Before, the planner looked up 1 M entries one by one. The ledger fingerprint (SHA-256 over the included entry
ids) is now computed in PostgreSQL instead of fetching every id. An integration test proves the hash is identical to the
previous application-side calculation, so archived report runs stay comparable.

*Above this volume:* the next step is a per-account, per-period balance table maintained when an entry is posted. It is
not needed at 1 M lines per administration.

## 4. Backup / restore drill

`scripts/backup-restore-drill.sh` (needs `pg_dump`, `pg_restore` and `psql`). The script:

1. dumps the source (custom format);
2. restores it into a new database;
3. proves the copy is complete and still protected:

| Check | Result (source: the integration test database) |
| --- | --- |
| Row count of every table identical | OK |
| RLS policies / triggers / constraints / RLS-enabled tables identical | OK (70 / 36 / 159 / 62) |
| Every posted entry balanced in the copy | OK |
| Audit log identical (row count and a digest over the whole hash chain) | OK (12 749 rows) |
| Dump / restore time | 6.2 MB in < 1 s / 4 s |

For production:

- Neon point-in-time restore is the primary recovery path.
- Run this script quarterly against a Neon branch, and keep the dump in separate storage (owner item: choose the storage).

## 5. Security review — OWASP ASVS 4.0.3, level 2 (abridged)

Method: a code review of every chapter against the implementation, with the evidence below. "Gap" items are tracked in
§7. No dynamic scan was run (no scanner credentials).

| ASVS chapter | Verdict | Evidence / gap |
| --- | --- | --- |
| V1 Architecture | Pass | Documented trust boundaries (ARCHITECTURE.md). Tenant isolation in the database. Ledger rules enforced by triggers. |
| V2 Authentication | Pass with gaps | scrypt; at least 12 characters; TOTP MFA with recovery codes, required for administrators; login, MFA, registration and reset rate limits; constant-time handling of unknown accounts. **Gap:** no breached-password check (V2.1.7). |
| V3 Session management | Pass | 256-bit random token, only the hash stored; `HttpOnly`, `Secure` (production), `SameSite=Lax`; 2 h idle and 12 h absolute; other sessions revoked on a password or MFA change. |
| V4 Access control | Pass | Permission check on the server in every action and route; RLS as a second line; object ids re-resolved inside the tenant; segregation of duties for approvals; platform admins get no implicit access to customer books. |
| V5 Validation, sanitisation, encoding | Pass | Zod on every input; decimal strings for amounts; React output encoding; parameterised SQL (`$queryRaw` tagged templates; the only `…Unsafe` calls are in the load test); CSV formula-injection guard. |
| V6 Cryptography | Pass | AES-256-GCM for MFA secrets (`ENCRYPTION_KEY`); SHA-256 for tokens and the audit chain; no custom cryptography. |
| V7 Errors and logging | Pass (owner item open) | Translated error boundary shows only the digest. Structured, redacted logging (`src/core/ops/log.ts`). Every server error goes through `onRequestError` to the monitoring hook. The audit hash chain is verified on the audit page and daily by the cron job. **Open:** connect a monitoring account (O11). |
| V8 Data protection | Pass with gap | `Cache-Control: no-store` on downloads and exports; no secrets in the repository. **Gap:** no self-service export of a whole organisation (ZIP); the retention period for books in Suriname is not verified. |
| V9 Communications | Pass (platform) | TLS and HSTS (preload-ready) through Vercel. |
| V10 Malicious code | Pass | Lockfile committed; dependencies pinned for the AI SDK and PDF parser. |
| V11 Business logic | Pass | Double entry, period locks, gapless numbering, idempotency keys, segregation of duties, approval workflows. All are enforced in the database or the service layer and covered by tests. |
| V12 Files | Pass with gap | Magic-byte type check (PDF, JPEG, PNG); 20 MB limit (database CHECK); files served only through an authorised route with `Content-Security-Policy: sandbox` and `nosniff`. **Gap:** no virus scanning (no scanner on Vercel functions). |
| V13 API | Pass | No public API. Server actions are protected by Next.js origin checks and a guard test proves each one authenticates. The cron route fails closed (secret of at least 32 characters, constant-time comparison). Exports and downloads are rate-limited (HTTP 429). |
| V14 Configuration | Pass | Nonce-based CSP with `strict-dynamic`; X-Frame-Options DENY; nosniff; Referrer-Policy; Permissions-Policy; `poweredByHeader` off. Environment validation at build and start; the bundle scan proves no secret reaches the browser. CI pipeline (`.github/workflows/ci.yml`). |

### 5.1 Corrections to SECURITY.md

The review found several statements in `SECURITY.md` that described the **design** and not the code: support grants
and impersonation, rate limits on uploads, exports and AI, a ClamAV adapter, a Sentry hook, an organisation ZIP export,
step-up MFA, and a dependency audit in CI. `SECURITY.md` now has a "Status at release" section that lists them as not
implemented.

### 5.2 Rate limiting beyond authentication (closed)

`src/core/ops/throttle.ts` (database-backed, so it holds across serverless instances), per 10 minutes:

| Kind | Per user | Per organisation |
| --- | --- | --- |
| Uploads | 60 | 300 |
| Exports | 60 | 300 |
| Downloads | 300 | 1 500 |
| AI calls | 40 | 120 |

Above the AI limit, documents are still processed with the text layer only.

### 5.3 Dependency audit

`npm audit --omit=dev`: 3 findings, all the same advisory, **GHSA-ggr8-5vv4-36mx** (deepmerge-ts < 8, stack exhaustion
on recursive object graphs). It enters through `prisma` → `@prisma/config`.

- **Reachability.** The Prisma CLI's config loader runs only during `prisma generate` and `prisma migrate deploy` on
  build, on the repository's own trusted configuration. Request handling does not use it.
- **Fix.** Prisma 7 (breaking: driver adapters, a new client generator, `prisma.config.ts`).
- **Decision.** Accepted for go-live. Upgrading the data layer of a finished, fully tested accounting system on release
  day is the larger risk. Plan the Prisma 7 upgrade as the first maintenance release, with the full integration suite as
  the gate.

## 6. Owner items

The full register, with what, why, who, where, how tested and completion, is in
[OWNER_ACTION_REGISTER.md](OWNER_ACTION_REGISTER.md):

| # | Item | Gate |
| --- | --- | --- |
| O1 | Neon production database; `ENCRYPTION_KEY`, `CRON_SECRET`, `APP_URL` in Vercel | Pilot (P1) |
| O2 | SMTP credentials | Pilot (P1) |
| O3 | Plans, prices, limits, trial length | GA (P1) |
| O4 | ARA payment details for subscription invoices | GA (P1) |
| O5 | Verification of all tax rules and BTW codes by a Surinamese tax adviser | GA (P1) |
| O6 | Review of the annual-accounts frameworks by a SUVA-registered accountant | GA (P1) |
| O7 | Real statement samples from the local banks | GA (P2) |
| O8 | Statutory retention period | GA (P2) |
| O9 | Optional `ANTHROPIC_API_KEY` | later |
| O10 | Off-site backup storage and the first restore drill on Neon | Pilot (P1) |
| O11 | Error monitoring account and webhook | Pilot (P1) |
| O12 | External security test (DAST or pentest) | GA (P1) |
| O13 | Terms of service and privacy statement | GA (P1) |

## 7. Known limitations and next maintenance release

1. Prisma 7 upgrade, which closes the deepmerge-ts advisory (T19).
2. Self-service organisation export as a ZIP of CSV files and documents (T20).
3. Step-up MFA for closing a year and for bulk exports (T21).
4. A breached-password check. It needs a decision on sending password-hash prefixes to an external service.
5. Virus scanning for uploads through an external scanning service (owner choice).
6. Bank exports in PDF, Excel or MT940 formats, if a bank offers only those (decided after O7).
7. Features that were deferred:
   - direct cash-flow method;
   - an `.xlsx` writer;
   - custom report templates;
   - electronic filing (no public API at the Belastingdienst);
   - a CBvS rate feed (no public API).

## 8. Release checklist

See [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md).
