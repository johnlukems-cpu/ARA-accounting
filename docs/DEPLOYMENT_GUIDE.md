# ARA Accounting — Deployment Guide

## Vercel (production)
1. In Vercel: **Add New → Project → Import** `johnlukems-cpu/ARA-accounting`. `vercel.json` sets the framework and region `iad1`.
2. **Supabase** (database + file storage; see `SUPABASE_ARCHITECTURE.md`):
   - create a project in **us-east-1** (next to Vercel `iad1`);
   - switch the **Data API off** for `public` (Settings → API), and switch Auth sign-ups off (ARA has its own sign-in);
   - set in Vercel (Production):
     - `DATABASE_URL` = transaction pooler (`…pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true`);
     - `DATABASE_URL_UNPOOLED` = session pooler or direct host (port 5432, `sslmode=require`);
     - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (server-only; never `NEXT_PUBLIC_`). Files go to the private
       bucket `SUPABASE_STORAGE_BUCKET` (default `ara-private`), created on first use.
3. **Environment variables** (Production and Preview): `ENCRYPTION_KEY` (run `openssl rand -base64 32`), `CRON_SECRET` (at least 32 characters: `openssl rand -hex 32`), `APP_URL` (https origin), `PLATFORM_ADMIN_EMAILS`, and optionally the `SMTP_*` variables, `ERROR_REPORT_URL` and `ANTHROPIC_API_KEY` (ARA Scan AI recognition; it is used only when an organisation also switches AI on). See `.env.example`. Check a configuration with `npm run check:env`.
4. Deploy. The build command (`npm run vercel-build` → `scripts/vercel-build.mjs`) runs, in order:
   - `prisma generate`;
   - only when `DATABASE_URL` is set:
     - **`check-env`**, which stops on configuration errors and never prints values;
     - `prisma migrate deploy`;
     - **`prisma migrate status`**;
     - the idempotent reference seed (`scripts/seed.ts`);
   - `next build`;
   - **`check-bundle`**, which stops when a secret value reached the browser bundle.
5. Open the site → **Inloggen → Registreren** to create the first organisation.

Without a database the public status page still works; sign-in shows "not yet available".

### Connection strings
- `DATABASE_URL`: the **transaction pooler** (port 6543, `pgbouncer=true`, `sslmode=require`). Serverless functions open many short connections; the pooler absorbs them. `withTenant` uses `SET LOCAL ROLE` inside a transaction, which is compatible with transaction pooling.
- `DATABASE_URL_UNPOOLED`: the **session pooler or direct host** (port 5432) of the same database. Prisma uses it (`directUrl`) for migrations, which need a session connection.
- The environment check refuses a remote database without TLS, a pooler host as the direct URL, two URLs that point to different databases, and a production deployment without Supabase Storage. It warns when the production database is not on Supabase.

### Database role
The security migration creates the NOLOGIN role `ara_app` and grants it to the migration user (`postgres`). The application keeps one connection string and switches to `ara_app` inside every tenant transaction (`SET LOCAL ROLE`). The `supabase_hardening` and `function_privileges` migrations remove every privilege of `anon`, `authenticated` and `service_role` on application tables and functions, so the public API key can read nothing even if the Data API is switched back on.

### Environments
Three Supabase projects: **dev**, **staging** (Vercel Preview) and **production**. Never point previews at production data.

### Moving existing data
- An existing PostgreSQL database (for example Neon): `scripts/migrate-to-supabase.sh`, see `MIGRATION_PLAN.md`.
- Files still stored in PostgreSQL: `npm run files:to-supabase` (dry run), then `npm run files:to-supabase -- --apply`. Each file is uploaded, verified against its SHA-256 and only then removed from the database, in one transaction per file.

## Local development
```bash
npm install
npm run supabase:local # Docker: Supabase PostgreSQL + Storage API (docker-compose.supabase.yml); prints the .env values
cp .env.example .env   # fill in the printed values and ENCRYPTION_KEY
npx prisma migrate deploy && npm run db:seed
npm run dev
```

The local keys live in `.env.supabase.local` (git-ignored) and are for local use only.

## Tests
```bash
npm test                    # unit
npm run test:integration    # needs PostgreSQL; TEST_DATABASE_URL (default: local ara_accounting_test)
npm run build && npm run test:e2e   # Playwright against a production build and the test database (desktop + phone)
npm run test:load           # 1 M journal lines in one administration; LOAD_DATABASE_URL (default: local ara_accounting_load)
npm run manual:screenshots  # regenerates docs/manual/*.png for the user manual (after npm run build)
```

The release checklist is in `docs/RELEASE_CHECKLIST.md`, and the go/no-go report is in `docs/PRODUCTION_AUDIT.md`.

## Backups and recovery
- Supabase backups depend on the plan (daily backups on paid plans; point-in-time recovery is an add-on). Check what the chosen plan includes and the retention period in the dashboard (Database → Backups).
- Add a periodic logical backup (`pg_dump --format=custom`) to separate storage before going live.
- **Restore drill** (quarterly): `SOURCE_URL=<db> TARGET_ADMIN_URL=<server>/postgres scripts/backup-restore-drill.sh`.
  It restores into a new database and proves the copy is complete and still protected:
  - identical row counts;
  - identical RLS policies, triggers and constraints;
  - every posted entry balanced;
  - an identical audit hash chain.

  It then drops the copy; set `KEEP_RESTORE=1` to keep it.
- The audit log is append-only by database trigger: restoring it is only possible from a backup, never by editing.

## Monitoring
- Platformbeheer → **Productiegereedheid** (platform administrators): live configuration check, readiness gates, an SMTP test message, a monitoring test error, and evidence records.
- `src/instrumentation.ts`: validates the configuration at server start (it logs `config.invalid` / `config.warnings` with key names only) and reports every server error (`request.error`, redacted) to the log and to `ERROR_REPORT_URL`.
- `GET /api/health` returns no tenant data. Use it for uptime checks.
- The daily cron (`/api/cron/quality`, 09:17 UTC, see `vercel.json`):
  - runs the quality scan for every active administration;
  - re-verifies every organisation's audit hash chain;
  - returns `{ scanned, failed, auditChainsChecked, brokenChains }`.

  A broken chain is logged as the JSON event `audit.chainBroken`, with ids only. Alert on it in the log drain or error monitor.
- Application errors show the user a reference (digest). The matching server log entry contains the details.
