# Environment Management Guide

This project uses separate environments for local development, Vercel previews, and production.

## Environment Architecture

```
┌─────────────────┬──────────────────┬─────────────────────────┐
│ Environment     │ .env File        │ Supabase Instance       │
├─────────────────┼──────────────────┼─────────────────────────┤
│ Local Dev       │ .env.local       │ Local (127.0.0.1:54321) │
│ Vercel Preview  │ .env.devel       │ Remote Dev              │
│ Vercel Prod     │ .env.prod        │ Remote Prod             │
└─────────────────┴──────────────────┴─────────────────────────┘
```

## File Structure

```
.env.local      # Local Supabase (supabase start) - git-ignored
.env.devel      # Remote dev Supabase credentials - git-ignored
.env.prod       # Remote prod Supabase credentials - git-ignored
.env.example    # Template with no real values - committed to git
```

## Local Development Workflow

### 1. Start Local Supabase

```bash
supabase start
```

This gives you a completely isolated local database at `http://127.0.0.1:54321`.

### 2. Ensure .env.local Points to Local Instance

Your `.env.local` should have:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc... (from supabase start output)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc... (from supabase start output)
```

### 3. Run Your Dev Server

```bash
npm run dev
```

Your app connects to **local** Supabase (completely isolated from dev/prod).

## Syncing Remote Environments to Vercel

After editing `.env.devel` or `.env.prod`:

```bash
npm run env:sync
```

This updates Vercel's environment variables:
- `.env.devel` → Vercel **Development** & **Preview** environments
- `.env.prod` → Vercel **Production** environment

## When to Use Which Environment

### Local Development (Most of the time)

```bash
# Start local Supabase
supabase start

# Start Next.js
npm run dev
```

✅ **Use this for**:
- Feature development
- Testing database migrations
- Debugging
- Day-to-day coding

🎯 **Why**: Completely isolated, fast, no risk to shared data

### Remote Dev Supabase (Rarely)

Only if you need to test with shared dev data:

```bash
# Temporarily point to remote dev
cp .env.devel .env.local

# Start Next.js
npm run dev

# IMPORTANT: Switch back when done!
git checkout .env.local  # or re-run supabase start
```

⚠️ **Use this ONLY for**:
- Testing data migrations with real-ish data
- Debugging issues that don't reproduce locally
- Coordinating with team on shared dev data

### Remote Prod Supabase (Never locally!)

❌ **Don't do this**: Never point your local dev to production!

## Verifying Your Setup

### Check Local Environment

```bash
# Should show local Supabase URL
grep NEXT_PUBLIC_SUPABASE_URL .env.local
# Expected: http://127.0.0.1:54321
```

### Check Vercel Environment

```bash
vercel env ls
```

You should see:
- **Development & Preview**: Dev Supabase URL (from .env.devel)
- **Production**: Prod Supabase URL (from .env.prod)

## Common Tasks

### First Time Setup

```bash
# 1. Start local Supabase
supabase start

# 2. .env.local should auto-populate with local credentials
# 3. Add your remote credentials to .env.devel and .env.prod
# 4. Sync remote envs to Vercel
npm run env:sync

# 5. Start coding!
npm run dev
```

### Daily Development

```bash
# Ensure local Supabase is running
supabase start

# Start dev server
npm run dev
```

### After Changing Remote Environment Variables

```bash
# 1. Edit .env.devel or .env.prod
# 2. Sync to Vercel
npm run env:sync

# 3. Redeploy (or wait for next git push)
```

### Resetting Local Database

```bash
# Reset local DB to initial state
supabase db reset

# Or restart fresh
supabase stop
supabase start
```

## Schema Management

### Local → Remote Dev

```bash
# 1. Develop and test migrations locally
supabase migration new your_migration_name

# 2. Apply locally
supabase db reset

# 3. Push to remote dev
supabase db push --db-url "your-dev-supabase-connection-string"

# 4. Or link to remote project
supabase link --project-ref your-dev-project-ref
supabase db push
```

### Remote Dev → Production

```bash
# After testing in dev, push to prod
supabase db push --db-url "your-prod-supabase-connection-string"

# Or via linked project
supabase link --project-ref your-prod-project-ref
supabase db push
```

## Troubleshooting

### "supabase start" fails

```bash
# Check if Docker is running
docker ps

# Reset Supabase
supabase stop
supabase start
```

### "I'm seeing remote data locally"

```bash
# Check your .env.local
grep NEXT_PUBLIC_SUPABASE_URL .env.local

# Should show: http://127.0.0.1:54321
# If it shows remote URL, you've overwritten it!

# Fix: Re-run supabase start and copy credentials
supabase start
```

### "Vercel preview using wrong Supabase"

```bash
# Re-sync environment variables
npm run env:sync

# Trigger new deployment
git push
```

## Security Notes

✅ **Safe to commit**:
- `.env.example` (template with fake values)
- Migration files in `supabase/migrations/`

❌ **Never commit**:
- `.env.local` (local credentials)
- `.env.devel` (remote dev credentials)
- `.env.prod` (remote prod credentials)

## Environment Best Practices

1. **Default to local**: Always use local Supabase for development
2. **Sync sparingly**: Only update Vercel envs when credentials change
3. **Test migrations locally first**: Never run untested migrations on remote
4. **Keep .env.local local**: Don't overwrite it with remote credentials
5. **Use git branches**: Each PR gets its own Vercel preview deployment

## See Also

- [Supabase Local Development](https://supabase.com/docs/guides/cli/local-development)
- [Vercel Environment Variables](https://vercel.com/docs/concepts/projects/environment-variables)
- [DEPLOYMENT_SETUP.md](./DEPLOYMENT_SETUP.md) - Full Vercel setup guide
