#!/bin/bash

# Environment Setup Script for Hedgie Hub
# This script helps configure environment variables across Production, Preview, and Development

set -e

echo "=========================================="
echo "Hedgie Hub - Environment Setup"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo -e "${RED}Error: Vercel CLI is not installed${NC}"
    echo "Install it with: npm i -g vercel"
    exit 1
fi

# Check if project is linked
if [ ! -d ".vercel" ]; then
    echo -e "${YELLOW}Project not linked to Vercel${NC}"
    echo "Linking project..."
    vercel link --yes --project hub
fi

echo -e "${GREEN}✓ Project linked to Vercel${NC}"
echo ""

# Function to set environment variable for specific environment
set_env_var() {
    local var_name=$1
    local env_type=$2
    local var_value=$3

    echo "Setting $var_name for $env_type..."
    echo "$var_value" | vercel env add "$var_name" "$env_type" --force
}

# Function to prompt for environment variable
prompt_env_var() {
    local var_name=$1
    local description=$2
    local current_value=$3

    echo ""
    echo "Enter $var_name"
    echo "Description: $description"
    if [ -n "$current_value" ]; then
        echo "Current: $current_value"
    fi
    read -p "> " value
    echo "$value"
}

echo "Select setup mode:"
echo "1) Quick Setup - Configure Supabase credentials only"
echo "2) Full Setup - Configure all environment variables"
echo "3) List current environment variables"
echo "4) Pull environment variables to .env.local"
read -p "Choice [1-4]: " setup_mode

