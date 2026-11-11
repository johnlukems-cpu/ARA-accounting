# ARA Accounting — Production Audit (Phase 12)

Date: 2026-11-11 · Scope: the code on `main` after Phase 12 · Author: development (to be countersigned by the owner)

Only results from real runs are recorded here. Anything not verified is marked as such.

## 1. Verdict

**Technically ready for a controlled go-live (pilot customers), and NOT ready for general availability until the owner items in §6 are closed.**

The application, its database guards and its tests are complete for Phases 0–12. The blockers left are not code: they are
decisions and credentials that only the owner can provide (production database and secrets, SMTP, prices and plans,
and verification of the tax rules and annual-accounts texts by qualified Surinamese advisers). Until the tax rules are
verified, the product already labels every tax calculation as unverified. It does not hide that.

| Area | Status |
| --- | --- |
| Functionality, Phases 0–11 (workflows 1–10) | ✅ complete, covered by integration and e2e tests |
| Ledger integrity (double entry, immutability, periods) | ✅ enforced in the database (triggers and constraints), not only in code |
| Tenant isolation | ✅ PostgreSQL RLS with a non-bypass role; proven by integration tests |
| Volume (≥ 1 M journal lines in one administration) | ✅ tested; within budget after a query optimisation (§3) |
| Backup / restore | ✅ drill script written and executed successfully (§4) |
| Security review (ASVS L2) | ⚠️ passed with documented gaps (§5); no high-risk open item in application code |
| Dependency audit | ⚠️ 1 advisory (deepmerge-ts via the Prisma CLI), accepted risk (§5.3) |
| Dynamic scan (DAST) | ❌ not run: no HawkScan / StackHawk API key in this environment |
| Owner decisions and credentials | ❌ open (§6) |

## 2. Test results (final run, 2026-11-11)

| Suite | Result |
| --- | --- |
| Unit (Vitest) | **116 / 116 passed** |
| Integration (PostgreSQL 16) | **81 / 81 passed** |
| End-to-end (Playwright, production build) | **24 / 24 passed**: 20 desktop workflow tests, plus the release walk-through in nl and en on desktop **and** on a phone (Pixel 7) |
| Load test (1 000 000 lines) | **passed** (§3) |
| Typecheck, lint, production build, migration drift | passed |

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
| V7 Errors and logging | Pass with gap | Translated error boundary shows only the digest. Append-only audit log with a hash chain, verified on the audit page **and now daily by the cron job** (a broken chain is logged). **Gap:** no external error monitoring (Sentry or similar) connected. |
| V8 Data protection | Pass with gap | `Cache-Control: no-store` on downloads and exports; no secrets in the repository. **Gap:** no self-service export of a whole organisation (ZIP); the retention period for books in Suriname is not verified. |
| V9 Communications | Pass (platform) | TLS and HSTS (preload-ready) through Vercel. |
| V10 Malicious code | Pass | Lockfile committed; dependencies pinned for the AI SDK and PDF parser. |
| V11 Business logic | Pass | Double entry, period locks, gapless numbering, idempotency keys, segregation of duties, approval workflows. All are enforced in the database or the service layer and covered by tests. |
| V12 Files | Pass with gap | Magic-byte type check (PDF, JPEG, PNG); 20 MB limit (database CHECK); files served only through an authorised route with `Content-Security-Policy: sandbox` and `nosniff`. **Gap:** no virus scanning (no scanner on Vercel functions). |
| V13 API | Pass | No public API. Server actions are protected by Next.js origin checks. The cron route uses a constant-time secret comparison. |
| V14 Configuration | Pass | Nonce-based CSP with `strict-dynamic`; X-Frame-Options DENY; nosniff; Referrer-Policy; Permissions-Policy; `poweredByHeader` off. |

### 5.1 Corrections to SECURITY.md

The review found several statements in `SECURITY.md` that described the **design** and not the code: support grants
and impersonation, rate limits on uploads, exports and AI, a ClamAV adapter, a Sentry hook, an organisation ZIP export,
step-up MFA, and a dependency audit in CI. `SECURITY.md` now has a "Status at release" section that lists them as not
implemented.

### 5.2 Rate limiting beyond authentication

Uploads are capped per month by the plan's `documentsPerMonth` limit and by the request size limit. There is no
per-minute limit on uploads, exports or AI calls. The risk is cost and abuse by an authenticated user, not data
exposure. It is planned in §7.

### 5.3 Dependency audit

`npm audit --omit=dev`: 3 findings, all the same advisory, **GHSA-ggr8-5vv4-36mx** (deepmerge-ts < 8, stack exhaustion
on recursive object graphs). It enters through `prisma` → `@prisma/config`.

- **Reachability.** The Prisma CLI's config loader runs only during `prisma generate` and `prisma migrate deploy` on
  build, on the repository's own trusted configuration. Request handling does not use it.
- **Fix.** Prisma 7 (breaking: driver adapters, a new client generator, `prisma.config.ts`).
- **Decision.** Accepted for go-live. Upgrading the data layer of a finished, fully tested accounting system on release
  day is the larger risk. Plan the Prisma 7 upgrade as the first maintenance release, with the full integration suite as
  the gate.

## 6. Owner items (blocking general availability)

| # | Item | Why it blocks |
| --- | --- | --- |
| O1 | Neon production database; `ENCRYPTION_KEY`, `CRON_SECRET`, `APP_URL` in Vercel | No production environment without them |
| O2 | SMTP credentials (`SMTP_*`) | Invitations, password resets and e-mail verification are shown as one-time links without e-mail |
| O3 | Plans, prices, limits and trial length (`TRIAL_DAYS`) | Commercial decision; nothing is seeded |
| O4 | ARA's bank details for subscription invoices | Needed on the invoices |
| O5 | **Verification of all tax rules** (BTW rates and filing day, IB rates, dividend tax) by a Surinamese tax adviser | Rules are marked unverified until then |
| O6 | **Review of the annual-accounts frameworks and draft notes** by a SUVA-registered accountant | Texts are draft starting points |
| O7 | Sample statement files from the local banks (DSB, Hakrinbank, Finabank, Republic Bank, Southern Commercial Bank) | Import profiles are configurable but not yet tested against real files |
| O8 | Retention period for books and records under Surinamese law | Retention setting is PENDING_VERIFICATION |
| O9 | Optional: `ANTHROPIC_API_KEY` | AI recognition for scanned images; PDFs with a text layer work without it |
| O10 | Off-site backup storage for the logical dumps | Needed for the quarterly drill |
| O11 | Error-monitoring account (e.g. Sentry) | Needed to close the V7 gap |
| O12 | A DAST scan (HawkScan/StackHawk API key, or an external pentest) | Not possible in this environment |

## 7. Known limitations and next maintenance release

1. Prisma 7 upgrade (closes the deepmerge-ts advisory).
2. Error monitoring integration (V7) once O11 is chosen.
3. Per-minute rate limits on uploads, exports and AI calls.
4. A breached-password check (k-anonymity range API, or a bundled list).
5. Self-service organisation export (ZIP: CSV + documents).
6. Virus scanning for uploads through an external scanning service.
7. Step-up MFA for closing a year and for bulk exports.
8. Features that were deferred:
   - direct cash-flow method;
   - an `.xlsx` writer;
   - custom report templates;
   - electronic filing (no public API at the Belastingdienst);
   - a CBvS rate feed (no public API).

## 8. Release checklist

See [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md).
