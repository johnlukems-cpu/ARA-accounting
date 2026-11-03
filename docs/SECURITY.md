# ARA Accounting — Security Design

## 1. Authentication
- Email + password (bcrypt cost 12), policy: ≥ 12 characters and not in a breached-password top list.
- Sessions: a random 256-bit token in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. Only its SHA-256 hash is stored. Idle timeout 2 h, absolute 12 h. A password change or MFA reset revokes all other sessions. (ARA Payroll pattern.)
- **MFA (TOTP, RFC 6238)** with recovery codes. Organisations can require it per role (default required for Owner, Firm Admin and Platform Admin). Sessions record `mfaVerifiedAt`, and sensitive actions (closing a year, managing users, exports, platform admin) require a recent MFA check.
- Login rate limit per email and per IP (database-backed, so it works across instances). Responses are constant-time for unknown accounts.
- Invitations and password resets use single-use, hashed, expiring tokens.

## 2. Authorisation
- Permission codes are `<module>.<action>`, with actions view, create, edit, approve, post, reverse, export, close, manageUsers and manageSettings.
- Effective permissions = role grants (org membership ∪ company assignment) ∩ plan entitlements. They are resolved per request on the server.
- **Every** server action and route handler calls `authorize(ctx, permission, { companyId, administrationId })`. Client-side checks only hide UI.
- Platform administration lives under `/platform` with `platform.*` permissions. Platform admins do **not** get implicit access to customer books. Support access needs a time-boxed, customer-approved `SupportGrant`, which is audited.

## 3. Tenant isolation
- Application layer: a tenant-scoped Prisma client. IDs from the client are always re-resolved within the tenant scope (no IDOR).
- Database layer: PostgreSQL RLS on all tenant tables, with session variables set per transaction. The app role has no `BYPASSRLS`.
- Object storage keys are random and prefixed with the organisation id. Downloads only go through an authorised handler that checks document ownership, with `Content-Disposition: attachment`.
- A test suite asserts cross-tenant access is impossible for every service and route.

## 4. Data protection
- TLS everywhere (HSTS preload-ready). Database and object storage encrypted at rest (provider). MFA secrets encrypted with an app key (AES-256-GCM, key from the environment or KMS).
- Secrets only through environment variables. `.env.example` documents them. Nothing is committed.
- Uploads: allow-list (PDF, JPG, PNG, HEIC→JPG, CSV, XML, XLSX), magic-byte sniffing, a size limit (20 MB), a virus-scan hook (ClamAV adapter optional) and the SHA-256 stored.
- AI processing: off by default per organisation. When on, only the document is sent to the configured provider with no other ledger data. The provider and model are recorded per extraction.
- Data export (full organisation export as ZIP: CSV + documents) and retention settings (default 10 years for financial records, configurable per country profile; deletion only after retention and only by the owner).

## 5. Application security
- Server actions use Next.js origin checks (CSRF). Route handlers that mutate require a same-origin check and a session.
- Zod validation on every input. Amounts are parsed as decimal strings, never `parseFloat`.
- CSV/Excel exports neutralise formula injection.
- Headers: CSP (nonce-based), HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy (camera allowed for self on `/scan`).
- Rate limiting on auth, uploads, exports and AI calls.
- Dependency audit in CI. Lockfile committed.

## 6. Audit trail
- `AuditLog` is append-only (a DB trigger blocks update and delete). Rows hold organisation, actor, impersonation/support grant, action, entity, entity id, before/after JSON diff, IP, user agent, request id, timestamp, `prevHash` and `hash` (SHA-256 chain per organisation). A verification job checks the chain.
- Mandatory events: login, failed login, MFA changes, permission and role changes, every posting/reversal/approval, period and year open/close, rate approval, settings changes, exports, document downloads, and support access.

## 7. Operations
- Backups: provider PITR plus a daily logical dump to separate storage, with a quarterly restore test.
- Error monitoring hook (Sentry-compatible). Logs are structured and contain no amounts or personal data beyond ids.
- Health endpoint without tenant data.
