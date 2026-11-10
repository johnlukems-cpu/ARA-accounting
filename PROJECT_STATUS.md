# ARA Accounting — Project Status

| Item | Value |
| --- | --- |
| Current phase | **1 — Foundation (in progress)** |
| Completed | 0 — Repository audit & architecture |
| Last update | 2026-11-10 |

## Phase 1 progress (in progress)

**Done (step 1: deployable foundation)**
- Next.js 16.4.3 / React 19.3 / TypeScript strict, Tailwind CSS 4 with ARA Accounting design tokens (deep navy, emerald)
- next-intl: Dutch (nl-SR) default, English secondary, language switch (server action, HttpOnly cookie), time zone America/Paramaribo
- Public status page (`/`) with the honest development status. No login or app screens yet, by design.
- `GET /api/health`
- Security headers (HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy with camera for ARA Scan)
- `vercel.json`: Next.js, region `iad1`. `.env.example` lists the variables for later steps.
- `src/core/money`: the decimal Money type for the ledger engine (rounding half away from zero, ISO codes, conversion, loss-free allocation, nl/en amount parsing and formatting)
- Built independently: no code or configuration is copied from ARA Payroll (product owner decision)

**Tests:** 30 unit tests passed (money 26, i18n catalogue 4). Typecheck, lint and production build pass. Manual browser check at 1280 px and 390 px: no horizontal overflow; language switch works.

**Remaining in Phase 1:** PostgreSQL + Prisma, authentication + MFA, organisations (business / accounting firm), users, roles and permissions, companies, administrations, fiscal years and periods, tenant isolation (RLS) with its test suite, audit log, application shell (sidebar, company / administration / fiscal-year selectors).

**Deployment:** connect the GitHub repository `johnlukems-cpu/ARA-accounting` to Vercel (see README). No environment variables are needed yet.

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
