# ARA Accounting — Project Status

| Item | Value |
| --- | --- |
| Current phase | **4 — Industry templates (next)** |
| Completed | 0 — Architecture · 1 — Foundation · 2 — Accounting core · **3 — Financial operations** |
| Last update | 2026-11-11 |

## Phase 3 — Financial operations: COMPLETED (2026-11-11)

**Features:**
- **Relations** — customers and suppliers with KKF number, district and default BTW code/account.
- **Invoices** — sales and purchase invoices with BTW per line. BTW codes are data with a legal status: BTW10/BTW25/BTW0 = SOURCE_FOUND; exempt and import = PENDING_VERIFICATION. Draft → approval (purchase threshold) → posting through the engine. Credit notes; BTW invoice PDF; e-mail through SMTP, or an explicit "not configured" message.
- **Open items** — open items and append-only allocations; payments on account; offsetting; realised exchange differences; aging with configurable buckets; check of the sub-ledger against the control account.
- **Bank and cash** — accounts per Surinamese bank; CSV import with a column profile per account; duplicate detection by file and line hash; match suggestions; partial matching; booking to an account; ignore; cash book with BTW split; transfers/cambio with exchange difference; reconciliation with approval by a second user.
- **Current accounts** — current accounts with directors, shareholders, related parties and group companies, each with its own control account; movements through the engine; statement; balance confirmations with the difference.
- **Fixed assets** — 5 standard categories; registration with an acquisition entry (clearing account 0090); straight-line and declining-balance schedules (decimal, no lost cents); monthly depreciation proposals that need approval (journal AFS) and never twice per asset/month; withdrawing a proposal; disposal or sale with gain (8095) or loss (4810), only once depreciation is up to date; transfer; asset register with cost, accumulated depreciation and book value per date.

**Migrations:** `phase3_operations`, `phase3_integrity`, `phase3b_banking`, `phase3b_integrity`, `phase3c_assets_current_accounts`, `phase3c_integrity`. They add RLS on all new tables, CHECK constraints, append-only triggers, and a guard that blocks changing depreciation lines of posted entries. Schema and migrations were verified identical.

**Tests:** 71 unit, 45 integration and 10 e2e tests, all passing. Typecheck, lint and build pass.

**Outstanding:**
- interest calculation on current accounts (the agreement is recorded, but there is no automatic interest entry);
- impairment and revaluation of assets;
- linking an asset directly to a purchase invoice line (the invoice is booked on 0090 for now);
- bank-specific CSV profiles once sample files from DSB, Hakrinbank, Finabank and others are available;
- fiscal depreciation (Phase 9).

**Next phase:** 4 — industry templates.

## Phase 2 — Accounting core: COMPLETED (2026-11-10)

**Features:** standard Surinamese chart of accounts (hierarchical, categories, normal side, control accounts, currency restriction) and 11 journals per administration; account management (create, rename, re-parent, archive with balance check); journals (approval flag) and dimensions (cost centre, project, department); accounting engine in `src/core/ledger` (draft → submit → approve with segregation of duties → post, gapless numbers per journal and fiscal year, idempotency keys, control-account rule, period rules 0/1–12/13, soft-closed periods, foreign-currency lines with rounding line, reversal and correction entries); database triggers for immutability, balance, closed periods and account ownership; journal-entry list (filters, search, pagination), entry editor with live balance, entry detail with history; trial balance (opening/movement/closing, fiscal year, period range, account range, journal filter, zero rows) with drill-down to the general ledger card (running balance) and to entries; CSV exports (audited); period closing blocked while unposted entries exist; lint rule that only the engine writes journal entries.

**Migrations:** `20261110205336_phase2_ledger`, `20261110205400_phase2_ledger_integrity` (schema and migrations verified identical with `prisma migrate diff`).
**Tests:** 54 unit, 29 integration, 6 e2e — all passed.
**Outstanding:** year-end closing entries themselves (period 13 workflow) are Phase 9; PDF/Excel exports are Phase 8; account-period balance snapshots only if load tests require them (Phase 12).
**Next phase:** 3 — relations (customers/suppliers), sales and purchase invoices with BTW codes, open items and payment allocation, aging, bank/cash with CSV import and matching, current accounts, fixed assets and depreciation.

## Phase 1 — Foundation: COMPLETED (2026-11-10)

**Features implemented**
- PostgreSQL schema + migrations: users, sessions, tokens, login attempts, organisations (business / accounting firm), roles and permissions, memberships, companies (legal form, KKF, tax and BTW numbers, district), company assignments, branches, administrations (base currency SRD default), fiscal years (calendar or deviating), periods 0–13, append-only hash-chained audit log, notifications
- Tenant isolation: `ara_app` role without BYPASSRLS, RLS policies on all tenant tables, `withTenant` per transaction
- Authentication: registration, login, logout, sessions (hashed token, idle 2 h, absolute 12 h), password reset (e-mail when SMTP is configured, otherwise a one-time admin link), e-mail verification (when SMTP is configured), invitations, MFA (TOTP + recovery codes) with organisation enforcement and 7-day grace period, rate limiting, CSP with nonce
- Permissions: 9 tenant roles + platform-administrator flag, module.action permissions (view/create/edit/approve/post/reverse/export/close/manage), organisation-wide vs per-company assignment; enforced in services and actions
- UI (nl/en): login, register, MFA, forgot/reset password, invitation, onboarding (company → administration), app shell (sidebar, organisation/company/administration/fiscal-year switchers, search, notifications, user), dashboard, organisation profile and settings, companies (create, edit, archive, branches, administrations, staff access), administration (fiscal years, period open/soft-close/close/reopen), users (invite, role, deactivate, reset link), audit log with chain verification, account (profile, language, password, MFA), notifications, search, 404 page

