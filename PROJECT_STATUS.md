# ARA Accounting — Project Status

| Item | Value |
| --- | --- |
| Current phase | **8 — Financial reporting (next)** |
| Completed | 0 — Architecture · 1 — Foundation · 2 — Accounting core · 3 — Financial operations · 4 — Industry templates · 5 — Multi-currency · 6 — Budgets · **7 — ARA Scan & AI** |
| Last update | 2026-11-11 |

## Phase 7 — ARA Scan & AI: COMPLETED (2026-11-11)

**Features:**
- **Capture** — camera capture on mobile (photos are downsized in the browser; several photos become one PDF) and PDF/JPG/PNG uploads. The type is checked by magic bytes and the SHA-256 is stored. Files are kept in the database, append-only.
- **Recognition** — field suggestions with confidence from:
  - the PDF text layer (label heuristics, always on), and
  - Claude (`claude-opus-5-5`, structured output, server-side fallback on a refusal), only when `ANTHROPIC_API_KEY` is set **and** the organisation switched AI on with recorded consent.
- **Suggestions** — the supplier (tax/BTW/KKF number, otherwise name similarity), then the account and BTW code (from a rule, the supplier's default or earlier invoices), each with its confidence.
- **Duplicate detection (AI3)** — the same file, the same supplier and invoice number, or the same supplier, date and total.
- **Review screen** — the user's corrections create a draft purchase invoice. Confirmed values are stored apart from the suggestions (AI1). A suspected duplicate must be explicitly accepted. Documents can be rejected with a reason.
- **Automation rules per supplier (AI2)** — modes suggest / draft for approval / post automatically, with a minimum confidence and a maximum amount. Every decision is logged with its reasons.
- **Automation monitor** — automation rate, outcomes and recent decisions.
- **Security** — nodemailer upgraded because of security advisories.

**Migrations:** `phase7_scan`, `phase7_integrity`. They add `Organization.settings`, documents, files, extractions, rules and executions, with RLS, CHECKs and append-only triggers.

**Tests:** 109 unit, 64 integration and 14 e2e tests, all passing. This includes acceptance workflow 2 (scan variant). The AI provider is tested with a recorded-fixture extractor (AI1–AI3), because no API key is configured here.

**Outstanding:**
- an OCR fallback for photos when AI is off;
- e-mail intake (needs an inbound mail service);
- an offline queue (the PWA service worker);
- a virus-scan hook;
- Vercel Blob storage for files larger than the database adapter comfortably holds;
- a live test of the Claude extractor once a key is configured.

**Next phase:** 8 — financial reporting.

## Phase 6 — Budgets: COMPLETED (2026-11-11)

**Features:**
- **Budgets** — per fiscal year and scenario (base, best, worst), with an alert threshold.
- **Starting point** — empty, last year's actuals or last year's approved budget, each optionally adjusted by a percentage.
- **Versions** — draft → submitted → approved by another user. Earlier approved versions become superseded, and a new version is a copy. Submitted and approved versions are immutable (B3, database triggers).
- **Amounts** — a monthly grid for P&L accounts in the user's own number notation. A yearly amount can be spread evenly or along last year's pattern without losing a cent. Import is CSV, wide (12 months) or long (period/amount).
- **Budget versus actual** — any month range; posted entries only (B1); variance, %, utilisation, favourable/unfavourable (B2); totals per category and result; alerts above the threshold; drill-down to the general ledger; CSV export.
- **Rolling forecast** — actuals up to the chosen month plus the remaining budget.

**Migrations:** `phase6_budgets`, `phase6_integrity`.

**Tests:** 106 unit, 59 integration and 13 e2e tests, all passing. This includes acceptance workflow 5.

**Outstanding:**
- budgets per cost centre/project — the data model has `dimensionId`, but the UI is per account;
- Excel import — CSV is supported; Excel files can be saved as CSV;
- budget alerts as notifications or e-mail (Phase 10, automation).

**Next phase:** 7 — ARA Scan and AI.

## Phase 5 — Multi-currency: COMPLETED (2026-11-11)

**Features:**
- **Exchange rates** — rates per organisation (1 foreign = r base, 10 decimals) for 7 types: CBvS buying, CBvS selling, CBvS monthly average, closing rate, bank, cambio and manual. A rate is entered, then approved or rejected by another user, and is immutable once decided.
- **CBvS rates** — imported from an ARA CSV layout. There is no confirmed machine-readable CBvS feed; an automated adapter waits for a verified source.
- **Rate policy per administration** — defaults: sales = CBvS buying, purchases = CBvS selling, revaluation = closing rate, a maximum rate age of 7 days, optionally approved rates only, auto-reverse or cumulative.
- **Invoices** — sales and purchase invoices take the policy rate when no rate is typed. A deviating rate needs `currency.edit` and is audited. Bank and cambio transactions keep the actual rate.
- **Realised differences** — booked on payment (from Phase 3), as in workflow 4.
- **Period-end revaluation** — of monetary items (bank, cash, debtors, creditors, current accounts and configured loans), with a preview per account and currency. The proposal is a journal entry in the FX journal that needs approval. Revaluation lines change only the base value. Reversal is automatic on day 1 of the next period, or deferred until the next fiscal year exists. Only one active revaluation per period, and recalculation goes through a reversal. Non-monetary items are excluded. The sub-ledger check stays clean.

**Migrations:** `phase5_multicurrency`, `phase5_integrity`. They add RLS, CHECK constraints, a trigger that makes decided rates immutable, partial unique indexes, and append-only revaluations.

**Tests:** 100 unit, 55 integration and 12 e2e tests, all passing.

**Outstanding:**
- an automated CBvS feed (needs a verified data source);
- the policy defaults must be agreed with the accountant;
- revaluation of foreign-currency open items per individual item (the current calculation is per account and currency, which equals the sum of the items);
- monthly-average conversion for P&L reporting (Phase 8).

**Next phase:** 6 — budgets.

## Phase 4 — Industry templates: COMPLETED (2026-11-11)

**Library:** 20 platform templates for the Surinamese economy, each adding to "ARA Standaard Suriname":
- the general template;
- 15 required templates — trade, wholesale, retail, construction, installation, hospitality, tourism, transport, real estate, professional services, manufacturing, agriculture, non-profit/churches, accounting firms, healthcare;
- 4 proposed templates — mining, oil & gas suppliers, forestry, fisheries.

A template can add accounts, journals, asset categories, dimension values and KPI choices.

**Rules:**
- **Versions** — templates are data with versions. A published version is immutable (database trigger), and the seed publishes a new platform version only when a definition changes (content hash).
- **Wizard** — creating an administration (onboarding and the company page) asks for a template; the default is the general one. The template is copied in, references are kept, and the administration records the version it used.
- **Upgrades** — an upgrade compares the installed version with the latest one. New items can be ticked and added; numbers already in use are skipped. Changed and removed accounts are only reported, so nothing is overwritten.
- **Own templates** — organisations can build their own templates (based on any template) with an account form, a JSON editor with validation, publishing and archiving. Templates can be exported and imported as JSON (`ara-industry-template` v1).
- **Access** — RLS makes platform templates readable but not writable, and custom templates visible only to their organisation. The `industry.*` permissions are organisation-scoped.

**Migrations:** `phase4_industry_templates`, `phase4_integrity`.

**Tests:** 96 unit, 50 integration and 11 e2e tests, all passing. This includes acceptance workflow 1 end to end.

**Outstanding:**
- review of all templates by a SUVA-registered accountant;
- tax-code and report-line mappings per template (Phases 8/9);
- budget categories (Phase 6);
- KPIs are stored per template and are calculated from Phase 8.

**Next phase:** 5 — multi-currency (CBvS rate adapter, rate policy, revaluation).

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
- 2026-11-11: Phase 4 completed: 20 Surinamese industry templates, versioning, wizard, upgrade proposals, template builder, JSON import/export; 157 automated tests passing.
- 2026-11-11: Phase 5 completed: exchange rates with approval, CBvS import, rate policy, policy rates on invoices, period-end revaluation with automatic reversal; 167 automated tests passing.
- 2026-11-11: Phase 6 completed: budgets with versions and approval, prior-year basis, distribution, CSV import, budget versus actual with alerts, rolling forecast; 178 automated tests passing.
- 2026-11-11: Phase 7 completed: ARA Scan (capture, text-layer and optional Claude recognition, suggestions, duplicate detection, review), automation rules and monitor; 187 automated tests passing.
