#!/usr/bin/env bash
# Neon (or any PostgreSQL) → Supabase migration with verification. See docs/MIGRATION_PLAN.md.
#   SOURCE_URL  = direct (unpooled) URL of the current database (read-only use: pg_dump)
#   TARGET_URL  = Supabase session connection as `postgres` (direct host or session pooler, port 5432), EMPTY database
# Nothing is written to the source. The target must be empty (the script refuses otherwise).
# Steps: preflight → dump → prepare roles → restore (data before triggers/constraints) → Supabase hardening → verify.
set -euo pipefail
export PSQLRC=/dev/null
: "${SOURCE_URL:?set SOURCE_URL}"
: "${TARGET_URL:?set TARGET_URL}"
DIR="$(cd "$(dirname "$0")" && pwd)"
STAMP=$(date -u +%Y%m%d%H%M%S)
DUMP="${DUMP_DIR:-/tmp}/ara-migration-$STAMP.dump"
q() { psql -At -v ON_ERROR_STOP=1 "$1" -c "$2"; }

echo "== Preflight"
echo "source: PostgreSQL $(q "$SOURCE_URL" 'SHOW server_version')"
echo "target: PostgreSQL $(q "$TARGET_URL" 'SHOW server_version')"
existing=$(q "$TARGET_URL" "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
if [ "$existing" != "0" ]; then echo "✗ target public schema is not empty ($existing tables) — refusing"; exit 1; fi
pending=$(q "$SOURCE_URL" "SELECT count(*) FROM \"_prisma_migrations\" WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL")
if [ "$pending" != "0" ]; then echo "✗ source has failed or unfinished migrations — fix first"; exit 1; fi

echo "== Dump (custom format, no owners/privileges)"
pg_dump --format=custom --no-owner --no-privileges --schema=public --file="$DUMP" "$SOURCE_URL"
echo "dump: $(du -h "$DUMP" | cut -f1)"

echo "== Prepare target roles"
psql -q -v ON_ERROR_STOP=1 "$TARGET_URL" <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ara_app') THEN CREATE ROLE ara_app NOLOGIN NOBYPASSRLS; END IF;
  EXECUTE format('GRANT ara_app TO %I', current_user);
END $$;
-- Supabase keeps extensions outside the API-exposed public schema (hosted projects already have this schema).
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist SCHEMA extensions;
SQL

echo "== Restore (tables and data first; indexes, constraints and triggers after the data)"
# The target already has the public schema (and Supabase's extensions): restore everything else.
pg_restore -l "$DUMP" | grep -vE ' SCHEMA - public | COMMENT - SCHEMA public | EXTENSION - btree_gist | COMMENT - EXTENSION btree_gist' > "$DUMP.list"
pg_restore --no-owner --no-privileges --exit-on-error -L "$DUMP.list" --dbname="$TARGET_URL" "$DUMP" || {
  echo "✗ restore failed — the source is untouched; drop the target database/schema and retry"; exit 1; }

echo "== Copy the application role's privileges exactly (pg_dump ran without privileges: owner roles differ per provider)"
grants() { psql -At -v ON_ERROR_STOP=1 "$SOURCE_URL" <<'SQL'
SELECT format('GRANT %s ON TABLE public.%I TO ara_app;', string_agg(privilege_type, ', ' ORDER BY privilege_type), table_name)
  FROM information_schema.role_table_grants WHERE grantee = 'ara_app' AND table_schema = 'public' GROUP BY table_name;
SELECT format('GRANT %s (%I) ON TABLE public.%I TO ara_app;', cp.privilege_type, cp.column_name, cp.table_name)
  FROM information_schema.column_privileges cp
 WHERE cp.grantee = 'ara_app' AND cp.table_schema = 'public'
   AND NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants tg WHERE tg.grantee = 'ara_app' AND tg.table_schema = 'public' AND tg.table_name = cp.table_name AND tg.privilege_type = cp.privilege_type);
SELECT format('GRANT %s ON SEQUENCE public.%I TO ara_app;', p, c.relname)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace CROSS JOIN unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) p
 WHERE n.nspname = 'public' AND c.relkind = 'S' AND has_sequence_privilege('ara_app', c.oid, p);
