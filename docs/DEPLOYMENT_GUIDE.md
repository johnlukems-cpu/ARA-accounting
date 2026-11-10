# ARA Accounting — Deployment Guide

## Vercel (production)
1. In Vercel: **Add New → Project → Import** `johnlukems-cpu/ARA-accounting`. `vercel.json` sets the framework and region `iad1`.
2. **Database:** Vercel → Storage → **Neon** (Postgres) → region US-East → connect to the project. This sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED`.
3. **Environment variables** (Production and Preview): `ENCRYPTION_KEY` (run `openssl rand -base64 32`), `CRON_SECRET`, optionally `APP_URL` and the `SMTP_*` variables. See `.env.example`.
4. Deploy. The build command (`npm run vercel-build` → `scripts/vercel-build.mjs`) runs `prisma generate`, then — only when `DATABASE_URL` is set — `prisma migrate deploy` and the idempotent reference seed (`scripts/seed.ts`), then `next build`.
5. Open the site → **Inloggen → Registreren** to create the first organisation.

Without a database the public status page still works; sign-in shows "not yet available".

### Database role on Neon
The security migration creates the NOLOGIN role `ara_app` and grants it to the migration user. The application keeps one connection string and switches to `ara_app` inside every tenant transaction (`SET LOCAL ROLE`). No extra credentials are needed.

### Preview deployments
Use a separate Neon branch for Preview (Neon integration: "create a branch for each preview"). Never point previews at production data.

## Local development
```bash
npm install
cp .env.example .env   # fill in DATABASE_URL, DATABASE_URL_UNPOOLED, ENCRYPTION_KEY
npx prisma migrate deploy && npm run db:seed
npm run dev
```

## Tests
```bash
npm test                    # unit
npm run test:integration    # needs PostgreSQL; TEST_DATABASE_URL (default: local ara_accounting_test)
npm run build && npm run test:e2e   # Playwright against a production build and the test database
```

## Backups and recovery
- Neon provides point-in-time restore (retention depends on the plan). Check the retention period in the Neon console.
- Add a periodic logical backup (`pg_dump`) to separate storage before going live, and test a restore every quarter (Phase 12 checklist).
- The audit log is append-only by database trigger: restoring it is only possible from a backup, never by editing.
