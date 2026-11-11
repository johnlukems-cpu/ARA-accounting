# ARA Accounting — Release Checklist

Tick each item and keep the completed list with the release. Steps marked **(owner)** need credentials or decisions
that only ARA Intelligent Solutions can provide.

## A. Before the first production deploy
- [ ] **(owner)** Create the Neon production database (US-East) and connect it to the Vercel project (sets `DATABASE_URL`, `DATABASE_URL_UNPOOLED`).
- [ ] **(owner)** Set `ENCRYPTION_KEY` (`openssl rand -base64 32`) in Vercel. Store a copy in a password manager: MFA secrets cannot be decrypted without it.
- [ ] **(owner)** Set `CRON_SECRET` (at least 32 random characters) and `APP_URL` (the production URL).
- [ ] **(owner)** Set `SMTP_*`, then send a test invitation and a password reset.
- [ ] **(owner)** Set `PLATFORM_ADMIN_EMAILS` to the e-mail addresses of the ARA platform administrators.
- [ ] **(owner)** Decide `TRIAL_DAYS`, create the plans with limits and prices in **Platformbeheer**.
- [ ] **(owner)** Optional: `ANTHROPIC_API_KEY` for AI recognition of scanned images.
- [ ] Use a separate Neon branch for Preview deployments; never production data.

## B. Deploy
- [ ] `main` is green locally: `npm run lint && npm run typecheck && npm test && npm run test:integration && npm run build && npm run test:e2e`.
- [ ] No migration drift (see DEPLOYMENT_GUIDE "Tests").
- [ ] Deploy on Vercel. The build log shows `prisma migrate deploy` and the seed ran.
- [ ] `GET /api/health` returns 200.

## C. Smoke test on production
- [ ] Register a test organisation, complete onboarding, and set up MFA.
- [ ] Post a balanced journal entry; check that an unbalanced one is refused.
- [ ] Create, approve and post a sales invoice; download the PDF.
- [ ] Import a bank statement from **a real bank file (owner: sample files)** and match a line.
- [ ] Open the trial balance and the financial statements; export a PDF and a CSV.
- [ ] Switch to English and back.
- [ ] Open the app on a phone.
- [ ] Trigger the cron once: `curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/quality`. Expect `brokenChains: 0`.
- [ ] Delete nothing: leave the test organisation in place, or suspend it in Platformbeheer.

## D. Operations
- [ ] Neon point-in-time restore is enabled; the retention period is noted.
- [ ] **(owner)** Choose off-site storage and schedule a logical dump (`pg_dump --format=custom`).
- [ ] Run `scripts/backup-restore-drill.sh` against a Neon branch and keep the output (quarterly).
- [ ] Re-run the load test against a staging branch with production-like hardware, then compare with PRODUCTION_AUDIT §3.
- [ ] **(owner)** Connect error monitoring and set an alert on the log event `audit.chainBroken`.
- [ ] **(owner)** Run a DAST scan or an external penetration test.

## E. Legal and professional (before general availability)
- [ ] **(owner)** Tax adviser verifies every tax rule. Then set `legalStatus = VERIFIED` per rule version, recording the source.
- [ ] **(owner)** A SUVA-registered accountant reviews the annual-accounts frameworks and draft notes.
- [ ] **(owner)** Confirm the statutory retention period for books and records.
- [ ] **(owner)** Terms of service and privacy statement published.

## F. After the release
- [ ] Tag the release in git (`v1.0.0`).
- [ ] Plan maintenance release 1.1: Prisma 7 upgrade and the items in PRODUCTION_AUDIT §7.
