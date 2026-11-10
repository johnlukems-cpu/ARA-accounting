# ARA Accounting — Security Design

## 1. Authentication
- Email + password hashed with **scrypt** (N=2^15, r=8, p=1, 16-byte salt; parameters stored per hash so they can be raised). Policy: at least 12 characters. A breached-password check is still open (Phase 12).
- Sessions: a random 256-bit token in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. Only its SHA-256 hash is stored. Idle timeout 2 h, absolute 12 h. A password change, password reset or MFA change revokes all other sessions. Implemented in `src/core/auth/session.ts`.
- **MFA (TOTP, RFC 6238, verified against the RFC test vectors)** with 8 single-use recovery codes (stored as SHA-256 hashes). The secret is encrypted with AES-256-GCM (`ENCRYPTION_KEY`). Organisations require it for Owners and Firm Administrators by default (`Organization.requireMfaForAdmins`). **Grace period:** an administrator may work for 7 days after joining before MFA is enforced; a banner shows the deadline. After that, pages redirect to the account page and server actions are refused until MFA is set up. Sessions record `mfaVerifiedAt`. Step-up MFA for sensitive actions (closing a year, exports) is planned with those features.
- Rate limits (database table `LoginAttempt`, works across serverless instances): login 5 per 15 min per e-mail and per IP; MFA codes 5 per 15 min; registration 5 per hour per IP; password reset 3 per hour. Unknown e-mail addresses go through a dummy scrypt verification so timing does not reveal accounts.
- Invitations (7 days), password resets (1 hour; 24 hours when created by an administrator) and e-mail verification (48 hours) use single-use, SHA-256-hashed tokens claimed atomically. Without SMTP configuration no e-mail is pretended: the invitation or reset link is shown once to the administrator. An administrator cannot create a reset link for a user who belongs to several organisations.

## 2. Authorisation
- Permission codes are `<module>.<action>`, with actions view, create, edit, approve, post, reverse, export, close, manageUsers and manageSettings.
- Effective permissions = role grants (org membership ∪ company assignment) ∩ plan entitlements. They are resolved per request on the server.
- **Every** server action and route handler calls `authorize(ctx, permission, { companyId, administrationId })`. Client-side checks only hide UI.
- Platform administration lives under `/platform` with `platform.*` permissions. Platform admins do **not** get implicit access to customer books. Support access needs a time-boxed, customer-approved `SupportGrant`, which is audited.

## 3. Tenant isolation

**Implemented (Phase 1).** The app connects as the database owner; `withTenant` (`src/core/tenancy/tenant.ts`) opens a transaction, runs `SET LOCAL ROLE ara_app` (a NOLOGIN role without BYPASSRLS) and sets `app.org_id` / `app.user_id`. Policies are created in `prisma/migrations/20261110202700_phase1_security`. `ara_app` has no access to `Session`, `UserToken` or `LoginAttempt`. Integration tests prove that reads, updates, deletes and inserts across organisations are blocked by the database.

- Application layer: a tenant-scoped Prisma client. IDs from the client are always re-resolved within the tenant scope (no IDOR).
- Database layer: PostgreSQL RLS on all tenant tables, with session variables set per transaction. The app role has no `BYPASSRLS`.
- Object storage keys are random and prefixed with the organisation id. Downloads only go through an authorised handler that checks document ownership, with `Content-Disposition: attachment`.
- A test suite asserts cross-tenant access is impossible for every service and route.

## 4. Data protection
- TLS everywhere (HSTS preload-ready). Database and object storage encrypted at rest (provider). MFA secrets encrypted with an app key (AES-256-GCM, key from the environment or KMS).
- Secrets only through environment variables. `.env.example` documents them. Nothing is committed.
- Uploads: allow-list (PDF, JPG, PNG, HEIC→JPG, CSV, XML, XLSX), magic-byte sniffing, a size limit (20 MB), a virus-scan hook (ClamAV adapter optional) and the SHA-256 stored.
- AI processing: off by default per organisation. When on, only the document is sent to the configured provider with no other ledger data. The provider and model are recorded per extraction.
- Data export (full organisation export as ZIP: CSV + documents) and retention settings (default 10 years for financial records, subject to verification of the Surinamese retention period for books and records, which is PENDING_VERIFICATION; deletion only after retention and only by the owner).

## 5. Application security
- Server actions use Next.js origin checks (CSRF). Route handlers that mutate require a same-origin check and a session.
- Zod validation on every input. Amounts are parsed as decimal strings, never `parseFloat`.
- CSV/Excel exports neutralise formula injection.
- Headers: CSP (nonce per request, set in `src/proxy.ts`; `strict-dynamic`, no inline scripts), HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy (camera allowed for self on `/scan`).
- Rate limiting on auth, uploads, exports and AI calls.
- Dependency audit in CI. Lockfile committed.

## 6. Audit trail
- `AuditLog` is append-only (a DB trigger blocks update and delete). Rows hold organisation, actor, impersonation/support grant, action, entity, entity id, before/after JSON diff, IP, user agent, request id, timestamp, `prevHash` and `hash` (SHA-256 chain per organisation). A verification job checks the chain.
- Mandatory events: login, failed login, MFA changes, permission and role changes, every posting/reversal/approval, period and year open/close, rate approval, settings changes, exports, document downloads, and support access.

## 7. Operations
- Backups: provider PITR plus a daily logical dump to separate storage, with a quarterly restore test.
- Error monitoring hook (Sentry-compatible). Logs are structured and contain no amounts or personal data beyond ids.
- Health endpoint without tenant data.
