-- Supabase hardening (no-op on plain PostgreSQL / Neon).
-- ARA Accounting never uses the Supabase Data API (PostgREST/GraphQL): every query runs server-side through Prisma,
-- inside `withTenant` as the RLS-bound role ara_app. On Supabase, objects created in the `public` schema are granted
-- by default to anon, authenticated and service_role — which would expose tables WITHOUT RLS (Session, UserToken,
-- LoginAttempt) and TRUNCATE (which ignores RLS) through the public API key. This migration removes those privileges,
-- now and for every future object, and stops PUBLIC from executing functions in the schema.

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- Functions: only roles that need them may execute (ara_app keeps its explicit grants; trigger functions need no
-- EXECUTE privilege when they fire).
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_org(), app_user() TO ara_app;
GRANT EXECUTE ON FUNCTION audit_log_hash(text, bigint, text, text, text, text, text, jsonb, timestamp) TO ara_app;

-- Supabase keeps extensions in the `extensions` schema (outside the API-exposed `public`). Move btree_gist there when
-- that schema exists; the exclusion constraint on accounting periods references its operator class by OID and keeps
-- working.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions')
     AND EXISTS (SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'btree_gist' AND n.nspname = 'public') THEN
    ALTER EXTENSION btree_gist SET SCHEMA extensions;
  END IF;
END $$;
