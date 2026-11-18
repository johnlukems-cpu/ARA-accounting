# ARA — Supabase Security

Complements `SECURITY.md` (application security) and `SUPABASE_ARCHITECTURE.md`.

## 1. Principles

1. **No browser access to the database.**
   - All queries run on the Vercel server through Prisma.
   - The Supabase Data API (PostgREST, GraphQL) and Realtime are not used for `public`.
   - The anon key is not needed and is never shipped.
2. **Database-enforced isolation.**
   - Every tenant table has RLS (`tenant_isolation` policy for the role `ara_app`).
   - The application switches to `ara_app` (NOLOGIN, NOBYPASSRLS) inside each transaction.
   - An integration test fails if any table with `organizationId` lacks RLS and a policy while `ara_app` can access it.
3. **Secrets only on the server.**
   - `SUPABASE_SERVICE_ROLE_KEY` and the database passwords are server-side environment variables.
   - The environment check refuses any `NEXT_PUBLIC_*` variable that looks like a secret.
   - After every build, `check:bundle` scans the browser bundle for secret values and for references to them.
4. **Server-side authorisation for every privileged action.**
   - Each server action and route checks the session and the permission; a static guard test enforces this.
   - Financial operations (posting, payment confirmation, billing) run in database transactions with database guards:
     double entry, immutability, period locks, gapless numbering, and evidence constraints.

## 2. Supabase-specific hardening

| Risk | Control | Evidence |
| --- | --- | --- |
| Supabase grants `anon`, `authenticated` and `service_role` ALL on new tables in `public`. Tables without RLS (`Session`, `UserToken`, `LoginAttempt`) and `TRUNCATE` (which ignores RLS) would be reachable with the public anon key. | Migration `20261118100000_supabase_hardening` revokes all table, sequence and function privileges of these roles and their default privileges. After a dump/restore, `scripts/supabase-harden.sql` re-applies it. | Integration test "Supabase: the Data API roles … have no privileges"; migration drill check 8 |
| Functions in `public` executable by `PUBLIC` (callable through `/rpc`) | `REVOKE EXECUTE … FROM PUBLIC`. Only `ara_app` keeps `app_org`, `app_user` and `audit_log_hash`. `btree_gist` is moved to the `extensions` schema. | Same test (0 function privileges) |
| `postgres` has BYPASSRLS on Supabase | RLS is enforced through `SET LOCAL ROLE ara_app`, not through the connecting user. Platform jobs that use `systemDb` are trusted code, listed in `SECURITY.md`. | Tenant isolation tests in phase 1 and in the readiness suite |
| Service-role key leak | Used only by the storage adapter, on the server. It never reaches the browser (bundle scan) and is never logged (log redaction). Rotate it in the Supabase dashboard and update Vercel. | `check:bundle`; `tests/unit/ops.test.ts` |
| Public files | One bucket, created **private** by the code. The code refuses to use a bucket that is public. Downloads go through `/api/admin/documents/[id]` (session, permission, audit, `Content-Security-Policy: sandbox`, throttling). Objects are never overwritten (`x-upsert: false`). | `tests/integration/supabase-storage.test.ts` (live storage-api: anonymous read refused) |
| Weak transport | `sslmode=require` is enforced by the environment check for every remote database URL. | `tests/unit/ops.test.ts` |

## 3. Owner settings in the Supabase dashboard (per project)

- [ ] **API → Data API: switch off** (or remove `public` from "Exposed schemas").
- [ ] **Database → Network restrictions**: allow only Vercel's egress, if the plan supports it.
- [ ] **Auth**: not used. Disable sign-ups so nobody can create Supabase Auth users.
- [ ] **Storage**: do not create public buckets. The application creates `ara-private` itself, as private.
- [ ] **Backups**: daily backups (paid plan) and point-in-time recovery for production.
- [ ] **Database password**: unique per environment, stored only in Vercel and a password manager.
- [ ] Rotate the service-role key when an employee with access leaves.

## 4. Roles and permissions (application level)

| Role | Where | Notes |
| --- | --- | --- |
| ARA Super Administrator | ARA's own organisation | everything, including staff management |
| ARA Administrator | ARA's own organisation | everything except staff and organisation settings |
| Finance Manager | ARA's own organisation | bookkeeping, invoices, payments (confirm), subscriptions, reports |
| Sales Manager | ARA's own organisation | CRM, catalogue, quotations; draft invoices; subscriptions (create) |
| CRM Manager | ARA's own organisation | CRM, quotations (draft), support |
| Support Employee | ARA's own organisation | support; CRM view |
| Read-only Employee | ARA's own organisation | view only |
| Customer Administrator | the customer's own organisation (owner or firm administrator) | portal: accept quotations, manage users |
| Customer User | the customer's own organisation (any member) | portal: view, download, support |

Staff roles can only be granted in ARA's own organisation. MFA is required for the administrator and finance roles,
with the same 7-day grace period as the application. Audit-logged actions include:

- invoice creation and approval;
- payment registration and confirmation;
- subscription changes;
- customer changes;
- financial adjustments;
- permission changes.

The audit log is append-only and hash-chained.
