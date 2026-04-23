# Environment Setup - Getting Started

This directory contains all the documentation you need to set up custom domains and multi-environment configuration for the Quill & Cup Admin Portal.

## Quick Navigation

### For Setting Up Environments

1. **[QUICK_START.md](./QUICK_START.md)** - Start here
   - 5-minute setup for new developers
   - Common commands reference
   - Quick troubleshooting

2. **[DEPLOYMENT_SETUP.md](./DEPLOYMENT_SETUP.md)** - Complete guide
   - Custom domain configuration
   - Development Supabase setup
   - Environment variable management
   - Step-by-step instructions

3. **[VERIFICATION_CHECKLIST.md](./VERIFICATION_CHECKLIST.md)** - Verify your setup
   - Pre-setup checklist
   - Environment-by-environment verification
   - Common issues and solutions
   - Final sign-off checklist

### Helper Resources

- **`/scripts/setup-environments.sh`** - Interactive setup script
  - Quick Supabase credential setup
  - Full environment configuration
  - Pull environment variables

## What You'll Set Up

### 1. Custom Domain
Transform your Vercel deployment URL into a professional custom domain:
- **Before**: `https://quillandcup-admin.vercel.app`
- **After**: `https://admin.quillandcup.com` (or your chosen domain)

### 2. Environment Separation
Create isolated environments for safe development:

| Environment | Database | Use Case |
|-------------|----------|----------|
| **Production** | Production Supabase | Live data, customer-facing |
| **Preview** | Development Supabase | PR reviews, staging |
| **Development** | Development Supabase | Local coding, experiments |

### 3. Environment Variables
Proper credential management across environments:
- Production uses production Supabase
- Preview and Development use development Supabase
- External integrations (Zoom, Google, Kajabi) configurable per environment

## Setup Time Estimate

- **Quick setup** (Supabase only): 15 minutes
- **Full setup** (domain + all environments): 1-2 hours
  - Custom domain: 30 minutes + DNS propagation time (1-48 hours)
  - Supabase setup: 30 minutes
  - Environment variables: 15 minutes
  - Verification: 15-30 minutes

## Prerequisites

Before starting, ensure you have:

1. **Access**
   - [ ] Vercel project access (quillandcup/admin-portal)
   - [ ] Production Supabase project access
   - [ ] Custom domain DNS management access (if adding domain)

2. **Tools**
   - [ ] Node.js 18+ installed
   - [ ] Git installed
   - [ ] Vercel CLI installed (`npm install -g vercel`)

3. **Accounts**
   - [ ] Supabase account (for creating dev project)
   - [ ] DNS provider access (for custom domain)

## Getting Started

### Path 1: Just Need Local Development

```bash
# Clone repository
git clone <repository-url>
cd admin-portal

# Install dependencies
npm install

# Install Vercel CLI
npm install -g vercel

# Link to Vercel project
vercel link --yes --project admin-portal

# Pull environment variables
vercel env pull .env.local --environment=development

# Start development
npm run dev
```

See [QUICK_START.md](./QUICK_START.md) for more details.

### Path 2: Full Production Setup

Follow these guides in order:

1. **[DEPLOYMENT_SETUP.md](./DEPLOYMENT_SETUP.md)**
   - Complete all sections
   - Take your time with DNS configuration
   - Document your custom domain choice

2. **[VERIFICATION_CHECKLIST.md](./VERIFICATION_CHECKLIST.md)**
   - Work through each section
   - Check off items as you complete them
   - Don't skip verification steps

3. **Test everything**
   - Create test data in development
   - Verify isolation from production
   - Deploy a test preview
   - Deploy to production

### Path 3: Using the Setup Script

For interactive guided setup:

```bash
./scripts/setup-environments.sh
```

Choose from:
1. Quick Setup - Configure Supabase credentials only
2. Full Setup - Configure all environment variables
3. List current environment variables
4. Pull environment variables to .env.local

## What Gets Created

