# ARA — Migration Plan: Neon → Supabase

Status: **prepared and rehearsed; not executed against production.** It needs the owner's Supabase projects (O14)
and the owner's approval (O15). Neon is not touched and stays available until the switch is approved and verified.

## 1. Audit of the current state (2026-11-18)

| Item | Finding |
| --- | --- |
| Architecture | Next.js 16 on Vercel; Prisma 6 on PostgreSQL; server-only data access; RLS through `SET LOCAL ROLE ara_app` |
| Current database | Neon is prepared in the configuration, but **no production database has been provisioned yet** (owner item O1). There is no production data to migrate today; the procedure below applies once Neon (or any PostgreSQL) holds data. |
| Migrations | 28 Prisma migrations, hand-written SQL: guards, RLS, append-only tables, checks |
| Authentication | Own implementation (scrypt, TOTP MFA, sessions, invitations), audited, rate-limited |
| Organisation model | Organization → Company → Administration → FiscalYear/Periods; memberships with roles; company assignments |
| Subscriptions | Phase 11 entitlements (Plan, Organization status/plan/trial) + platform invoices (`SubscriptionInvoice`); now driven by `AraSubscription` in the admin portal |
| Invoices | Accounting engine invoices (sales/purchase, credit notes, open items, payments, allocations) |
| Dashboard | Customer dashboard per administration; platform dashboards (readiness, plans, compliance, bank formats) |
| Permissions | `<module>.<action>` matrix; 9 tenant roles + 7 ARA staff roles; plan module filter |

## 2. Compatibility work (done)

1. Migration fix: `GRANT ara_app TO CURRENT_USER` crashes Supabase PostgreSQL. It now grants to the explicit role name;
   the effect is the same on every PostgreSQL.
2. Migration `supabase_hardening` (a no-op on Neon):
   - revoke the Data API roles;
   - revoke `PUBLIC` function execution;
   - move `btree_gist` to `extensions`.
3. Environment checks for Supabase URLs: `pgbouncer=true` on 6543, session connection for migrations, same project ref.
4. `scripts/migrate-to-supabase.sh` and `scripts/supabase-harden.sql`.

## 3. Procedure (per environment: staging first, then production)

**Before**
1. Create the Supabase project (us-east-1), switch the Data API off, note the pooler and session URLs.
2. Freeze schema changes: no deploy may change migrations during the migration window.
3. Take a fresh backup of the source: Neon branch or PITR point, plus `scripts/backup-restore-drill.sh` against it.

**Migration window (production: announce read-only maintenance)**

4. Put the application in maintenance: set every organisation read-only, or set the Vercel deployment to a maintenance
   page, so no writes happen during the copy.
5. Run:
   ```bash
   SOURCE_URL=<neon direct url> TARGET_URL=<supabase session url, postgres user> scripts/migrate-to-supabase.sh
   ```
   It refuses a non-empty target, and a source with failed migrations. It then:
   - dumps the source;
   - prepares the roles;
   - restores (data before triggers and constraints);
   - copies the privileges of `ara_app` exactly;
   - hardens for Supabase;
   - **verifies** eight things: privileges, row counts of every table, RLS policies and triggers, posted ledger totals,
     open items, the audit hash chain, that every posted entry balances, and that the API roles have no privileges.
6. Point Vercel at Supabase:
   - `DATABASE_URL` = transaction pooler, with `?pgbouncer=true&sslmode=require`;
   - `DATABASE_URL_UNPOOLED` = session connection.

   Optionally set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_STORAGE_BUCKET` for documents. Redeploy:
   - the build runs `check:env`;
   - `migrate deploy` is a no-op (the history is copied);
   - `migrate status` must say the schema is up to date.
7. Smoke test, following `RELEASE_CHECKLIST.md` gate 1 D:
   - sign in with MFA;
   - open a trial balance and compare it with the pre-migration export;
   - post and reverse an entry in a test organisation;
   - open the audit log (the chain check must be OK).
8. Lift maintenance.

**After**

9. Keep Neon read-only for **30 days**, then delete it only with the owner's written approval.
10. Run `scripts/backup-restore-drill.sh` against Supabase (quarterly from then on).

## 4. Validation (per environment)

| Check | How | Pass criterion |
| --- | --- | --- |
| Record counts | migration script check 2 | identical for every table |
| Relationships | foreign keys are restored with the data, then re-validated by PostgreSQL when the constraints are created after the data | restore succeeds with `--exit-on-error` |
| Financial balances | checks 4–6 | ledger totals, open items and per-entry balance identical, no unbalanced entries |
| Audit trail | check 5 | identical hash-chain digest |
| Authentication and permissions | check 1 + smoke test + `npm run test:integration` against staging | privileges identical; sign-in, MFA and RLS isolation work |
| API exposure | check 8 + dashboard setting | 0 privileges for anon/authenticated/service_role |

Rehearsal on 2026-11-18: source = the integration test database (PostgreSQL 16.15, ~13k audit rows, thousands of
entries), target = `supabase/postgres` 15.8. All 8 checks were OK. The full integration suite then passed on the
migrated database (102 tests).

## 5. Rollback

| Moment | Rollback |
| --- | --- |
| Script fails or a check fails | Nothing changes for users: Vercel still points at Neon. Drop the target database or schema, fix the cause, run again. |
| Smoke test fails after the switch (before writes) | Point `DATABASE_URL` and `DATABASE_URL_UNPOOLED` back at Neon and redeploy (minutes). |
| A problem found after users wrote to Supabase | Prefer a fix forward. If a rollback is unavoidable, dump Supabase and migrate back to Neon with the same script (it works PostgreSQL → PostgreSQL). Writes made on Supabase are carried over by that dump. |

## 6. Responsibilities

- **Development:**
  - the scripts and checks;
  - running them with the owner;
  - fixing any failed check.
- **Owner:**
  - the Supabase projects;
  - the maintenance window and announcement;
  - the go/no-go decision;
  - approval to delete Neon.
