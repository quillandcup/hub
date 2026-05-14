# Inviting Users to Hedgie Hub

## Overview

Public signups are **disabled** for security. Only admins can invite new users.

## Current Method: Supabase Studio

### Step 1: Access Supabase Studio

**Local Development:**
- Open http://127.0.0.1:54323
- Navigate to Authentication → Users

**Production:**
- Go to your Supabase project dashboard
- Navigate to Authentication → Users

### Step 2: Invite User

1. Click **"Invite User"** button
2. Enter the user's email address
3. Select **"Send invite email"**
4. User will receive an email with a secure link to set their password

### Step 3: Set User Role

After the user signs up:

1. Go to the SQL Editor in Supabase Studio
2. Run this query to set their role:

```sql
-- Set user as admin
UPDATE user_profiles 
SET role = 'admin' 
WHERE email = 'user@example.com';

-- OR set as assistant (read-only)
UPDATE user_profiles 
SET role = 'assistant' 
WHERE email = 'user@example.com';
```

## User Roles

### Admin
- Full access to all features
- Can import/export data
- Can manage prickle types, aliases, and calendar events
- **Default role for all new users**

### Assistant (Future)
- Read-only access to member data
- Can view attendance and engagement metrics
- Cannot edit, delete, or import data

### Member (Future)
- Can view only their own profile and attendance history
- Cannot access other members' data
- Cannot access admin tools

## Automated Role Assignment

By default, all new users are assigned the `admin` role automatically via a database trigger.

To change the default role for new users, update the trigger function:

```sql
CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_profiles (id, email, role)
    VALUES (NEW.id, NEW.email, 'assistant') -- Change default here
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

## Future Enhancement: In-App Invite Management

Planned features for a future update:

1. **Invite Management Page** (`/dashboard/admin/invites`)
   - List pending invites
   - Send new invites with pre-set role
   - Revoke unused invites

2. **Email Templates**
   - Custom welcome emails
   - Role-specific onboarding instructions

3. **Invite Tokens**
   - Generate secure invite links
   - Set expiration dates
   - Track who invited whom

## Security Notes

- Public signups are disabled in `supabase/config.toml` (`enable_signup = false`)
- Only authenticated users can invite others
- Invite emails use Supabase's secure authentication flow
- Users must verify their email before accessing the portal

## Troubleshooting

### User didn't receive invite email

**Local Development:**
- Check Mailpit at http://127.0.0.1:54324
- All emails in local dev go here instead of being sent

**Production:**
- Check Supabase logs for email delivery errors
- Verify SMTP settings in Supabase project settings
- Check user's spam folder

### User can't sign up

- Confirm `enable_signup = false` in config (this is correct)
- Users must be invited by an admin through Supabase Studio
- Cannot use the signup form directly

### User has wrong role

Run this query to update:

```sql
UPDATE user_profiles 
SET role = 'admin'  -- or 'assistant' or 'member'
WHERE email = 'user@example.com';
```

## Related Documentation

- [RLS Security](./RLS_SECURITY.md) - Row Level Security and permissions
- [TODO](./TODO.md) - Future RBAC enhancements