### Files
- `.env.local` - Local environment variables (gitignored)
- `.vercel/` - Vercel project configuration (gitignored)
- `lib/config.ts` - Environment-aware configuration (optional)
- `components/EnvironmentIndicator.tsx` - Visual environment badge (optional)

### Supabase
- New development project with same schema as production
- Separate database for testing
- Isolated from production data

### Vercel
- Environment variables scoped to Production/Preview/Development
- Custom domain pointing to production
- Branch-based preview deployments

## Common Questions

### Q: Do I need a custom domain?
**A:** No, it's optional. The Vercel URL (`quillandcup-admin.vercel.app`) works fine. Custom domains are mainly for branding and easier sharing.

### Q: Can I skip the development Supabase project?
**A:** Not recommended. Without it, your local development and preview deployments will use production data, which is risky.

### Q: How much does this cost?
**A:** 
- Vercel Hobby tier: Free (current plan)
- Supabase Free tier: Free for dev project
- Custom domain: Varies by registrar ($10-15/year typically)
- Total added cost: ~$10-15/year for domain only

### Q: What if I already have environment variables set in Vercel?
**A:** The setup guide includes steps to update existing variables and change their scope from "all environments" to specific environments.

### Q: Will this affect my current production deployment?
**A:** Not until you explicitly deploy. The setup is safe to do incrementally, and you can test everything in preview deployments before touching production.

### Q: Do my team members need to do this setup too?
**A:** They only need the quick local setup (vercel link + env pull). The production environment configuration is done once per project, not per developer.

## Support

### Documentation
- Full setup guide: [DEPLOYMENT_SETUP.md](./DEPLOYMENT_SETUP.md)
- Quick reference: [QUICK_START.md](./QUICK_START.md)
- Verification: [VERIFICATION_CHECKLIST.md](./VERIFICATION_CHECKLIST.md)

### External Resources
- [Vercel Domains Documentation](https://vercel.com/docs/projects/domains)
- [Vercel Environment Variables](https://vercel.com/docs/projects/environment-variables)
- [Supabase CLI Documentation](https://supabase.com/docs/guides/cli)
- [Next.js Environment Variables](https://nextjs.org/docs/app/building-your-application/configuring/environment-variables)

### Troubleshooting
See the "Common Issues" sections in:
- [DEPLOYMENT_SETUP.md](./DEPLOYMENT_SETUP.md#common-issues-and-solutions)
- [VERIFICATION_CHECKLIST.md](./VERIFICATION_CHECKLIST.md#common-issues-checklist)

## Next Steps

Once you've completed the setup:

1. **Update Team Documentation**
   - Add custom domain to team wiki/docs
   - Document access procedures
   - Share environment overview with team

2. **Set Up Monitoring** (optional)
   - Configure Vercel deployment notifications
   - Set up error tracking (Sentry, etc.)
   - Enable analytics if desired

3. **Regular Maintenance**
   - Review environment variables quarterly
   - Keep development and production schemas in sync
   - Rotate credentials as needed

## Files in This Directory

```
docs/
├── ENVIRONMENT_SETUP_README.md  ← You are here
├── QUICK_START.md               ← Start here for local development
├── DEPLOYMENT_SETUP.md          ← Complete setup guide
├── VERIFICATION_CHECKLIST.md    ← Verify your setup
├── TODO.md                      ← Project roadmap and future work
├── KAJABI_DATA_MODEL.md         ← Kajabi integration design
├── KAJABI_SCRAPER_DESIGN.md     ← Automation plans
└── KAJABI_ZAPIER_ANALYSIS.md    ← Alternative integration analysis
```

## Ready to Begin?

1. Review [QUICK_START.md](./QUICK_START.md) for immediate local development
2. Follow [DEPLOYMENT_SETUP.md](./DEPLOYMENT_SETUP.md) for full production setup
3. Use [VERIFICATION_CHECKLIST.md](./VERIFICATION_CHECKLIST.md) to confirm everything works

Good luck with your setup! The investment in proper environment separation will pay off in development velocity and production stability.
