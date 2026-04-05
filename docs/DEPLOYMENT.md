# Deployment Guide

## Security Status ✅

Before deploying, all critical security measures are in place:

- ✅ **Row Level Security (RLS)** enabled on all tables
- ✅ **Invite-only signups** - public registration disabled
- ✅ **User roles** - admin/assistant/member system ready
- ✅ **Environment variables** properly gitignored
- ✅ **API credentials** secured in .env files (not committed)

## Prerequisites

1. **Vercel Account** - https://vercel.com
2. **Supabase Account** - https://supabase.com
3. **API Credentials** (keep these from .env.local):
   - Zoom API credentials
   - Google Service Account Key
   - Google Calendar ID

## Step 1: Create Supabase Production Project

### 1.1 Create Project

1. Go to https://supabase.com/dashboard
2. Click **"New Project"**
3. Set:
   - **Organization**: Select or create
   - **Name**: `quillandcup-admin-portal` (or your preference)
   - **Database Password**: Generate a strong password (save this!)
   - **Region**: Choose closest to your users
4. Click **"Create new project"** (takes ~2 minutes)

### 1.2 Link Local Project to Production

```bash
# Link to production project
supabase link --project-ref <YOUR_PROJECT_REF>

# You'll find PROJECT_REF in your Supabase dashboard URL:
# https://supabase.com/dashboard/project/<PROJECT_REF>
```

### 1.3 Push Database Schema and Migrations

```bash
# Push all migrations to production
supabase db push

# Verify migrations applied
supabase migration list
```

### 1.4 Disable Public Signups in Production

**Disable Public Signups:**

1. In Supabase Dashboard, go to **Authentication** 
2. Find the toggle: **"Allow new users to sign up"**
3. **Disable this toggle**
4. Click **Save**

This prevents anyone from creating accounts directly. 

**Keep Email Provider Enabled:**
- The email provider toggle should stay **ON**
- This allows invited users to log in
- It's separate from the signup toggle

**To Invite Users in Production:**

1. Go to **Authentication → Users** 
2. Click **"Invite User"**
3. Enter email → User receives invite link
4. They set password and can log in

**Verify RLS Protection:**

Run this in SQL Editor to confirm all tables are protected:

```sql
-- Check RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;

-- All should show rowsecurity = true
```

### 1.5 Get Production API Keys

From Supabase Dashboard → **Settings → API**:

- `NEXT_PUBLIC_SUPABASE_URL` - Your project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Public anon key
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (keep secret!)

Save these for Vercel environment variables.

## Step 2: Deploy to Vercel

### 2.1 Install Vercel CLI (Optional)

```bash
npm install -g vercel
```

### 2.2 Deploy via CLI

```bash
# From project root
vercel

# Follow prompts:
# - Link to existing project or create new
# - Set up project (accept defaults for Next.js)
```

### 2.3 Or Deploy via GitHub

1. Push your code to GitHub:
   ```bash
   git push origin main
   ```

2. Go to https://vercel.com/new

3. Import your repository

4. Vercel auto-detects Next.js - click **Deploy**

### 2.4 Set Environment Variables in Vercel

Go to **Project Settings → Environment Variables** and add:

```bash
# Supabase (Production)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...

# Zoom API
ZOOM_ACCOUNT_ID=your_zoom_account_id
ZOOM_CLIENT_ID=your_zoom_client_id
ZOOM_CLIENT_SECRET=your_zoom_client_secret

# Google Calendar
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
GOOGLE_CALENDAR_ID=your_calendar_id@group.calendar.google.com
```

**Important**: 
- Set environment to **Production**
- For `GOOGLE_SERVICE_ACCOUNT_KEY`, paste the entire JSON object (Vercel handles multi-line)

### 2.5 Redeploy

After setting env vars:

```bash
vercel --prod
```

Or trigger a redeploy from Vercel dashboard.

## Step 3: Configure Supabase Auth Redirect URLs

In Supabase Dashboard → **Authentication → URL Configuration**:

