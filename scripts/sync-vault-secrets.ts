#!/usr/bin/env tsx
// Syncs production secret values into Supabase Vault (database-level secrets read by SQL --
// PL/pgSQL functions, triggers, pg_cron jobs -- via vault.decrypted_secrets), reading which
// vars go where from env-vars.config.ts at the repo root instead of a hardcoded list -- see
// that file for why.
//
// NOT the same as:
//   - scripts/sync-to-vercel.ts, which manages Vercel's own environment variables (read by
//     our Next.js app code via process.env).
//   - `supabase secrets set`, which manages Edge Function environment variables. This project
//     doesn't use Edge Functions for anything Vault-secret-related; if that changes, it's a
//     separate mechanism from this script.
//
// Always targets the linked project (same assumption as sync-to-vercel.ts, which always
// targets the linked Vercel project -- run `supabase link` first if you haven't). There's no
// local-Vault equivalent worth a flag here: these are all production-only secrets (same class
// as CRON_SECRET in env-vars.config.ts), sourced from .env.prod, not something a separate dev
// Supabase project would ever need -- there isn't one today anyway (see docs/TODO.md
// Multi-Environment Setup).
//
// Vault secrets are looked up by NAME (vault.decrypted_secrets.name), which is independent of
// the env var name used to source the value -- env-vars.config.ts's `vault` destination maps
// one to the other explicitly via `vaultName`.

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parse as parseDotenv } from "dotenv";
import { ENV_VARS } from "../env-vars.config";

const ENV_FILE = ".env.prod";

/** Idempotent: updates the existing secret in place (preserving its id) if one with this
 * name already exists, otherwise creates it -- safe to re-run whenever the underlying value
 * rotates. */
function syncVaultSecret(
  varName: string,
  value: string,
  vaultName: string,
  description: string,
): void {
  console.log(`📤 Syncing ${varName} -> vault secret '${vaultName}'...`);
  const escaped = value.replace(/'/g, "''");
  const descEscaped = description.replace(/'/g, "''");
  const sql = `
do $sync$
declare
  existing_id uuid;
begin
  select id into existing_id from vault.decrypted_secrets where name = '${vaultName}';
  if existing_id is not null then
    perform vault.update_secret(existing_id, '${escaped}', '${vaultName}', '${descEscaped}');
  else
    perform vault.create_secret('${escaped}', '${vaultName}', '${descEscaped}');
  end if;
end $sync$;
`;
  const result = spawnSync(
    "npx",
    ["supabase", "db", "query", "--linked", sql],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    console.error(`❌ Failed to sync vault secret '${vaultName}'`);
    process.exit(1);
  }
}

function main(): void {
  if (!existsSync(ENV_FILE)) {
    console.error(`❌ ${ENV_FILE} not found!`);
    process.exit(1);
  }
  const env = parseDotenv(readFileSync(ENV_FILE));

  console.log(
    `🔐 Syncing Vault secrets to Supabase (linked project, source: ${ENV_FILE})...\n`,
  );

  for (const spec of ENV_VARS) {
    for (const dest of spec.destinations) {
      if (dest.kind !== "vault") continue;
      const value = env[spec.name];
      if (value === undefined || value === "") {
        console.warn(`⚠️  ${spec.name} not found in ${ENV_FILE}, skipping...`);
        continue;
      }
      syncVaultSecret(spec.name, value, dest.vaultName, spec.description);
    }
  }

  console.log("\n✅ Vault secrets synced!\n");
  console.log(
    'Verify: npx supabase db query --linked "select name, created_at, updated_at from vault.decrypted_secrets order by name;"',
  );
}

main();