**Database migrations:** `20261110202605_phase1_foundation`, `20261110202700_phase1_security`
**Tests:** 47 unit, 12 integration, 4 e2e — all passed (see docs/TESTING_REPORT.md)
**Outstanding / limitations**
- Platform administrator area (organisations, subscriptions, global account deactivation) is Phase 11; the `isPlatformAdmin` flag exists.
- Custom roles per organisation: the data model supports them, no UI yet.
- E-mail delivery needs SMTP settings (none configured); until then invitation and reset links are shown once to administrators.
- Breached-password check and step-up MFA for sensitive actions: planned (Phase 12 / with those actions).
**Security considerations:** see docs/SECURITY.md (RLS, scrypt, AES-GCM, CSP, rate limits, audit chain).
**Deployment:** add the Neon database and `ENCRYPTION_KEY` in Vercel (docs/DEPLOYMENT_GUIDE.md); the build then migrates automatically.
**Next phase:** 2 — chart of accounts, journals, ledger engine with DB-enforced balance and immutability, opening balances, general ledger, trial balance, period locks.

## Phase 0 checkpoint

**Implemented features:** none (architecture phase; no application code by design).

**Created files**
- `README.md`
- `PROJECT_STATUS.md`
- `docs/ARCHITECTURE.md`: audit findings, stack, layers, tenancy, ledger engine, module dependency diagram, integrations, deployment, open decisions
- `docs/DATABASE_SCHEMA.md`: three ERDs, model catalogue (≈ 90 models), DB-level safeguards
- `docs/ACCOUNTING_RULES.md`: binding ledger, period, sub-ledger, FX, asset, tax, budget, reporting and AI rules
- `docs/SECURITY.md`
- `docs/API_DOCUMENTATION.md`: conventions only
- `docs/SURINAME_MARKET.md`: Suriname market profile (terminology, legal forms, KKF/BTW identifiers, districts, CBvS rates, banks, BTW, profit tax, dividend tax, Wet op de Jaarrekening, industry templates, invoicing, calendar), with sources and verification status
- `docs/DEVELOPMENT_ROADMAP.md`: phases 0–12 with exit criteria, risk register (R1–R14)

**Modified files:** none. **Database changes:** none. **API changes:** none.
**Tests executed:** none (no code yet).

**Audit inputs**
- Session working directory: empty.
- `ARA-Intelligent-Solutions` (website, commit `144dd55`): no app code.
- `ara-payroll` (commit `656732a`): reference stack and reusable patterns. See ARCHITECTURE §1.

**Outstanding decisions (product owner)**
1. ~~Create the GitHub repository~~ Done: `johnlukems-cpu/ARA-accounting`.
2. ~~Hosting target~~ **Decided: Vercel** (region `iad1`, managed PostgreSQL, S3/Vercel Blob, job table + Vercel Cron).
3. ARA Scan AI provider and default consent policy.
4. First annual-accounts templates (NV under S.B. 2017 no. 84 on an IFRS for SMEs basis; eenmanszaak/VOF; stichting/kerkgenootschap).
5. Appoint a Surinamese tax advisor and a SUVA-registered accountant to verify the configuration.
6. Collect sample statement files from the Surinamese banks.

**Security considerations:** see `docs/SECURITY.md`. The main design choices are RLS plus app scoping, an immutable hash-chained audit log, MFA, and AI off by default.

## Development log
- 2026-11-03: Phase 0 audit and architecture package written.
- 2026-11-03: Scope set to **the Surinamese market only** at the product owner's request. Netherlands/international assumptions removed (BW2, KvK, IBAN, PSD2, CAMT/MT940, ECB). Suriname market profile added and all documents aligned.
- 2026-11-04: Hosting decided: **Vercel**. Background jobs redesigned as a PostgreSQL job table with short resumable steps (`after()` + Vercel Cron) instead of a separate worker.
- 2026-11-10: Phase 1 started. Deployable foundation built (status page, i18n, design tokens, health endpoint, money module, Vercel config). ARA Accounting is implemented independently of ARA Payroll at the product owner's request.
- 2026-11-10: Gap analysis (docs/GAP_ANALYSIS.md). Phase 1 completed: database, RLS, auth + MFA, organisations, companies, administrations, fiscal years, permissions, audit chain, UI, 63 automated tests passing.
- 2026-11-10: Phase 2 completed: accounting engine with database-enforced integrity, chart of accounts, journals, entries, trial balance, general ledger, CSV exports; 89 automated tests passing.
- 2026-11-11: Phase 3 completed: relations, sales/purchase invoices with BTW, open items, bank/cash with CSV import and reconciliation, current accounts, fixed assets with depreciation; 126 automated tests passing.
