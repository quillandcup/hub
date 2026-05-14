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

    # Add new value using --value flag to avoid interactive prompts (including git branch prompt for preview)
    vercel env add "$var_name" "$vercel_env" --value "$value" --yes
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

# Sync Supabase vars from .env.prod to production
for var in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY; do
    sync_env_var "$var" .env.prod production
done

echo ""
echo "✅ Environment variables synced to Vercel!"
echo ""
echo "Next steps:"
echo "  1. Verify: vercel env ls"
echo "  2. Redeploy to apply: git push (for production) or create a PR (for preview)"
echo ""
