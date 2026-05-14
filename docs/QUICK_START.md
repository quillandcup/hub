# Quick Start Guide

This guide gets you up and running with the Hedgie Hub in different environments.

## For New Developers

### Prerequisites

- Node.js 18+ installed
- Access to the Vercel project (quillandcup/hub)
- Access to development Supabase project credentials

### Setup in 5 Minutes

1. **Clone and install dependencies**
   ```bash
   git clone <repository-url>
   cd hub
   npm install
   ```

2. **Install Vercel CLI**
   ```bash
   npm install -g vercel
   ```

3. **Link to Vercel project**
   ```bash
   vercel link --yes --project hub
   ```

4. **Pull development environment variables**
   ```bash
   vercel env pull .env.local --environment=development
   ```

5. **Start development server**
   ```bash
   npm run dev
   ```

6. **Open browser**
   ```
   http://localhost:3000
   ```

That's it! You're now running the admin portal locally with development Supabase.

---

## Environment Overview

| Environment | Trigger | Database | URL |
|-------------|---------|----------|-----|
| **Development** | `npm run dev` | Dev Supabase | http://localhost:3000 |
| **Preview** | Push to feature branch | Dev Supabase | `https://hub-*.vercel.app` |
| **Production** | Push to main branch | Prod Supabase | Custom domain + `https://quillandcup-admin.vercel.app` |

---

## Common Tasks

### Add Custom Domain

```bash
# Via Vercel dashboard
1. Go to: https://vercel.com/quillandcup/hub/settings/domains
2. Enter your domain (e.g., hub.quillandcup.com)
3. Follow DNS configuration instructions
4. Wait for SSL certificate to provision (5-10 minutes)
```

See [DEPLOYMENT_SETUP.md](./DEPLOYMENT_SETUP.md#1-custom-domain-configuration) for detailed instructions.

### Update Environment Variables

```bash
# Add a new environment variable for production
vercel env add MY_NEW_VAR production

# Add for preview/development
vercel env add MY_NEW_VAR preview
vercel env add MY_NEW_VAR development

# List all environment variables
vercel env ls

# Pull updated variables locally
vercel env pull .env.local
```

### Deploy to Production

```bash
# Option 1: Push to main (recommended)
git checkout main
git merge feature-branch
git push origin main
# Vercel automatically deploys

# Option 2: Manual deploy via CLI
vercel --prod
```

### Create Preview Deployment

```bash
# Push to any branch except main
git checkout -b feature/my-feature
git push origin feature/my-feature
# Vercel creates preview deployment automatically
```

### Switch Between Environments Locally

```bash
# Use development environment (default)
vercel env pull .env.local --environment=development
npm run dev

# Test with preview environment
vercel env pull .env.local --environment=preview
npm run dev

# Test with production environment (use carefully!)
vercel env pull .env.local --environment=production
npm run dev
```

---

## Troubleshooting

### "Cannot connect to Supabase"

**Solution**: Check your environment variables
```bash
# Verify .env.local has correct values
cat .env.local | grep SUPABASE

# Re-pull from Vercel
vercel env pull .env.local --environment=development

# Restart dev server
npm run dev
```

### "Module not found" errors

**Solution**: Reinstall dependencies
```bash
rm -rf node_modules package-lock.json
npm install
```

### Preview deployment using production database

**Solution**: Verify environment variable scoping
```bash
vercel env ls

# Should show:
# NEXT_PUBLIC_SUPABASE_URL: Production URL for "Production"
# NEXT_PUBLIC_SUPABASE_URL: Dev URL for "Preview"
```

If all are the same, see [DEPLOYMENT_SETUP.md](./DEPLOYMENT_SETUP.md#step-31-create-environment-specific-variables)

### Local development slow or errors

**Solution**: Check you're using development Supabase (not production)
```bash
# Verify current environment
cat .env.local | grep NEXT_PUBLIC_SUPABASE_URL

# Should show dev Supabase URL, not production
```

---

## Next Steps

- **Full Setup Guide**: [DEPLOYMENT_SETUP.md](./DEPLOYMENT_SETUP.md)
- **Database Schema**: Check `/supabase/migrations`
- **API Routes**: See `/app/api` directory
- **Development Guidelines**: [../CLAUDE.md](../CLAUDE.md)

---

## Quick Reference Commands

```bash
# Development
npm run dev                              # Start dev server
npm run build                           # Build for production
npm run lint                            # Run linter
npm test                                # Run tests

# Vercel CLI
vercel                                  # Deploy preview
vercel --prod                           # Deploy to production
vercel env ls                           # List environment variables
vercel env pull .env.local              # Pull env vars to local
vercel env add VAR_NAME environment     # Add environment variable
vercel domains ls                       # List domains
vercel logs                             # View deployment logs

# Git workflow
git checkout -b feature/my-feature      # Create feature branch
git push origin feature/my-feature      # Push (creates preview deployment)
git checkout main                       # Switch to main
git merge feature/my-feature            # Merge feature
git push origin main                    # Push (deploys to production)
```

---

## Support

- **Vercel Dashboard**: https://vercel.com/quillandcup/hub
- **Deployment Logs**: https://vercel.com/quillandcup/hub/deployments
- **Environment Variables**: https://vercel.com/quillandcup/hub/settings/environment-variables
- **Domain Settings**: https://vercel.com/quillandcup/hub/settings/domains
