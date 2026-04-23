#!/bin/bash
# DEPRECATED: Don't use this script!
#
# .env.local should point to your LOCAL Supabase instance (supabase start)
# .env.devel and .env.prod are only for Vercel deployments
#
# To use remote dev Supabase locally (not recommended):
#   cp .env.devel .env.local
#
# To use local Supabase (recommended):
#   Keep .env.local pointing to http://127.0.0.1:54321
#   Run: supabase start

echo "❌ This script is deprecated"
echo ""
echo "✅ Recommended setup:"
echo "   Local dev:  Use .env.local → Local Supabase (supabase start)"
echo "   Vercel dev: .env.devel → Remote dev Supabase"
echo "   Vercel prod: .env.prod → Remote prod Supabase"
echo ""
echo "To manage Vercel environments, use: npm run env:sync"
