#!/bin/bash
# Sync local .env files to Vercel environment variables

set -e

echo "🚀 Syncing environment variables to Vercel..."
echo ""

# Function to add/update env var from file
sync_env_var() {
    local var_name=$1
    local env_file=$2
    local vercel_env=$3

    # Extract value from env file
    local value=$(grep "^${var_name}=" "$env_file" | cut -d= -f2- | sed 's/^"//' | sed 's/"$//')

    if [ -z "$value" ]; then
        echo "⚠️  ${var_name} not found in ${env_file}, skipping..."
        return
    fi

    echo "📤 Syncing ${var_name} to ${vercel_env}..."

    # Remove existing variable for this environment
    vercel env rm "$var_name" "$vercel_env" --yes 2>/dev/null || true

    # For preview, pass empty git-branch positional arg to select all preview branches (non-interactive)
    if [ "$vercel_env" = "preview" ]; then
        vercel env add "$var_name" "$vercel_env" "" --value "$value" --yes
    else
        vercel env add "$var_name" "$vercel_env" --value "$value" --yes
    fi
}

echo "=== Syncing DEVELOPMENT environment ==="
echo "Source: .env.devel → Vercel Development & Preview"
echo ""

if [ ! -f .env.devel ]; then
    echo "❌ .env.devel not found!"
    exit 1
fi

# Sync Supabase vars from .env.devel to development AND preview
for var in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY; do
    sync_env_var "$var" .env.devel development
    sync_env_var "$var" .env.devel preview
done

echo ""
echo "=== Syncing PRODUCTION environment ==="
echo "Source: .env.prod → Vercel Production"
echo ""

if [ ! -f .env.prod ]; then
    echo "❌ .env.prod not found!"
    exit 1
fi

# Sync all production vars from .env.prod
for var in \
    NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY \
    ZOOM_ACCOUNT_ID ZOOM_CLIENT_ID ZOOM_CLIENT_SECRET \
    KAJABI_CLIENT_ID KAJABI_CLIENT_SECRET KAJABI_SITE_ID \
    GOOGLE_CALENDAR_ID GOOGLE_SERVICE_ACCOUNT_KEY \
    SLACK_BOT_TOKEN \
    STRIPE_API_KEY; do
    sync_env_var "$var" .env.prod production
done

echo ""
echo "=== Validating environment variables ==="

MISSING_ENV_VARS=$(awk -F'=' '/^[[:space:]]*#/ || /^[[:space:]]*$/ || /SUPABASE_PROJECT_REF/ || /SUPABASE_ACCESS_TOKEN/ {next} {keys[$1] = keys[$1] (keys[$1] ? "," : "") FILENAME} END {for (k in keys) if (split(keys[k], files, ",") < 3) print "Key [" k "] is missing. Found only in: " keys[k]}' .env.*)

if [ ! -z "${MISSING_ENV_VARS}" ]; then
    echo "${MISSING_ENV_VARS}"
    exit 1
fi

echo ""
echo "✅ Environment variables synced to Vercel!"
echo ""
echo "Next steps:"
echo "  1. Verify: vercel env ls"
echo "  2. Redeploy to apply: git push (for production) or create a PR (for preview)"
echo ""
