#!/usr/bin/env npx tsx
// Pre-creates Supabase Auth users for active and on-hiatus members WITHOUT sending any email, banned
// until released, so nobody can sign in before launch.
//
//   pnpm auth:precreate                     plan: dry run, counts only (default)
//   pnpm auth:precreate create --apply      create the missing users (banned) and link members
//   pnpm auth:precreate release --apply     clear the ban of active members (never on_hiatus)
//
// Targets whatever NEXT_PUBLIC_SUPABASE_URL the env files say (.env.prod via the package script).
// Writes need --apply. Output is counts and member ids only: no emails, no names.

import { createClient } from "@supabase/supabase-js";
import { createRepos } from "@/lib/data/repos";
import type { Database } from "@/lib/data/database.types";
import { provisionAuthUsers, releaseAuthUsers, type AdminAuthApi } from "@/lib/auth-provisioning";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const command = args.find((a) => !a.startsWith("--")) ?? "plan";
if (!["plan", "create", "release"].includes(command)) {
  console.error(`Unknown subcommand "${command}". Use plan, create or release.`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (run through the package script).");
  process.exit(1);
}

async function main() {
  const db = createClient<Database>(url!, key!, { auth: { autoRefreshToken: false, persistSession: false } });
  const repos = createRepos(db);
  const auth = db.auth.admin as unknown as AdminAuthApi;
  const write = apply && command !== "plan";
  console.log(`Target: ${new URL(url!).host}`);
  console.log(`Mode: ${command}${write ? " --apply (WRITES)" : " (dry run, nothing is written)"}`);
  if (command === "release") console.log(JSON.stringify(await releaseAuthUsers(auth, repos, { apply: write }), null, 2));
  else console.log(JSON.stringify(await provisionAuthUsers(auth, repos, { apply: write }), null, 2));
  if (command !== "plan" && !apply) console.log("Dry run only. Add --apply to write.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
