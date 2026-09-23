#!/bin/bash
# Sync GitHub Actions secrets/variables from .env.prod for this repo's CI workflows
# (e.g. .github/workflows/checkly.yml). Counterpart to sync-to-vercel.sh, but GitHub
# Actions has no per-environment split like Vercel's prod/preview/dev -- everything
# here comes from .env.prod since these are ops/CI credentials, not app runtime vars.

set -e

REPO="quillandcup/hub"
ENV_FILE=".env.prod"

echo "🚀 Syncing GitHub Actions secrets/variables for ${REPO}..."
echo ""

if [ ! -f "$ENV_FILE" ]; then
    echo "❌ ${ENV_FILE} not found!"
    exit 1
fi

# Sensitive values -- pushed as encrypted secrets (never readable back via `gh secret list`).
SYNCED_SECRETS="
    CHECKLY_API_KEY
    SUPABASE_ACCESS_TOKEN
    SUPABASE_DB_PASSWORD
    VERCEL_DEPLOY_HOOK_URL
"

# Non-sensitive values -- pushed as plain variables (visible via `gh variable list`).
SYNCED_VARS="
    CHECKLY_ACCOUNT_ID
"

extract_value() {
    local var_name=$1
    grep "^${var_name}=" "$ENV_FILE" | cut -d= -f2- | sed 's/^"//' | sed 's/"$//'
}

for var in $SYNCED_SECRETS; do
    value=$(extract_value "$var")
    if [ -z "$value" ]; then
        echo "⚠️  ${var} not found in ${ENV_FILE}, skipping..."
        continue
    fi
    echo "🔒 Syncing secret ${var}..."
    gh secret set "$var" --repo "$REPO" --body "$value"
done

for var in $SYNCED_VARS; do
    value=$(extract_value "$var")
    if [ -z "$value" ]; then
        echo "⚠️  ${var} not found in ${ENV_FILE}, skipping..."
        continue
    fi
    echo "📤 Syncing variable ${var}..."
    gh variable set "$var" --repo "$REPO" --body "$value"
done

echo ""
echo "✅ GitHub Actions secrets/variables synced!"
echo ""
echo "Next steps:"
echo "  1. Verify: gh secret list --repo ${REPO} / gh variable list --repo ${REPO}"
echo "  2. Trigger a workflow run to confirm: gh workflow run checkly.yml --repo ${REPO}"
echo ""
