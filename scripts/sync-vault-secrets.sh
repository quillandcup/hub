#!/bin/bash
# Sync production secret values into Supabase Vault (database-level secrets read by SQL --
# PL/pgSQL functions, triggers, pg_cron jobs -- via vault.decrypted_secrets).
#
# NOT the same as:
#   - scripts/sync-to-vercel.sh, which manages Vercel's own environment variables (read by
#     our Next.js app code via process.env).
#   - `supabase secrets set`, which manages Edge Function environment variables. This project
#     doesn't use Edge Functions for anything Vault-secret-related; if that changes, it's a
#     separate mechanism from this script.
#
# Always targets the linked project (same assumption as sync-to-vercel.sh, which always targets
# the linked Vercel project -- run `supabase link` first if you haven't). There's no local-Vault
# equivalent worth a flag here: these are all production-only secrets (same class as CRON_SECRET
# in sync-to-vercel.sh), sourced from .env.prod, not something a separate dev Supabase project
# would ever need -- there isn't one today anyway (see docs/TODO.md Multi-Environment Setup).
#
# Vault secrets are looked up by NAME (vault.decrypted_secrets.name), which is independent of
# the env var name used to source the value here -- each sync_vault_secret call below maps one
# to the other explicitly.

set -e

ENV_FILE=.env.prod

if [ ! -f "$ENV_FILE" ]; then
    echo "❌ ${ENV_FILE} not found!"
    exit 1
fi

echo "🔐 Syncing Vault secrets to Supabase (linked project, source: ${ENV_FILE})..."
echo ""

# Idempotent: updates the existing secret in place (preserving its id) if one with this name
# already exists, otherwise creates it -- safe to re-run whenever the underlying value rotates.
sync_vault_secret() {
    local var_name=$1     # env var name in the source file
    local env_file=$2
    local vault_name=$3   # the name SQL code looks this secret up by (vault.decrypted_secrets.name)
    local description=$4

    local value
    value=$(grep "^${var_name}=" "$env_file" | head -1 | cut -d= -f2- | sed 's/^"//' | sed 's/"$//')

    if [ -z "$value" ]; then
        echo "⚠️  ${var_name} not found in ${env_file}, skipping..."
        return
    fi

    # Double single quotes for safe embedding in a SQL string literal.
    local escaped=${value//\'/\'\'}

    echo "📤 Syncing ${var_name} -> vault secret '${vault_name}'..."

    local sql
    sql=$(cat <<SQL
do \$sync\$
declare
  existing_id uuid;
begin
  select id into existing_id from vault.decrypted_secrets where name = '${vault_name}';
  if existing_id is not null then
    perform vault.update_secret(existing_id, '${escaped}', '${vault_name}', '${description}');
  else
    perform vault.create_secret('${escaped}', '${vault_name}', '${description}');
  end if;
end \$sync\$;
SQL
)

    npx supabase db query --linked "$sql"
}

# --- Secrets to sync -----------------------------------------------------------------------
# One line per Vault secret. Add new ones here as they're introduced -- keep this the single
# place Vault secret names/sources are defined, same spirit as sync-to-vercel.sh's var list.

sync_vault_secret CRON_INTERNAL_SECRET "$ENV_FILE" writing_nudge_cron_secret \
    "pg_cron -> /api/internal/nudges/pre-prickle auth (supabase/migrations/20260831170001_enable_pg_cron_pre_prickle_nudges.sql)"

echo ""
echo "✅ Vault secrets synced!"
echo ""
echo "Verify: npx supabase db query --linked \"select name, created_at, updated_at from vault.decrypted_secrets order by name;\""
