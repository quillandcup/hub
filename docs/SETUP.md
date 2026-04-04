# Setup Guide

## Prerequisites

1. **Docker Desktop** - Required for local Supabase
   - Install from: https://docs.docker.com/desktop/
   - Make sure Docker Desktop is running before starting Supabase

2. **Node.js** - Already installed

3. **Supabase CLI** - Already installed via Homebrew

## Local Development Setup

### 1. Start Docker Desktop

Make sure Docker Desktop is running.

### 2. Start Supabase

```bash
supabase start
```

This will:
- Download Docker images (first time only)
- Start Postgres, Auth, Storage, and other services
- Display connection info and credentials

**Important URLs when Supabase is running:**
- **API URL**: http://127.0.0.1:54321
- **Studio (Dashboard)**: http://127.0.0.1:54323
- **Inbucket (Email Testing)**: http://127.0.0.1:54324

### 3. Install Dependencies

```bash
npm install
```

### 4. Start Next.js Dev Server

```bash
npm run dev
```

Visit: http://localhost:3000

## Testing Magic Link Auth

### Flow:

1. Go to http://localhost:3000/login
2. Enter your email
3. Click "Send Magic Link"
4. Open Inbucket at http://127.0.0.1:54324
5. Find your email and click the magic link
6. You'll be redirected to /dashboard
7. See "Welcome, [your-name]!"

### Creating Test Users

Magic links work automatically - just use any email address in the login form. For local dev, emails are caught by Inbucket.

## Stopping Supabase

```bash
supabase stop
```

## Resetting Database

```bash
supabase db reset
```

## Environment Variables

The `.env.local` file is already configured with local Supabase defaults:

```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<local-dev-key>
```

These work out-of-the-box with `supabase start`.

## Deploying to Production

When you're ready to deploy:

1. Create a Supabase project at https://supabase.com
2. Update `.env.local` with production values:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   ```
3. Configure email settings in Supabase dashboard
4. Deploy to Vercel with environment variables

## Troubleshooting

### "Cannot connect to Docker daemon"
- Make sure Docker Desktop is running
- Restart Docker Desktop if needed

### "Port already in use"
- Check if Supabase is already running: `supabase status`
- Stop it: `supabase stop`
- Start again: `supabase start`

### Magic link not working
- Check Inbucket at http://127.0.0.1:54324
- Make sure Supabase is running: `supabase status`
- Check browser console for errors