Add your Vercel domain to:
- **Site URL**: `https://your-app.vercel.app`
- **Redirect URLs**: `https://your-app.vercel.app/**`

## Step 4: Invite Your First Admin User

1. Go to Supabase Dashboard → **Authentication → Users**
2. Click **"Invite User"**
3. Enter your email
4. Check your email for the invite link
5. Set your password and sign in

## Step 5: Verify Deployment

1. Visit your Vercel URL
2. Sign in with your invited user
3. Check that:
   - Dashboard loads
   - Navigation works
   - Data queries work (members, prickles, etc.)
   - Can import Zoom data
   - RLS prevents unauthorized access

## Troubleshooting

### Database Connection Errors

**Symptom**: "Failed to fetch" or database errors

**Fix**: 
1. Verify `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel
2. Check Supabase project is active (not paused)
3. Verify migrations applied: `supabase migration list`

### RLS Blocking Queries

**Symptom**: Empty results or "permission denied"

**Fix**:
1. Check user has profile in `user_profiles` table:
   ```sql
   SELECT * FROM user_profiles WHERE email = 'your@email.com';
   ```

2. If missing, create it:
   ```sql
   INSERT INTO user_profiles (id, email, role)
   SELECT id, email, 'admin' FROM auth.users WHERE email = 'your@email.com';
   ```

### Signup Form Still Works

**Symptom**: Users can sign up directly

**Fix**:
1. Disable in Supabase Dashboard → Authentication → Providers → Email
2. Uncheck "Enable email signups"

### Environment Variables Not Loading

**Symptom**: Undefined env vars in production

**Fix**:
1. Verify they're set in Vercel → Settings → Environment Variables
2. Redeploy after adding env vars
3. Check variable names match exactly (including `NEXT_PUBLIC_` prefix)

## Custom Domain (Optional)

In Vercel:
1. Go to **Project Settings → Domains**
2. Add your custom domain
3. Update DNS records as instructed
4. Add custom domain to Supabase redirect URLs

## Monitoring

### Vercel Analytics
- Automatically enabled
- View at https://vercel.com/dashboard/analytics

### Supabase Logs
- Database logs: Supabase Dashboard → Database → Logs
- Auth logs: Authentication → Logs
- API logs: API → Logs

## Maintenance

### Running New Migrations

```bash
# Create migration locally
supabase migration new your_migration_name

# Edit SQL file in supabase/migrations/

# Test locally
supabase migration up

# Push to production
supabase db push
```

### Backing Up Production Database

```bash
# Backup from Supabase Dashboard → Database → Backups
# Or via CLI
supabase db dump -f backup.sql --db-url "postgresql://..."
```

### Rolling Back

```bash
# Via Supabase Dashboard → Database → Backups → Restore
# Or via CLI
supabase db reset --db-url "postgresql://..."
```

## Security Checklist

Before going live:

- [ ] RLS enabled on all tables (verify in production)
- [ ] Public signups disabled
- [ ] Environment variables set in Vercel
- [ ] `.env.local` not committed to git
- [ ] Supabase service role key kept secret (not in client code)
- [ ] Auth redirect URLs configured
- [ ] Admin user invited and tested
- [ ] API keys rotated from defaults

## Cost Estimates

### Supabase Free Tier
- 500MB database
- 1GB file storage  
- 50,000 monthly active users
- **Cost**: Free

### Vercel Hobby Tier
- Unlimited deployments
- 100GB bandwidth/month
- Automatic HTTPS
- **Cost**: Free

Both should be sufficient for starting out. Monitor usage and upgrade as needed.

## Next Steps

After deployment:
1. Invite team members
2. Import initial data (members, Zoom attendance)
3. Set up monitoring alerts
4. Document operational procedures
5. Plan for scaling if needed

## Support

- Vercel Docs: https://vercel.com/docs
- Supabase Docs: https://supabase.com/docs
- Next.js Docs: https://nextjs.org/docs
