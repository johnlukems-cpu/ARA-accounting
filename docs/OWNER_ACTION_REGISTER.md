# ARA Accounting — Owner Action Register

Date: 2026-11-12 · Live status: **Platformbeheer → Productiegereedheid**. The static overview is in
[PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).

This register lists what only the owner (ARA Intelligent Solutions) or a qualified external professional can provide.
Nothing in it has been invented or filled in by development. No credential, price, bank detail or legal conclusion is
assumed anywhere in the code.

---

## Part A — Technical work development did independently (completed)

| ID | Work | Where | Verified by |
| --- | --- | --- | --- |
| T1 | Environment variable validation: presence and format only, values never printed. The build stops on errors. | `src/core/ops/env.ts`, `npm run check:env`, `scripts/vercel-build.mjs` | `tests/unit/ops.test.ts` |
| T2 | Neon configuration: pooled URL for the app, direct URL for migrations, TLS enforced, the pooler/direct mix-up detected. | `prisma/schema.prisma`, env checks | unit tests |
| T3 | Every deploy runs `migrate deploy` and then `migrate status`. The drift check runs in CI. | `scripts/vercel-build.mjs`, `.github/workflows/ci.yml` | CI |
| T4 | Backup and restore drill. | `scripts/backup-restore-drill.sh` | executed (PRODUCTION_AUDIT §4) |
| T5 | SMTP prepared: a connection and login check plus a test message. | `testEmailDelivery`, `npm run smtp:test`, readiness page | ready for O2 |
| T6 | Cron authentication: constant-time, fail closed without a secret or with a short one. | `src/core/ops/cron.ts` | unit tests |
| T7 | Application URL: only `APP_URL` or the Vercel domain, never the request's Host header; https origin enforced. | `appUrl()`, env checks | unit tests |
| T8 | Error monitoring: provider-neutral hook for every server error, redacted, with a webhook when configured. | `src/instrumentation.ts`, `src/core/ops/monitoring.ts` | ready for O11 |
| T9 | Structured production logging with redaction of secrets, personal data and amounts. | `src/core/ops/log.ts` | unit tests; guard test (no `console.*` elsewhere) |
| T10 | Tenant isolation review: every tenant table has RLS, or the app role has no access to it at all. | `tests/integration/readiness.test.ts` | integration test |
| T11 | Document security review: type sniffing, size limits, append-only storage, sandbox CSP, download throttling. | scan module, `throttle.ts` | existing and new tests |
| T12 | Authentication and permissions review: every server action and route authenticates. | `tests/unit/readiness-guards.test.ts` | guard test |
| T13 | No secrets in frontend code or in the built browser bundle. | guard test, `npm run check:bundle` (run after every build) | executed |
| T14 | Rate limits on uploads, exports, downloads and AI calls. | `src/core/ops/throttle.ts` | integration test |
| T15 | Configurable subscriptions: names, monthly and annual prices in SRD and USD, limits incl. storage, module access, trial length, status, customer preview. | Platformbeheer → Pakketten | integration tests |
| T16 | Compliance register with append-only evidence of external review. | Platformbeheer → Compliance | integration test |
| T17 | Bank format library with validation against real samples. | Platformbeheer → Bankformaten, `npm run bank:validate` | integration test |
| T18 | CI pipeline. | `.github/workflows/ci.yml` | first run on GitHub |

Still open on the development side, and not blocking the pilot:

- T19: Prisma 7 upgrade.
- T20: full organisation export (ZIP).
- T21: step-up MFA.

---

## Part B — Requirements that need the owner or an external professional

### O1 — Production database and secrets

