# Environment Setup Verification Checklist

Use this checklist to verify your multi-environment setup is working correctly.

## Pre-Setup Checklist

Before starting the setup process, verify you have:

- [ ] Access to Vercel project (quillandcup/hub)
- [ ] Access to production Supabase project
- [ ] Created development Supabase project
- [ ] Copied schema from production to development Supabase
- [ ] Vercel CLI installed (`npm install -g vercel`)
- [ ] Custom domain ready (if applicable)

---

## 1. Custom Domain Setup

### DNS Configuration

- [ ] Domain added in Vercel dashboard (Settings > Domains)
- [ ] DNS records configured:
  - [ ] CNAME record pointing to `cname.vercel-dns.com` (or A record for apex domain)
  - [ ] CAA record allowing `letsencrypt.org`
- [ ] DNS propagation complete (check with `dig your-domain.com` or https://dnschecker.org)
- [ ] Domain shows "Valid Configuration" in Vercel dashboard
- [ ] SSL certificate provisioned (green checkmark in Vercel)

### Domain Access

- [ ] Custom domain loads in browser
- [ ] HTTPS works (no certificate warnings)
- [ ] Redirects work (www → non-www or vice versa)
- [ ] Custom domain set as production domain in Vercel

**Test Command:**
```bash
# Check DNS resolution
dig hub.quillandcup.com

# Check SSL certificate
curl -vI https://hub.quillandcup.com 2>&1 | grep -i 'subject\|issuer'
```

---

## 2. Supabase Environment Separation

### Production Supabase

- [ ] Production project created and provisioned
- [ ] Schema deployed (tables, RLS policies, functions)
- [ ] Production data populated
- [ ] Credentials saved securely (Project URL and anon key)

### Development Supabase

- [ ] Development project created and provisioned
- [ ] Schema copied from production (same structure)
- [ ] Test data populated (or empty for fresh testing)
- [ ] Credentials saved securely (Project URL and anon key)
- [ ] Development project uses different URL than production

**Verification:**
```bash
# Check production URL is different from development URL
echo "Production:" $(vercel env pull .env.production --yes && grep NEXT_PUBLIC_SUPABASE_URL .env.production)
echo "Development:" $(vercel env pull .env.development --yes && grep NEXT_PUBLIC_SUPABASE_URL .env.development)
```

---

## 3. Vercel Environment Variables

### Production Environment

Check these are set for **Production** only:

- [ ] `NEXT_PUBLIC_SUPABASE_URL` (production URL)
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` (production key)
- [ ] `ZOOM_ACCOUNT_ID` (production or shared)
- [ ] `ZOOM_CLIENT_ID` (production or shared)
- [ ] `ZOOM_CLIENT_SECRET` (production or shared)
- [ ] `GOOGLE_CALENDAR_ID` (production calendar)
- [ ] `GOOGLE_SERVICE_ACCOUNT_KEY` (production credentials)
- [ ] `KAJABI_CLIENT_ID` (if applicable)
- [ ] `KAJABI_CLIENT_SECRET` (if applicable)

### Preview Environment

Check these are set for **Preview** only:

- [ ] `NEXT_PUBLIC_SUPABASE_URL` (development URL)
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` (development key)
- [ ] `ZOOM_ACCOUNT_ID` (development or shared)
- [ ] `ZOOM_CLIENT_ID` (development or shared)
- [ ] `ZOOM_CLIENT_SECRET` (development or shared)
- [ ] `GOOGLE_CALENDAR_ID` (development calendar or shared)
- [ ] `GOOGLE_SERVICE_ACCOUNT_KEY` (development credentials or shared)
- [ ] `KAJABI_CLIENT_ID` (if applicable)
- [ ] `KAJABI_CLIENT_SECRET` (if applicable)

### Development Environment

Check these are set for **Development** only:

- [ ] `NEXT_PUBLIC_SUPABASE_URL` (development URL)
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` (development key)
- [ ] `ZOOM_ACCOUNT_ID` (development or shared)
- [ ] `ZOOM_CLIENT_ID` (development or shared)
- [ ] `ZOOM_CLIENT_SECRET` (development or shared)
- [ ] `GOOGLE_CALENDAR_ID` (development calendar or shared)
- [ ] `GOOGLE_SERVICE_ACCOUNT_KEY` (development credentials or shared)
- [ ] `KAJABI_CLIENT_ID` (if applicable)
- [ ] `KAJABI_CLIENT_SECRET` (if applicable)

**Verification:**
```bash
# List all environment variables and verify scoping
vercel env ls

# Pull each environment to verify values
vercel env pull .env.production --environment=production
vercel env pull .env.preview --environment=preview
vercel env pull .env.development --environment=development

# Check Supabase URLs are different
echo "Production:" && grep NEXT_PUBLIC_SUPABASE_URL .env.production
echo "Preview:" && grep NEXT_PUBLIC_SUPABASE_URL .env.preview
echo "Development:" && grep NEXT_PUBLIC_SUPABASE_URL .env.development
```

---

## 4. Local Development

### Setup

- [ ] Repository cloned locally
- [ ] Dependencies installed (`npm install`)
- [ ] Vercel project linked (`vercel link`)
- [ ] Environment variables pulled (`vercel env pull .env.local`)
- [ ] `.env.local` file exists and contains development credentials

### Functionality

- [ ] Development server starts (`npm run dev`)
- [ ] App loads at http://localhost:3000
- [ ] Can connect to development Supabase
- [ ] Authentication works
- [ ] Can read/write data to development database
- [ ] No errors in browser console
- [ ] No errors in terminal

**Test Steps:**
```bash
# Start dev server
npm run dev

# In another terminal, verify connection
curl http://localhost:3000 -I

# Check environment
# Should show development Supabase URL in browser dev tools:
# Application > Local Storage > check SUPABASE_URL
```

---

## 5. Preview Deployments

### Create Test Preview

- [ ] Created feature branch (`git checkout -b test/preview-env`)
- [ ] Pushed to GitHub (`git push origin test/preview-env`)
- [ ] Vercel automatically created preview deployment
- [ ] Preview URL accessible (https://hub-*.vercel.app)

### Verify Preview Environment

- [ ] Preview deployment loads in browser
- [ ] Preview uses development Supabase (verify in Network tab or create test data)
- [ ] Authentication works
- [ ] Can create test data without affecting production
- [ ] Environment indicator shows "Preview" (if implemented)
- [ ] No production data visible

**Test Steps:**
```bash
# Create and push test branch
git checkout -b test/preview-env
echo "# Test" >> README.md
git add README.md
git commit -m "Test preview deployment"
git push origin test/preview-env

# Go to Vercel dashboard and check preview URL
# Or wait for GitHub comment with preview URL
```

**Verification in Preview Deployment:**
1. Open browser dev tools > Console
2. Run: `localStorage.getItem('supabase.auth.token')`
3. Decode JWT at https://jwt.io
4. Check `aud` claim points to development Supabase

---

## 6. Production Deployment

### Deploy to Production

- [ ] Merged feature branch to main (or pushed directly)
- [ ] Vercel automatically deployed to production
- [ ] Production URL accessible (custom domain)
- [ ] Deployment succeeded without errors

### Verify Production Environment

- [ ] Production deployment loads at custom domain
- [ ] Production uses production Supabase
- [ ] Authentication works
- [ ] Production data visible (not development test data)
- [ ] No environment indicator visible (production only)
- [ ] All integrations work (Zoom, Google Calendar, etc.)

**Test Steps:**
```bash
# Deploy to production
git checkout main
git merge test/preview-env
git push origin main

# Wait for deployment to complete
# Check deployment status
vercel ls
```

**Verification in Production:**
1. Open custom domain in browser
2. Verify production data is present
3. Check browser dev tools > Application > Local Storage
4. Verify Supabase URL matches production

---

## 7. Environment Isolation

### Data Isolation Test

- [ ] Created test record in development Supabase via local dev
- [ ] Test record NOT visible in production
- [ ] Created test record in preview deployment
- [ ] Test record NOT visible in production
- [ ] Production data NOT visible in development/preview

**Test Steps:**
```bash
# In local development
# Create a test member/record with obvious test name (e.g., "TEST DELETE ME")

# Check production
# Open production site, verify test record is NOT there

# Check preview deployment
# Test record should be visible in preview (if using same dev Supabase)
```

### Environment Variable Isolation Test

- [ ] Production env vars different from preview/development
- [ ] Changing preview env vars doesn't affect production
- [ ] Changing development env vars doesn't affect production

**Test Steps:**
```bash
# Add test variable to preview only
vercel env add TEST_VAR preview
# Enter value: "preview-value"

# Verify not in production
vercel env ls | grep TEST_VAR
# Should show: preview only

# Clean up
vercel env rm TEST_VAR preview
```

---

## 8. Deployment Flow

### Git Workflow

- [ ] Feature branch creates preview deployment
- [ ] Preview deployment URL in GitHub PR comments (if GitHub integration enabled)
- [ ] Can create multiple previews for different branches
- [ ] Merging to main deploys to production
- [ ] Production deployment completes successfully

### Rollback Capability

- [ ] Can access previous deployments in Vercel dashboard
- [ ] Can promote previous deployment to production
- [ ] Can rollback via `vercel rollback` command

**Test Steps:**
```bash
# Create two deployments
git checkout -b test/rollback-1
git push origin test/rollback-1
# Note preview URL 1

git checkout -b test/rollback-2  
git push origin test/rollback-2
# Note preview URL 2

# Test rollback (in production later)
# vercel rollback <deployment-url-1>
```

---

## 9. Optional Enhancements

### Environment Indicator

If you implemented the EnvironmentIndicator component:

- [ ] Added `<EnvironmentIndicator />` to root layout
- [ ] Badge visible in development (blue "Development")
- [ ] Badge visible in preview (yellow "Preview")
- [ ] Badge NOT visible in production
- [ ] Badge shows correct branch name in preview

### Environment Configuration

If you created `lib/config.ts`:

- [ ] Can import and use `config` object
- [ ] `config.environment` returns correct value
- [ ] `config.isProduction` accurate in each environment
- [ ] `config.supabase.url` matches expected environment

**Test:**
```typescript
// In any component/API route
import { config } from '@/lib/config';

console.log('Environment:', config.environment);
console.log('Is Production:', config.isProduction);
console.log('Supabase URL:', config.supabase.url);
```

---

## Common Issues Checklist

If something doesn't work, check:

### DNS Issues
- [ ] Waited 1+ hour for DNS propagation
- [ ] DNS records match Vercel requirements exactly
- [ ] No conflicting DNS records (old A/CNAME records)
- [ ] CAA record allows Let's Encrypt

### Environment Variable Issues
- [ ] Env vars scoped to correct environment (not all three)
- [ ] Redeployed after changing env vars
- [ ] No typos in env var names
- [ ] Pulled latest env vars locally (`vercel env pull`)

### Supabase Connection Issues
- [ ] Supabase URL ends with `.supabase.co`
- [ ] Anon key is the long JWT token (starts with `eyJ`)
- [ ] RLS policies allow access for anon role (in development)
- [ ] No IP restrictions on Supabase project

### Build Issues
- [ ] `npm install` completed successfully
- [ ] No TypeScript errors (`npm run build`)
- [ ] No missing environment variables in build logs

---

## Final Sign-Off

Once all items are checked:

- [ ] All environments working independently
- [ ] Data properly isolated
- [ ] Custom domain accessible
- [ ] Team members can access appropriate environments
- [ ] Documentation updated with custom domain URL
- [ ] Credentials stored securely (1Password, secrets manager)
- [ ] Test data cleaned up from production
- [ ] Monitoring/alerts configured (optional)

**Congratulations!** Your multi-environment setup is complete.

---

## Maintenance Tasks

Regular maintenance:

### Monthly
- [ ] Review and rotate API credentials
- [ ] Check SSL certificate status (auto-renews)
- [ ] Verify DNS records still correct
- [ ] Review environment variable usage

### Quarterly  
- [ ] Audit access to Vercel/Supabase projects
- [ ] Review and clean up old preview deployments
- [ ] Update documentation with any changes
- [ ] Sync development schema with production if changed

### As Needed
- [ ] Add new team members to Vercel/Supabase
- [ ] Update environment variables when integrations change
- [ ] Document any new environment-specific configuration
