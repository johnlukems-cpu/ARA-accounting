# ARA — Supabase Architecture

Date: 2026-11-18 · Applies to ARA Accounting and the ARA Admin Portal (one Next.js application on Vercel).

## 1. Decision summary

Supabase is the backend **platform**: a managed PostgreSQL database and Storage. The application keeps its own server
layer, so every financial rule runs on the server and in the database, never in the browser.

| Supabase service | Used? | How / why |
| --- | --- | --- |
| **PostgreSQL** | ✅ Primary database | Prisma (server-side) through Supavisor. All 28 migrations, triggers, RLS and the full test suite were verified on `supabase/postgres` 15.8 (§5). |
| **Storage** | ✅ Admin documents | Contracts, quotations, payment evidence and customer documents go in **one private bucket**, accessed only from the server with the service-role key (`src/integrations/storage`). Verified against the real `supabase/storage-api` (§5). Without the Supabase variables, documents are stored in PostgreSQL. Scanned purchase invoices (ARA Scan) stay in PostgreSQL. |
| **Database migrations** | ✅ | Prisma migrations, run against the session connection on every deploy (`migrate deploy`, then `migrate status`). The Supabase CLI is not needed. |
| **Database APIs (PostgREST / GraphQL)** | ❌ Deliberately **off** | The app never reads data from the browser. Exposing `public` through the Data API would bypass the server-side authorisation and segregation-of-duties rules. Migration `supabase_hardening` revokes every privilege of `anon`, `authenticated` and `service_role` on `public`. The owner also switches the Data API off for `public` in the dashboard. |
| **Authentication** | ❌ Not now (kept: ARA's own auth) | ARA Accounting already has audited authentication (scrypt, TOTP MFA with recovery codes, session revocation, rate limits, invitations), tied to RLS through `withTenant`. Moving to Supabase Auth would rebuild a working, security-critical module and change every authorisation path. If wanted later, it is a separate project with its own migration of users and MFA secrets. |
| **Edge Functions** | ❌ Not needed | Scheduled work (quality scan, audit-chain check, subscription billing) runs as Vercel Cron route handlers in the same codebase, with the same services and tests. Edge Functions would duplicate business logic in a second runtime. |
| **Realtime** | ❌ Not used | Realtime needs table exposure through Supabase's API roles, which is switched off on purpose. Notifications are polled server-side. |

Reading of the request: Supabase is "the central backend" for data and files, without turning financial data into a
public API. Supabase Studio is a database console for operators; the business application is the ARA Admin Portal.

## 2. Environments

| Environment | Supabase project | Vercel | Database URLs |
| --- | --- | --- | --- |
| Development | `ara-dev` (or local `supabase/postgres` in Docker) | local / Preview | dev project |
| Staging | `ara-staging`, us-east-1 | Preview (branch `staging`) | staging project |
| Production | `ara-prod`, us-east-1 (next to Vercel `iad1`) | Production | prod project |

Each environment has its own project, keys and passwords. Nothing is shared between environments, and no credential is
committed. Values live in Vercel → Settings → Environment Variables, scoped per environment.

## 3. Connection layout

```
Browser ──HTTPS──> Vercel (Next.js server: pages, server actions, route handlers)
                       │  Prisma, server only
                       ├──> Supavisor transaction pooler :6543  (DATABASE_URL, pgbouncer=true, sslmode=require)
                       │        withTenant: BEGIN; SET LOCAL ROLE ara_app; set_config(app.org_id …); …; COMMIT
                       ├──> session connection :5432           (DATABASE_URL_UNPOOLED: migrations only)
                       └──> Supabase Storage /storage/v1        (SUPABASE_SERVICE_ROLE_KEY, private bucket)
```

- `SET LOCAL ROLE` and `set_config(…, true)` are transaction-scoped, so they are safe with transaction pooling.
- `pgbouncer=true` makes Prisma avoid prepared statements on the transaction pooler.
- The environment check (`npm run check:env`, run on every deploy) refuses:
  - a missing `pgbouncer=true` on port 6543;
  - a pooled URL used for migrations;
  - two URLs that belong to different Supabase projects.

## 4. Data model boundaries

- **Customer bookkeeping.** Every customer organisation is a tenant. RLS on `organizationId` isolates its rows (unchanged).
- **ARA's own business.** ARA Intelligent Solutions is one more tenant, the "ARA home" organisation. Its tables hold the
  CRM, catalogue, quotations, subscriptions, payments, support, documents and staff. ARA's invoices, payments, bank,
  purchases and ledger live in **ARA's own administration in the same accounting engine**. That is one bookkeeping, not a
  second one, and it is isolated by the same RLS: ARA's records never mix with customer books (`DATABASE_SCHEMA.md` §4.15).
- **Platform data** has no tenant: plans, platform settings, compliance reviews and the bank format library. It is
  written only by trusted platform code.
- **Customer portal.** A customer's users are members of their own organisation only. The portal reads ARA's records
  server-side with an explicit ownership filter on the CRM customer linked to that organisation (`modules/admin/portal.ts`).

## 5. Verification performed (2026-11-18)

| Check | Environment | Result |
| --- | --- | --- |
| All migrations on Supabase PostgreSQL as `postgres` (not superuser, BYPASSRLS) | `supabase/postgres:15.8.1.085` | ✅. One incompatibility was found and fixed: `GRANT … TO CURRENT_USER` crashed the server (supautils); it now uses the explicit role name. |
| Full integration suite on Supabase PostgreSQL | same | ✅ 90 tests at the time (before the admin portal), then **102 tests** on the migrated database |
| Default exposure through the Data API | database `postgres` | ⚠️ Found: Supabase grants `anon`/`authenticated`/`service_role` ALL on new tables (69 tables, incl. tables without RLS). ✅ Fixed by migration `supabase_hardening`; an integration test asserts 0 privileges. |
| Neon → Supabase migration drill (`scripts/migrate-to-supabase.sh`) | PG 16 → Supabase PG 15.8 | ✅ 8/8 checks: privileges, rows, RLS/triggers, ledger totals, open items, audit chain, balance, API roles |
| Storage adapter | `supabase/storage-api:v1.11.13` | ✅ private bucket, upload/download, no overwrite, anonymous read refused |

Not verified here, because no Supabase account is available in this environment: a hosted project's Supavisor
pooler and network. These are covered by the staging steps in `MIGRATION_PLAN.md` §4.