| | |
| --- | --- |
| **What** | A Neon PostgreSQL 16 database (region US-East, next to Vercel `iad1`) connected to the Vercel project, plus `ENCRYPTION_KEY`, `CRON_SECRET` and `APP_URL`. |
| **Why** | Without them the application cannot store data, encrypt MFA secrets, run the daily checks, or build correct e-mail links. |
| **Who** | Owner (account holder of Vercel and Neon). |
| **Where** | Vercel → Project → Storage → Neon (sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED`). Vercel → Settings → Environment Variables (Production) for the other three:<br>• `ENCRYPTION_KEY`: `openssl rand -base64 32`; **keep a copy in a password manager**, MFA cannot be recovered without it.<br>• `CRON_SECRET`: `openssl rand -hex 32`.<br>• `APP_URL`: `https://<your domain>`. |
| **How tested** | The deploy runs `npm run check:env`, which fails on errors. `GET /api/health` returns 200. The readiness page shows O1 as *Completed*. |
| **Completion** | No configuration errors in Production; the first organisation can register; O1 is green on the live dashboard. |

### O2 — SMTP for e-mail

| | |
| --- | --- |
| **What** | SMTP host, port, TLS setting, user name, password and a real sender address on ARA's own domain (with SPF/DKIM set up for that domain). |
| **Why** | Invitations, password resets and e-mail verification. Without SMTP, links are shown once to administrators instead. |
| **Who** | Owner (or the e-mail provider). |
| **Where** | Vercel environment variables `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. |
| **How tested** | Platformbeheer → Productiegereedheid → **Testbericht sturen**: checks the connection and login, then sends a message to your own address. From a shell: `npm run smtp:test -- you@domain.sr`. Then test an invitation and a password reset. |
| **Completion** | Test message received; O2 shows *Completed* (it is recorded when the test succeeds). |

### O3 — Plans, prices, limits and trial length

| | |
| --- | --- |
| **What** | For each plan: a name and a monthly and/or annual price in SRD and/or USD; limits for companies, administrations, users, documents per month and storage in MB; which optional modules are included. Also the trial length in days. |
| **Why** | A commercial decision. Nothing is pre-filled; a plan without a price is shown as "price on request". |
| **Who** | Owner. |
| **Where** | Platformbeheer → **Pakketten**. A preview shows the plans exactly as customers see them. |
| **How tested** | Preview on the same page; assign a plan to a test organisation and check that the limits and modules apply. |
| **Completion** | At least one active plan with a price; trial length saved; O3 *Completed*. |

### O4 — ARA payment details for subscription invoices

| | |
| --- | --- |
| **What** | Bank name, account number per currency (SRD/USD), account holder, and the reference customers must quote. |
| **Why** | Subscriptions are paid by bank transfer and confirmed manually. Customers need the instructions. |
| **Who** | Owner. |
| **Where** | Platformbeheer → Pakketten → **Betaalinstructies**. They appear on every customer's subscription page. |
| **How tested** | Open **Abonnement** as a customer and check the text. |
| **Completion** | Instructions saved; O4 *Completed*. |

### O5 — Verification of tax rules (Surinamese tax adviser)

| | |
| --- | --- |
| **What** | A written opinion on every item in the checklist [COMPLIANCE_REVIEW_CHECKLIST.md](COMPLIANCE_REVIEW_CHECKLIST.md) §1–§2:<br>• BTW rates, codes and filing day;<br>• IB rate and rules;<br>• dividend tax;<br>• invoice requirements;<br>• the exchange rate for tax. |
| **Why** | The software computes taxes from configurable data. ARA Accounting must not claim compliance until a qualified adviser has confirmed the rules. |
| **Who** | A Surinamese tax adviser (engaged by the owner). |
| **Where** | Platformbeheer → **Compliance** → *Review vastleggen*: the adviser's name, qualification, date and letter reference, plus the decision per item. Keep the signed opinion in ARA's archive. |
| **How tested** | An approved tax rule shows *Geverifieerd*; tax returns based on it no longer ask for the unverified-rule acknowledgement. |
| **Completion** | Every tax rule and BTW code has an *Approved* review; O5 *Completed*. If the adviser asks for changes, the rule is corrected (a new rule version) and reviewed again. |

### O6 — Annual-accounts frameworks (SUVA-registered accountant)

| | |
| --- | --- |
| **What** | A review of the four frameworks: NV under the Wet op de Jaarrekening (S.B. 2017 no. 84) / IFRS for SMEs, NV under full IFRS, sole proprietorship/VOF, and foundation/association. The review covers the layout, accounting principles and draft notes. |
| **Why** | Annual accounts are a legal document; the draft texts are starting points only. |
| **Who** | A SUVA-registered accountant. |
| **Where** | Platformbeheer → Compliance (subject *Jaarrekeningkader*). Text changes are made by development based on the review. |
| **How tested** | Generate annual accounts for a test administration per framework and compare them with the accountant's comments. |
| **Completion** | All four frameworks *Approved*; O6 *Completed*. |

### O7 — Real bank statement samples

| | |
| --- | --- |
| **What** | For each bank customers use: one real **CSV export** from internet banking, plus the same period's statement (PDF or paper) with the number of transactions, total credited and total debited. An account of ARA itself or of a pilot customer who agrees is enough. |
| **Why** | ARA must not claim compatibility with a bank without testing a real file. No sample statements were made up. |
| **Who** | Owner (with a pilot customer if needed). |
| **Where** | Platformbeheer → **Bankformaten**:<br>1. Create a format: set the column layout.<br>2. Choose *Valideren*: upload the file and enter the three figures from the statement.<br>The file is not stored, only its hash and a summary. Offline alternative: `npm run bank:validate -- profile.json export.csv <count> <in> <out>`. See [BANK_IMPORT_VALIDATION.md](BANK_IMPORT_VALIDATION.md). |
| **How tested** | Validation succeeds only when the line count and both totals match the bank statement exactly. |
| **Completion** | A *Gevalideerd* format for every bank the pilot customers use. |

### O8 — Statutory retention period

| | |
| --- | --- |
| **What** | Confirmation of how long books, records and supporting documents must be kept under Surinamese law, and whether digital copies are allowed. |
| **Why** | The retention setting (10 years) is an assumption until confirmed; it governs deletion. |
| **Who** | A tax adviser or lawyer. |
| **Where** | Platformbeheer → Compliance (subject *Bewaartermijn*, and *Digitale bewaring* under *Overig*). |
| **How tested** | Review recorded; development aligns the retention setting if needed. |
| **Completion** | *Approved* review; O8 *Completed*. |

### O9 — Optional: AI recognition (Anthropic API key)

| | |
| --- | --- |
| **What** | An `ANTHROPIC_API_KEY` from ARA's Anthropic account. Before this, the owner decides that customer documents may be sent to this provider (organisations still switch AI on themselves, with consent). |
| **Why** | Recognition of photographed receipts. PDFs with a text layer work without it. |
| **Who** | Owner. |
| **Where** | Vercel environment variable `ANTHROPIC_API_KEY`. |
| **How tested** | Switch AI on in a test organisation and upload a photo of an invoice in ARA Scan. |
| **Completion** | Suggestions shown with provider and model; O9 *Completed* (live). |

### O10 — Off-site backups and the first restore drill on Neon

| | |
| --- | --- |
| **What** | Storage outside Neon for a daily logical backup (for example an S3-compatible bucket, or another cloud account under ARA's control), plus a scheduler that runs `pg_dump`. |
| **Why** | Neon point-in-time restore covers most incidents, but not the loss of the Neon account itself. |
| **Who** | Owner (choice and account of the storage). Development can set up the job once the storage exists. |
| **Where** | The storage provider; Neon (create a branch for the drill). |
| **How tested** | Run `SOURCE_URL=<Neon branch> TARGET_ADMIN_URL=<restore server>/postgres scripts/backup-restore-drill.sh`. All four checks must be OK. |
| **Completion** | First dump stored off-site and the drill passed. Record it in Platformbeheer → Productiegereedheid → *Bewijs vastleggen* (O10), with the date and storage location. |

### O11 — Error monitoring and alerting

| | |
| --- | --- |
| **What** | An account with a monitoring or alerting service that accepts a JSON webhook (e.g. Better Stack, a Slack incoming webhook, or a Sentry-compatible relay), and the https webhook URL. |
| **Why** | Without it, errors are only in the Vercel log and nobody is alerted. |
| **Who** | Owner. |
| **Where** | Vercel environment variable `ERROR_REPORT_URL`. |
| **How tested** | Platformbeheer → Productiegereedheid → **Testfout sturen**; the message must arrive. |
| **Completion** | Test error received; O11 *Completed* (recorded automatically). |

### O12 — External security test

| | |
| --- | --- |
| **What** | A DAST scan (for example HawkScan, which needs a StackHawk API key) or a penetration test by an independent tester, run against a production-like environment. |
| **Why** | The code review (ASVS L2) found no high-risk issue, but no dynamic test has been run. |
| **Who** | A security tester (engaged by the owner). |
| **Where** | Staging environment; the report goes in ARA's archive. |
| **How tested** | The report lists no open high or critical findings. Development fixes findings and has them re-tested. |
| **Completion** | Record it under *Bewijs vastleggen* (O12) with the report reference. |

### O13 — Terms of service and privacy statement

| | |
| --- | --- |
| **What** | Terms of service, a privacy statement and a data processing agreement for accounting firms, under Surinamese law. |
| **Why** | Needed before paying customers sign up. |
| **Who** | A lawyer (engaged by the owner). |
| **Where** | Development publishes the texts and adds an acceptance checkbox at registration once the texts exist. |
| **How tested** | The texts are reachable from the registration page; acceptance is recorded. |
| **Completion** | Record it under *Bewijs vastleggen* (O13). |
