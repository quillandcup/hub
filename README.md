# Quill & Cup Admin Portal

Internal admin dashboard for Quill & Cup attendance and engagement analytics.

## Quick Start

### Prerequisites
1. **Docker Desktop** - [Download here](https://docs.docker.com/desktop/)
2. Node.js (already installed)
3. Supabase CLI (already installed)

### Start Local Development

```bash
# 1. Install git hooks (one-time setup)
./scripts/install-hooks.sh

# 2. Start Docker Desktop (open the app)

# 3. Start Supabase
supabase start

# 4. Start Next.js
npm run dev
```

**Git Hooks Installed:**
- `pre-commit` - Runs `npm run build` to catch TypeScript errors before committing
- Skip temporarily with: `git commit --no-verify`

### Test Auth Flow

1. Visit http://localhost:3000
2. Click "Sign In"
3. Enter any email (e.g., `you@example.com`)
4. Open **Inbucket** at http://127.0.0.1:54324
5. Click the magic link in the email
6. You're in! Dashboard shows "Welcome, [name]!"

**Key URLs:**
- App: http://localhost:3000
- Supabase Studio: http://127.0.0.1:54323
- Inbucket (Emails): http://127.0.0.1:54324

## Documentation

- [Product Requirements Document (PRD)](docs/PRD.md)
- [Setup Guide](docs/SETUP.md)
- [Database Architecture (Medallion Pattern)](supabase/ARCHITECTURE.md)

## Overview

This system tracks attendance and engagement for Quill & Cup's weekly writing sessions, helping identify at-risk members and understand session popularity.

## Tech Stack

- **Frontend**: Next.js, Tailwind, Server Components
- **Backend**: Supabase, Postgres, pgmq
- **Hosting**: Vercel

## Architecture

The system uses a **medallion architecture** (bronze/silver/gold) for data transformation:
- **Bronze**: Raw data from Kajabi, Zoom, and Calendar (no inference)
- **Silver**: Inferred attendance and enriched metrics (business logic applied)
- **Gold**: Business analytics and insights

See [Database Architecture](supabase/ARCHITECTURE.md) for detailed layer documentation and data flow.

## Current Features

✅ Landing page with roadmap  
✅ Magic link authentication  
✅ Protected dashboard  
🚧 Member analytics (coming soon)  
🚧 Session insights (coming soon)