SELECT format('GRANT USAGE ON SCHEMA public TO ara_app;');
SELECT format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO ara_app;', p.proname, pg_get_function_identity_arguments(p.oid))
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND has_function_privilege('ara_app', p.oid, 'EXECUTE')
   AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 'ara_app'::regrole);
SQL
}
grants > "$DUMP.grants.sql"
echo "$(wc -l < "$DUMP.grants.sql") grant statement(s)"
psql -q -v ON_ERROR_STOP=1 "$TARGET_URL" -f "$DUMP.grants.sql"
psql -q -v ON_ERROR_STOP=1 "$TARGET_URL" -f "$DIR/supabase-harden.sql" 2>&1 | grep -v "no privileges could be revoked" || true

echo "== Verify"
fail=0
counts() { q "$1" "SELECT string_agg(format('%s=%s', c.relname, (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I', c.relname), false, false, '')))[1]::text), ',' ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'"; }
meta() { q "$1" "SELECT (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') || '/' || (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal) || '/' || (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relrowsecurity)"; }
balance() { q "$1" "SELECT coalesce(sum(\"debitBase\"),0) || '/' || coalesce(sum(\"creditBase\"),0) || '/' || count(*) FROM \"JournalLine\" l JOIN \"JournalEntry\" e ON e.id = l.\"entryId\" WHERE e.status = 'POSTED'"; }
unbalanced() { q "$1" "SELECT count(*) FROM (SELECT e.id FROM \"JournalEntry\" e JOIN \"JournalLine\" l ON l.\"entryId\" = e.id WHERE e.status = 'POSTED' GROUP BY e.id, e.\"totalDebitBase\" HAVING sum(l.\"debitBase\") <> sum(l.\"creditBase\") OR sum(l.\"debitBase\") <> e.\"totalDebitBase\") x"; }
openitems() { q "$1" "SELECT coalesce(sum(\"remainingAmount\"),0) || '/' || count(*) FROM \"OpenItem\" WHERE status = 'OPEN'"; }
auditchain() { q "$1" "SELECT count(*) || ':' || coalesce(max(seq)::text,'') || ':' || coalesce(md5(string_agg(hash, ',' ORDER BY seq)),'') FROM \"AuditLog\""; }
check() { if [ "$2" = "$3" ]; then echo "OK   $1"; else echo "FAIL $1 ($2 vs $3)"; fail=1; fi; }
privs() { q "$1" "SELECT md5(coalesce(string_agg(x, ',' ORDER BY x), '')) FROM (SELECT table_name || ':' || privilege_type AS x FROM information_schema.role_table_grants WHERE grantee = 'ara_app' AND table_schema = 'public' UNION SELECT table_name || '.' || column_name || ':' || privilege_type FROM information_schema.column_privileges WHERE grantee = 'ara_app' AND table_schema = 'public') s"; }
check "application role privileges (tables and columns)" "$(privs "$SOURCE_URL")" "$(privs "$TARGET_URL")"
check "row counts of every table" "$(counts "$SOURCE_URL")" "$(counts "$TARGET_URL")"
check "RLS policies / triggers / RLS tables" "$(meta "$SOURCE_URL")" "$(meta "$TARGET_URL")"
check "posted ledger totals (debit/credit/lines)" "$(balance "$SOURCE_URL")" "$(balance "$TARGET_URL")"
check "open items (remaining/count)" "$(openitems "$SOURCE_URL")" "$(openitems "$TARGET_URL")"
check "audit hash chain" "$(auditchain "$SOURCE_URL")" "$(auditchain "$TARGET_URL")"
check "no unbalanced posted entries in target" "0" "$(unbalanced "$TARGET_URL")"
exposed=$(q "$TARGET_URL" "SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('anon','authenticated','service_role')")
check "Supabase API roles have no table privileges" "0" "$exposed"
[ "$fail" = 0 ] && echo "✓ migration verified — keep the source until the owner approves the switch" || echo "✗ verification failed — do NOT switch; the source is untouched"
rm -f "$DUMP" "$DUMP.list" "$DUMP.grants.sql"
exit $fail