case $setup_mode in
    1)
        echo ""
        echo "=== Quick Setup: Supabase Credentials ==="
        echo ""

        # Production Supabase
        echo "--- Production Supabase ---"
        prod_url=$(prompt_env_var "NEXT_PUBLIC_SUPABASE_URL" "Production Supabase URL" "")
        prod_key=$(prompt_env_var "NEXT_PUBLIC_SUPABASE_ANON_KEY" "Production Supabase Anon Key" "")

        set_env_var "NEXT_PUBLIC_SUPABASE_URL" "production" "$prod_url"
        set_env_var "NEXT_PUBLIC_SUPABASE_ANON_KEY" "production" "$prod_key"

        # Development Supabase
        echo ""
        echo "--- Development Supabase ---"
        dev_url=$(prompt_env_var "NEXT_PUBLIC_SUPABASE_URL" "Development Supabase URL" "")
        dev_key=$(prompt_env_var "NEXT_PUBLIC_SUPABASE_ANON_KEY" "Development Supabase Anon Key" "")

        set_env_var "NEXT_PUBLIC_SUPABASE_URL" "preview" "$dev_url"
        set_env_var "NEXT_PUBLIC_SUPABASE_ANON_KEY" "preview" "$dev_key"
        set_env_var "NEXT_PUBLIC_SUPABASE_URL" "development" "$dev_url"
        set_env_var "NEXT_PUBLIC_SUPABASE_ANON_KEY" "development" "$dev_key"

        echo ""
        echo -e "${GREEN}✓ Supabase credentials configured${NC}"
        ;;

    2)
        echo ""
        echo "=== Full Setup ==="
        echo ""
        echo "This will configure all environment variables for all environments."
        echo "Press Ctrl+C to cancel at any time."
        echo ""
        read -p "Continue? [y/N]: " confirm

        if [[ ! $confirm =~ ^[Yy]$ ]]; then
            echo "Setup cancelled"
            exit 0
        fi

        # Supabase (Production)
        echo ""
        echo "--- Production Environment ---"
        prod_supabase_url=$(prompt_env_var "NEXT_PUBLIC_SUPABASE_URL" "Production Supabase URL" "")
        prod_supabase_key=$(prompt_env_var "NEXT_PUBLIC_SUPABASE_ANON_KEY" "Production Supabase Anon Key" "")

        # Supabase (Development)
        echo ""
        echo "--- Development Environment ---"
        dev_supabase_url=$(prompt_env_var "NEXT_PUBLIC_SUPABASE_URL" "Development Supabase URL" "")
        dev_supabase_key=$(prompt_env_var "NEXT_PUBLIC_SUPABASE_ANON_KEY" "Development Supabase Anon Key" "")

        # External integrations
        echo ""
        echo "--- External Integrations ---"
        echo "Configure these for production (you can share or separate for dev):"

        zoom_account=$(prompt_env_var "ZOOM_ACCOUNT_ID" "Zoom Account ID" "")
        zoom_client=$(prompt_env_var "ZOOM_CLIENT_ID" "Zoom Client ID" "")
        zoom_secret=$(prompt_env_var "ZOOM_CLIENT_SECRET" "Zoom Client Secret" "")

        google_calendar=$(prompt_env_var "GOOGLE_CALENDAR_ID" "Google Calendar ID" "")
        google_key=$(prompt_env_var "GOOGLE_SERVICE_ACCOUNT_KEY" "Google Service Account Key (JSON)" "")

        kajabi_client=$(prompt_env_var "KAJABI_CLIENT_ID" "Kajabi Client ID" "")
        kajabi_secret=$(prompt_env_var "KAJABI_CLIENT_SECRET" "Kajabi Client Secret" "")

        # Set all variables
        echo ""
        echo "Setting all environment variables..."

        # Production
        set_env_var "NEXT_PUBLIC_SUPABASE_URL" "production" "$prod_supabase_url"
        set_env_var "NEXT_PUBLIC_SUPABASE_ANON_KEY" "production" "$prod_supabase_key"
        set_env_var "ZOOM_ACCOUNT_ID" "production" "$zoom_account"
        set_env_var "ZOOM_CLIENT_ID" "production" "$zoom_client"
        set_env_var "ZOOM_CLIENT_SECRET" "production" "$zoom_secret"
        set_env_var "GOOGLE_CALENDAR_ID" "production" "$google_calendar"
        set_env_var "GOOGLE_SERVICE_ACCOUNT_KEY" "production" "$google_key"
        set_env_var "KAJABI_CLIENT_ID" "production" "$kajabi_client"
        set_env_var "KAJABI_CLIENT_SECRET" "production" "$kajabi_secret"

        # Preview
        set_env_var "NEXT_PUBLIC_SUPABASE_URL" "preview" "$dev_supabase_url"
        set_env_var "NEXT_PUBLIC_SUPABASE_ANON_KEY" "preview" "$dev_supabase_key"
        set_env_var "ZOOM_ACCOUNT_ID" "preview" "$zoom_account"
        set_env_var "ZOOM_CLIENT_ID" "preview" "$zoom_client"
        set_env_var "ZOOM_CLIENT_SECRET" "preview" "$zoom_secret"
        set_env_var "GOOGLE_CALENDAR_ID" "preview" "$google_calendar"
        set_env_var "GOOGLE_SERVICE_ACCOUNT_KEY" "preview" "$google_key"
        set_env_var "KAJABI_CLIENT_ID" "preview" "$kajabi_client"
        set_env_var "KAJABI_CLIENT_SECRET" "preview" "$kajabi_secret"

        # Development
        set_env_var "NEXT_PUBLIC_SUPABASE_URL" "development" "$dev_supabase_url"
        set_env_var "NEXT_PUBLIC_SUPABASE_ANON_KEY" "development" "$dev_supabase_key"
        set_env_var "ZOOM_ACCOUNT_ID" "development" "$zoom_account"
        set_env_var "ZOOM_CLIENT_ID" "development" "$zoom_client"
        set_env_var "ZOOM_CLIENT_SECRET" "development" "$zoom_secret"
        set_env_var "GOOGLE_CALENDAR_ID" "development" "$google_calendar"
        set_env_var "GOOGLE_SERVICE_ACCOUNT_KEY" "development" "$google_key"
        set_env_var "KAJABI_CLIENT_ID" "development" "$kajabi_client"
        set_env_var "KAJABI_CLIENT_SECRET" "development" "$kajabi_secret"

        echo ""
        echo -e "${GREEN}✓ All environment variables configured${NC}"
        ;;

    3)
        echo ""
        echo "=== Current Environment Variables ==="
        vercel env ls
        ;;

    4)
        echo ""
        echo "=== Pull Environment Variables ==="
        echo "Select environment to pull:"
        echo "1) Development (for local work)"
        echo "2) Preview"
        echo "3) Production"
        read -p "Choice [1-3]: " env_choice

        case $env_choice in
            1) env_type="development" ;;
            2) env_type="preview" ;;
            3) env_type="production" ;;
            *) echo "Invalid choice"; exit 1 ;;
        esac

        echo "Pulling $env_type environment to .env.local..."
        vercel env pull .env.local --environment="$env_type"
        echo -e "${GREEN}✓ Environment variables pulled to .env.local${NC}"
        echo ""
        echo "You can now run: npm run dev"
        ;;

    *)
        echo "Invalid choice"
        exit 1
        ;;
esac

echo ""
echo "=========================================="
echo "Setup complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Pull env vars for local development: vercel env pull .env.local"
echo "2. Start dev server: npm run dev"
echo "3. See full documentation: docs/DEPLOYMENT_SETUP.md"
echo ""
