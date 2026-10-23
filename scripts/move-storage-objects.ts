#!/usr/bin/env npx tsx
// Moves the Storage objects queued by the Tier 1 short id migration (public.storage_path_moves)
// to their new paths; once the queue is empty a follow-up migration drops the table.
// Run right after the migration is pushed:  npm run storage:move   (reads .env.prod)
import { createClient } from "@supabase/supabase-js";
import { moveQueuedObjects } from "../lib/storage-moves";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const result = await moveQueuedObjects(supabase);
  console.log(`moved ${result.moved}, already at the new path ${result.alreadyThere}, failed ${result.failed.length}`);
  for (const f of result.failed) console.error(`  ${f.bucket}/${f.oldPath}: ${f.error}`);
  if (result.failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
