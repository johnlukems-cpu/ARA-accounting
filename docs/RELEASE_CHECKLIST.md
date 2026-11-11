# ARA Accounting — Release Checklist

Tick each item and keep the completed list with the release. **(owner)** marks steps that need the owner's credentials or
decisions; **(specialist)** marks steps that need an external professional. Live status: **Platformbeheer →
Productiegereedheid**. Details per item: [OWNER_ACTION_REGISTER.md](OWNER_ACTION_REGISTER.md).

Do not open the application to customers until **gate 1** is complete. Do not sell to the public, or call ARA Accounting
compliant with Surinamese legislation, until **gate 2** is complete.

## Gate 1 — Controlled pilot

### A. Configuration (O1)
- [ ] **(owner)** Create the Neon production database (US-East) and connect it to the Vercel project. This sets the pooled `DATABASE_URL` and the direct `DATABASE_URL_UNPOOLED`.
- [ ] **(owner)** Set `ENCRYPTION_KEY` (`openssl rand -base64 32`) and keep a copy in a password manager.
- [ ] **(owner)** Set `CRON_SECRET` (`openssl rand -hex 32`), `APP_URL` (the https origin) and `PLATFORM_ADMIN_EMAILS`.
- [ ] Deploy. The build log shows `check-env` without errors, `migrate deploy`, `migrate status` ("Database schema is up to date"), the seed, `next build`, and "No secrets in the browser bundle".
- [ ] `GET /api/health` returns 200.
- [ ] Sign in as a platform admin and set up MFA. Platformbeheer → Productiegereedheid shows O1 *Afgerond* and no configuration errors.
- [ ] Use a separate Neon branch for Preview deployments; never production data.

### B. E-mail (O2)
- [ ] **(owner)** Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` and `SMTP_FROM` (ARA's domain, with SPF/DKIM).
- [ ] Productiegereedheid → **Testbericht sturen**: message received.
- [ ] Invite a test user and request a password reset; both e-mails arrive with links to `APP_URL`.

### C. Operations (O10, O11)
- [ ] **(owner)** Set `ERROR_REPORT_URL`, then **Testfout sturen**: the alert arrives.
- [ ] Neon point-in-time restore is enabled; note the retention period.
- [ ] **(owner)** Off-site storage chosen and a daily `pg_dump --format=custom` scheduled.
- [ ] Run `scripts/backup-restore-drill.sh` against a Neon branch; all four checks OK. Record it under *Bewijs vastleggen* (O10).
- [ ] Trigger the cron once: `curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/quality`. Expect `brokenChains: 0`; a call without the header returns 401.

### D. Smoke test on production
- [ ] Register a test organisation, complete onboarding, and set up MFA.
- [ ] Post a balanced journal entry; check that an unbalanced one is refused.
- [ ] Create, approve and post a sales invoice; download the PDF.
- [ ] Bank: apply a validated format (if one exists) or set the columns, then import a statement and match a line.
- [ ] Open the trial balance and the financial statements; export a PDF and a CSV.
- [ ] Switch to English and back; open the app on a phone.
- [ ] Tell pilot customers in writing that tax calculations use **unverified** rules (the app shows this as well).

## Gate 2 — General availability

### E. Commercial (O3, O4)
- [ ] **(owner)** Plans with prices, limits and modules in Platformbeheer → Pakketten; trial length set; preview checked.
- [ ] **(owner)** Payment instructions saved; visible on the customer's **Abonnement** page.

### F. Compliance (O5, O6, O8, O13)
- [ ] **(specialist)** Tax adviser reviewed every item of COMPLIANCE_REVIEW_CHECKLIST §1–§3; reviews recorded in Platformbeheer → Compliance; changes implemented as new rule versions and reviewed again.
- [ ] **(specialist)** SUVA-registered accountant reviewed the four annual-accounts frameworks (§4); reviews recorded.
- [ ] **(specialist)** Retention period confirmed (§5); setting aligned.
- [ ] **(specialist)** Terms of service, privacy statement and data processing agreement written; published with acceptance at registration; recorded (O13).
- [ ] Only now may marketing material say that the tax rules have been verified, and only for the verified items.

### G. Security (O12)
- [ ] **(specialist)** DAST scan or penetration test against staging; no open high or critical findings; recorded (O12).
- [ ] `npm audit --omit=dev`: nothing beyond the accepted deepmerge-ts advisory (PRODUCTION_AUDIT §5.3).

### H. Banks (O7)
- [ ] **(owner)** A validated format for every bank the customers use (Platformbeheer → Bankformaten; BANK_IMPORT_VALIDATION.md).

### I. Performance
- [ ] Re-run `npm run test:load` against a staging Neon branch and compare with PRODUCTION_AUDIT §3.

## After each release
- [ ] CI green on `main` (`.github/workflows/ci.yml`).
- [ ] Tag the release in git (`v1.0.0`, …).
- [ ] Platformbeheer → Productiegereedheid reviewed; `npm run readiness:report` regenerated.
- [ ] Maintenance release 1.1: Prisma 7 upgrade and the items in PRODUCTION_AUDIT §7.
