#!/usr/bin/env bash
# Backup/restore drill (Phase 12). Dumps SOURCE_URL, restores into a fresh database on TARGET_ADMIN_URL's server,
# then proves the copy is complete and still protected:
#   1. identical row counts for every table,
#   2. identical number of RLS policies, triggers and constraints,
#   3. every posted journal entry still balanced (debit = credit = header totals),
#   4. the audit hash chain table is intact (same count and same last hash).
# Usage: SOURCE_URL=postgresql://... TARGET_ADMIN_URL=postgresql://.../postgres scripts/backup-restore-drill.sh
set -euo pipefail
export PSQLRC=/dev/null
: "${SOURCE_URL:?set SOURCE_URL}"
: "${TARGET_ADMIN_URL:?set TARGET_ADMIN_URL (a database on the restore server, e.g. .../postgres)}"
STAMP=$(date -u +%Y%m%d%H%M%S)
DUMP="${DUMP_DIR:-/tmp}/ara-backup-$STAMP.dump"
TARGET_DB="ara_restore_drill_$STAMP"
TARGET_URL="${TARGET_ADMIN_URL%/*}/$TARGET_DB"

t0=$(date +%s)
pg_dump --format=custom --no-owner --file="$DUMP" "$SOURCE_URL"
t1=$(date +%s)
psql -q "$TARGET_ADMIN_URL" -c "CREATE DATABASE \"$TARGET_DB\""
pg_restore --no-owner --exit-on-error --dbname="$TARGET_URL" "$DUMP"
t2=$(date +%s)

counts() {
  psql -At -v ON_ERROR_STOP=1 "$1" -c "SELECT string_agg(format('%s=%s', c.relname, (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I', c.relname), false, false, '')))[1]::text), ',' ORDER BY c.relname)
                    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'"
}
meta() {
  psql -At -v ON_ERROR_STOP=1 "$1" -c "SELECT (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') || '/' ||
                           (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal) || '/' ||
                           (SELECT count(*) FROM pg_constraint co JOIN pg_namespace n ON n.oid = co.connamespace WHERE n.nspname = 'public') || '/' ||
                           (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relrowsecurity)"
}
unbalanced() {
  psql -At -v ON_ERROR_STOP=1 "$1" -c "SELECT count(*) FROM (SELECT e.id FROM \"JournalEntry\" e JOIN \"JournalLine\" l ON l.\"entryId\" = e.id WHERE e.status = 'POSTED'
                    GROUP BY e.id, e.\"totalDebitBase\", e.\"totalCreditBase\"
                    HAVING sum(l.\"debitBase\") <> sum(l.\"creditBase\") OR sum(l.\"debitBase\") <> e.\"totalDebitBase\") x"
}
# Count, last sequence and a digest over every chained hash (any lost or altered row changes it).
audit_tail() { psql -At -v ON_ERROR_STOP=1 "$1" -c "SELECT count(*) || ':' || coalesce(max(seq)::text, '') || ':' || coalesce(md5(string_agg(hash, ',' ORDER BY seq)), '') FROM \"AuditLog\""; }

fail=0
[ "$(counts "$SOURCE_URL")" = "$(counts "$TARGET_URL")" ] && echo "OK   row counts identical" || { echo "FAIL row counts differ"; fail=1; }
src_meta=$(meta "$SOURCE_URL"); dst_meta=$(meta "$TARGET_URL")
[ "$src_meta" = "$dst_meta" ] && echo "OK   policies/triggers/constraints/RLS tables identical ($dst_meta)" || { echo "FAIL metadata $src_meta vs $dst_meta"; fail=1; }
[ "$(unbalanced "$TARGET_URL")" = "0" ] && echo "OK   all posted entries balanced in the restored copy" || { echo "FAIL unbalanced entries in restore"; fail=1; }
src_audit=$(audit_tail "$SOURCE_URL"); dst_audit=$(audit_tail "$TARGET_URL")
[ -n "$src_audit" ] && [ "$src_audit" = "$dst_audit" ] && echo "OK   audit log identical (${dst_audit%%:*} rows, hash chain digest matches)" || { echo "FAIL audit log differs"; fail=1; }
echo "dump: $(du -h "$DUMP" | cut -f1) in $((t1 - t0))s, restore in $((t2 - t1))s, target database $TARGET_DB"
if [ "${KEEP_RESTORE:-0}" != "1" ]; then psql -q "$TARGET_ADMIN_URL" -c "DROP DATABASE \"$TARGET_DB\""; rm -f "$DUMP"; echo "restored copy dropped"; fi
exit $fail
