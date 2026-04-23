# Deployment and Environment Setup Guide

This guide walks through setting up custom domains, environment separation, and proper configuration for the Quill & Cup Admin Portal.

## Table of Contents

1. [Custom Domain Configuration](#1-custom-domain-configuration)
2. [Development Environment Setup](#2-development-environment-setup)
3. [Environment Variables Management](#3-environment-variables-management)
4. [Local Development](#4-local-development)
5. [Verification](#5-verification)

---

## 1. Custom Domain Configuration

### Step 1.1: Add Domain in Vercel Dashboard

1. Navigate to your Vercel project: https://vercel.com/quillandcup/admin-portal
2. Click **Settings** > **Domains**
3. Enter your desired domain (e.g., `admin.quillandcup.com`)
4. Click **Add**

### Step 1.2: Configure DNS

Vercel will show you the DNS records needed. You have two options:

#### Option A: Use Vercel DNS (Recommended)
1. Transfer nameserver management to Vercel
2. Vercel automatically configures SSL certificates
3. Supports wildcard domains and automatic SSL renewal

#### Option B: Keep Existing DNS Provider
1. Add the CNAME record Vercel provides:
   ```
   Type: CNAME
   Name: admin (or your subdomain)
   Value: cname.vercel-dns.com
   ```
2. For apex domains (e.g., `quillandcup.com`):
   - Use A record: `76.76.21.21`
   - Or use CNAME flattening if your DNS provider supports it (Cloudflare, etc.)

3. Add CAA record for SSL certificates:
   ```
   Type: CAA
   Name: @ (or your domain)
   Value: 0 issue "letsencrypt.org"
   ```

### Step 1.3: Wait for DNS Propagation

- DNS changes typically propagate within 1 hour
- Can take up to 48 hours in rare cases
- Check status in Vercel dashboard (Settings > Domains)
- SSL certificate auto-provisions once DNS is verified

### Step 1.4: Set Production Domain

1. In Vercel dashboard, go to **Settings** > **Domains**
2. Click the menu (⋯) next to your new domain
3. Select **Set as Production Domain**
4. This makes your custom domain the canonical URL

---

## 2. Development Environment Setup

### Step 2.1: Create Development Supabase Project

1. Go to https://database.new (or https://supabase.com/dashboard)
2. Click **New Project**
3. Settings:
   - **Name**: `quillandcup-admin-dev`
   - **Database Password**: Generate a strong password (save to 1Password/secrets manager)
   - **Region**: Same as production for consistency
   - **Pricing Plan**: Free tier is sufficient for development

4. Wait for project to provision (2-3 minutes)

### Step 2.2: Copy Schema from Production to Development

You have several options:

#### Option A: Using Supabase CLI (Recommended)

```bash
# Install Supabase CLI if not already installed
brew install supabase/tap/supabase

# Link to production project
supabase link --project-ref <production-project-ref>

# Pull schema
supabase db pull

# Link to development project
supabase link --project-ref <dev-project-ref>

# Push schema to development
supabase db push
```

#### Option B: Using SQL Dump

1. In production Supabase project:
   - Settings > Database > Backup & Restore
   - Download schema dump
2. In dev Supabase project:
   - SQL Editor > New Query
   - Paste and run the schema SQL

#### Option C: Manual Migration Files

If you have migration files in `/supabase/migrations`:

```bash
# Point to dev project
supabase link --project-ref <dev-project-ref>

# Apply migrations
supabase db push
```

### Step 2.3: Get Development Supabase Credentials

1. Go to your dev project: https://supabase.com/dashboard/project/<dev-project-id>
2. Navigate to **Settings** > **API**
3. Copy these values:
   - **Project URL** (e.g., `https://abcdefgh.supabase.co`)
   - **anon/public key** (starts with `eyJ...`)

---

## 3. Environment Variables Management

### Step 3.1: Create Environment-Specific Variables

You need to set different Supabase credentials for each environment:

- **Production**: Production Supabase project
- **Preview**: Development Supabase project (for PR previews)
- **Development**: Development Supabase project (for local `vercel dev`)

### Step 3.2: Update Production Environment Variables

```bash
# Remove existing Supabase env vars (they're currently set for all environments)
vercel env rm NEXT_PUBLIC_SUPABASE_URL production
vercel env rm NEXT_PUBLIC_SUPABASE_ANON_KEY production

# Add production-only Supabase credentials
vercel env add NEXT_PUBLIC_SUPABASE_URL production
# Enter: <production-supabase-url>

vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
# Enter: <production-anon-key>
```

### Step 3.3: Add Development/Preview Environment Variables

```bash
# Add development Supabase credentials for Preview deployments
vercel env add NEXT_PUBLIC_SUPABASE_URL preview
# Enter: <dev-supabase-url>

vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY preview
# Enter: <dev-anon-key>

# Add development Supabase credentials for local development
vercel env add NEXT_PUBLIC_SUPABASE_URL development
# Enter: <dev-supabase-url>

vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY development
# Enter: <dev-anon-key>
```

### Step 3.4: Update Other Environment Variables

For services like Zoom, Google Calendar, and Kajabi, decide:

#### Option A: Share Across Environments (Current Setup)
Keep existing configuration - all environments use the same integrations.

#### Option B: Separate Dev/Prod Integrations (Recommended for Production)

```bash
# Remove shared env vars
vercel env rm ZOOM_ACCOUNT_ID
vercel env rm ZOOM_CLIENT_ID
vercel env rm ZOOM_CLIENT_SECRET
vercel env rm GOOGLE_CALENDAR_ID
vercel env rm GOOGLE_SERVICE_ACCOUNT_KEY

# Add production-specific
vercel env add ZOOM_ACCOUNT_ID production
vercel env add ZOOM_CLIENT_ID production
vercel env add ZOOM_CLIENT_SECRET production
vercel env add GOOGLE_CALENDAR_ID production
vercel env add GOOGLE_SERVICE_ACCOUNT_KEY production

# Add development-specific (or use test accounts)
vercel env add ZOOM_ACCOUNT_ID preview
vercel env add ZOOM_CLIENT_ID preview
vercel env add ZOOM_CLIENT_SECRET preview
vercel env add GOOGLE_CALENDAR_ID preview
vercel env add GOOGLE_SERVICE_ACCOUNT_KEY preview
```

### Step 3.5: Pull Environment Variables Locally

```bash
# Pull development environment variables for local work
vercel env pull .env.local
```

This creates/updates `.env.local` with your development credentials.

---

## 4. Local Development

### Step 4.1: Update .env.example

Update the example file with clear instructions:

```bash
# .env.example
# Supabase Configuration (Development)
# Get these from Supabase Dashboard > Settings > API
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Zoom API Credentials (Development/Testing)
ZOOM_ACCOUNT_ID=your_zoom_account_id
ZOOM_CLIENT_ID=your_zoom_client_id
ZOOM_CLIENT_SECRET=your_zoom_client_secret

# Google Calendar Integration (Development)
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"..."}
GOOGLE_CALENDAR_ID=your_calendar_id@group.calendar.google.com

# Kajabi Integration (Development)
KAJABI_CLIENT_ID=your_kajabi_client_id
KAJABI_CLIENT_SECRET=your_kajabi_client_secret
```

### Step 4.2: Development Workflow

```bash
# Start local development server
npm run dev

# Server runs at http://localhost:3000
# Uses .env.local credentials (development Supabase)
```

### Step 4.3: Create Environment-Aware Configuration (Optional)

If you need environment-specific behavior in code:

```typescript
// lib/config.ts
export const config = {
  environment: process.env.VERCEL_ENV || 'development',
  isProduction: process.env.VERCEL_ENV === 'production',
  isPreview: process.env.VERCEL_ENV === 'preview',
  isDevelopment: process.env.VERCEL_ENV === 'development' || !process.env.VERCEL_ENV,
  
  supabase: {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  },
  
  // Environment-specific feature flags
  features: {
    debugMode: process.env.VERCEL_ENV !== 'production',
    enableAnalytics: process.env.VERCEL_ENV === 'production',
  }
};
```

---

## 5. Verification

### Step 5.1: Test Local Development

```bash
npm run dev
```

- Open http://localhost:3000
- Verify connection to development Supabase
- Check that data is isolated from production

### Step 5.2: Test Preview Deployment

```bash
# Create a test branch
git checkout -b test-preview-env

# Make a small change
echo "# Test" >> README.md
git add README.md
git commit -m "Test preview deployment"

# Push to trigger preview deployment
git push origin test-preview-env
```

- Go to Vercel dashboard
- Check the preview deployment URL
- Verify it uses development Supabase credentials
- Test authentication and data access

### Step 5.3: Test Production Deployment

```bash
# Merge to main (or push directly if appropriate)
git checkout main
git merge test-preview-env
git push origin main
```

- Verify deployment at your custom domain
- Check that production Supabase is being used
- Test critical user flows

### Step 5.4: Verify Environment Isolation

Create a test checklist:

- [ ] Local dev uses development Supabase
- [ ] Preview deployments use development Supabase
- [ ] Production uses production Supabase
- [ ] No data leakage between environments
- [ ] Authentication works in all environments
- [ ] Custom domain resolves to production
- [ ] SSL certificate is active and valid

---

## Common Issues and Solutions

### Issue: "DNS_PROBE_FINISHED_NXDOMAIN"

**Solution**: DNS not propagated yet. Wait up to 48 hours, usually resolves in < 1 hour.

### Issue: SSL Certificate Errors

**Solutions**:
- If using Vercel DNS: Auto-provisions, wait 10 minutes
- If external DNS: Add CAA record allowing `letsencrypt.org`
- Check domain is added correctly in Vercel dashboard

### Issue: Preview Deployments Using Production Database

**Solution**: Verify environment variables are scoped correctly:
```bash
vercel env ls
```
Ensure Preview and Development show dev Supabase credentials.

### Issue: Environment Variables Not Updating

**Solution**: Redeploy after changing environment variables:
```bash
vercel --prod  # For production
# Or push to trigger automatic deployment
```

Environment variables are baked in at build time.

### Issue: Local Development Using Wrong Environment

**Solution**: 
```bash
# Re-pull environment variables
vercel env pull .env.local --environment=development

# Restart dev server
npm run dev
```

---

## Environment Variable Reference

### Current Environment Variables

| Variable | Production | Preview | Development | Purpose |
|----------|-----------|---------|-------------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Prod URL | Dev URL | Dev URL | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Prod key | Dev key | Dev key | Supabase public API key |
| `ZOOM_ACCOUNT_ID` | Shared or Prod | Shared or Dev | Shared or Dev | Zoom API credentials |
| `ZOOM_CLIENT_ID` | Shared or Prod | Shared or Dev | Shared or Dev | Zoom API credentials |
| `ZOOM_CLIENT_SECRET` | Shared or Prod | Shared or Dev | Shared or Dev | Zoom API credentials |
| `GOOGLE_CALENDAR_ID` | Shared or Prod | Shared or Dev | Shared or Dev | Calendar integration |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Shared or Prod | Shared or Dev | Shared or Dev | Google API credentials |
| `KAJABI_CLIENT_ID` | TBD | TBD | TBD | Kajabi API credentials |
| `KAJABI_CLIENT_SECRET` | TBD | TBD | TBD | Kajabi API credentials |

### Vercel System Environment Variables

Available in all deployments (read-only):

- `VERCEL_ENV`: `production`, `preview`, or `development`
- `VERCEL_URL`: Deployment URL
- `VERCEL_BRANCH_URL`: Branch-specific URL
- `VERCEL_GIT_COMMIT_SHA`: Current commit hash
- `VERCEL_GIT_COMMIT_REF`: Branch or tag name

Use these for environment-aware logic in your application.

---

## Next Steps

1. Follow Step 1 to add your custom domain
2. Follow Step 2 to create development Supabase project
3. Follow Step 3 to configure environment variables
4. Follow Step 5 to verify everything works
5. Update team documentation with domain and access information

## Additional Resources

- [Vercel Domains Documentation](https://vercel.com/docs/projects/domains)
- [Vercel Environment Variables](https://vercel.com/docs/projects/environment-variables)
- [Supabase CLI Documentation](https://supabase.com/docs/guides/cli)
- [Next.js Environment Variables](https://nextjs.org/docs/app/building-your-application/configuring/environment-variables)
