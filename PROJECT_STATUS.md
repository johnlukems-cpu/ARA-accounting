# ARA Accounting — Project Status

| Item | Value |
| --- | --- |
| Current phase | **2 — Accounting core (next)** |
| Completed | 0 — Architecture · **1 — Foundation** |
| Last update | 2026-11-10 |

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
