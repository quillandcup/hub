# Hedgie Hub

Member engagement platform for Quill & Cup — giving members visibility into their writing journey and giving staff the tools to understand community health.

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

Hedgie Hub centralizes data from Kajabi, Zoom, Google Calendar, and Slack to serve two audiences:

**Members** can log in to see their own writing journey — attendance calendars, writing streaks, badges for accomplishments, and more.

**Staff** get a clear picture of community health — who's showing up, who's at risk of churning, and which sessions are thriving.

## Tech Stack

- **Frontend**: Next.js, Tailwind, Server Components
- **Backend**: Supabase, Postgres, pgmq
- **Hosting**: Vercel

## Architecture

The system uses a **medallion architecture** (bronze/silver/gold) for data transformation:
- **Bronze**: Raw data from Kajabi, Zoom, Calendar, and Slack (no inference)
- **Silver**: Inferred attendance and enriched metrics (business logic applied)
- **Gold**: Business analytics and insights

See [Database Architecture](supabase/ARCHITECTURE.md) for detailed layer documentation and data flow.

## Current Features

✅ Landing page with roadmap
✅ Magic link authentication
✅ Protected dashboard
🚧 Member profile — writing streak, attendance calendar, badges
🚧 Staff analytics — session insights, at-risk member identification
