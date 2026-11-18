/**
 * Moves every file still stored in PostgreSQL to Supabase Storage (see src/integrations/storage/move.ts).
 *   npm run files:to-supabase            (dry run: counts only)
 *   npm run files:to-supabase -- --apply
 * Prints counts and record ids only, never file contents.
 */
import { systemDb } from "../src/core/db/client";
import { moveFilesToSupabase } from "../src/integrations/storage/move";

const apply = process.argv.includes("--apply");
moveFilesToSupabase({ apply, log: (m) => console.error(m) })
  .then(async (r) => {
    console.log(`accounting documents in the database: ${r.documents}; admin documents in the database: ${r.adminDocuments}`);
    console.log(apply ? `${r.failed ? "✗" : "✓"} moved ${r.moved}, failed ${r.failed}` : "dry run — add --apply to move");
    await systemDb.$disconnect();
    process.exit(r.failed ? 1 : 0);
  })
  .catch(async (e) => {
    console.error(`✗ ${(e as Error).message}`);
    await systemDb.$disconnect();
    process.exit(1);
  });
