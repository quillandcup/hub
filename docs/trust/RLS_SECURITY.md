# Row Level Security (RLS) Implementation

> **Status:** living. Kept up to date with the code; if it is wrong, fix it.

## Overview

This document describes the Row Level Security implementation for the Hedgie Hub.

## Current State

**Status**: ✅ RLS Enabled (Basic)

All tables have RLS enabled with policies that grant full access to authenticated users. This is secure for the current use case where all users are admins.

## User Roles

### Implemented Roles

1. **Admin** (default)
   - Full read/write access to all tables
   - Can import/export data
   - Can manage prickle types, aliases, and calendar events
   - Default role for all new users

### Future Roles (Not Implemented)

2. **Assistant**
   - Read-only access to member data
   - Can view attendance and engagement metrics
   - Cannot edit, delete, or import data

3. **Member**
   - Can view only their own profile and attendance history
   - Cannot access other members' data
   - Cannot access admin tools

## Table Access Policies

### Current Implementation

All authenticated users get full CRUD access to all tables:

**Bronze Layer:**
- `kajabi_members` - READ/WRITE
- `zoom_attendees` - READ/WRITE  
- `prickles` - READ/WRITE
- `calendar_events` - READ/WRITE
- `member_hiatus_history` - READ/WRITE
- `member_name_aliases` - READ/WRITE
- `prickle_types` - READ/WRITE
- `unmatched_calendar_events` - READ/WRITE

**Silver Layer:**
- `members` - READ/WRITE
- `attendance` - READ/WRITE
- `member_metrics` - READ/WRITE

**Gold Layer:**
- `member_engagement` - READ/WRITE
- `prickle_popularity` - READ/WRITE
- `member_activities` - READ/WRITE
- `activity_types` - READ

**Auth:**
- `user_profiles` - Users can read their own; admins can read/write all

## How to Add Role-Based Restrictions

### Step 1: Update user_profiles table

Add new role to the CHECK constraint:

```sql
ALTER TABLE user_profiles DROP CONSTRAINT user_profiles_role_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check 
    CHECK (role IN ('admin', 'assistant', 'member', 'new_role'));
```

### Step 2: Create role-specific policies

Replace the broad "authenticated users" policies with role-specific ones:

```sql
-- Example: Assistants get read-only access to members
CREATE POLICY "Assistants can view members"
    ON members FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles
            WHERE id = auth.uid() AND role IN ('admin', 'assistant')
        )
    );

-- Example: Only admins can modify members
CREATE POLICY "Admins can modify members"
    ON members FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );
```

### Step 3: Update UI based on role

Fetch user role in layout and pass to components:

```typescript
// In app/dashboard/layout.tsx
const { data: profile } = await supabase
  .from('user_profiles')
  .select('role')
  .eq('id', user.id)
  .single();

// Show/hide features based on profile.role
```

### Step 4: Test thoroughly

- Test each role with real users
- Verify read/write permissions
- Check edge cases (deleted users, role changes, etc.)

## Storage buckets

Files live in Supabase Storage buckets, and `storage.objects` has row level security like any table. Two kinds of bucket:

- **Server-only (no policy, on purpose):** `media` (the media library, `docs/product/MEDIA_LIBRARY.md`), `help-images`, `course-files` and `slack-files`. With RLS on and no policy, the API (anon and signed-in members alike) can't list, read or write them; only the service role can. The app checks who is asking and streams the file (`/api/media/<id>/<preset>`, `/api/courses/image/...`, the chat and course file routes). The Supabase dashboard shows "0 policies" for these: that is the locked-down state, not a gap. Don't add a policy to open one; if a member needs something, add a route that checks them. `supabase/tests/database/storage_buckets.test.sql` fails if a policy names one of them.
- **Members write to their own folder:** `feedback-screenshots` (the feedback widget uploads a PNG with the member's own session; a policy allows `<their user id>/...`, and the bucket limits it to a PNG of at most 5 MB) and `event-photos` (admins only; limited to 25 MB a photo). A bucket like this needs a policy for each action, and a size limit and MIME types where the content is predictable: the default limit is 50 MB of anything.

A bucket with a limit set says it in the dashboard; "Unset (50 MB)" is the project default. `book-covers` (public, members could write to it) and `course-images` are retired: nothing uses them, and a bucket can only be deleted through the Storage API or the dashboard, not SQL.

## Table privileges (grants)

Row level security decides which rows a role sees; grants decide whether it may touch the table at all. Both should say no to what the role never needs. The signed-out role (`anon`) holds no privileges on any table in `public` or `bronze`: signed-out pages and routes use the service role (after their own check), and everything signed-in runs as `authenticated`. Default privileges for the migration role also hand `anon` nothing on new tables and sequences, so a new table starts closed and only the grants its migration writes (`authenticated`, `service_role`) exist. `supabase/tests/database/anon_has_no_table_privileges.test.sql` fails if `anon` holds a privilege on any table or a new table gets one. If a table ever has to be readable signed-out, grant that one privilege in its migration with the reason beside it, and change the test's expectation for it. Functions are separate: `is_admin()` and the other helpers keep their execute grants.

## Security definer functions and the guard

A `SECURITY DEFINER` function runs with its owner's rights, so it skips row level security and the caller's grants. One that signed-in users can execute must check who is calling. `supabase/tests/database/security_guards.test.sql` (with the check that every table in `public` and `bronze` has RLS on) fails CI when a function in `public` that `anon` or `authenticated` can execute:

- has no recognizable caller check in its body (`auth.uid()`, `auth.role()`, `auth.jwt()`, `is_admin()`, `is_community_manager()`, `current_member_id()`, `current_acting_as_member_id()`, or a helper built on them such as `has_course_access` or the `chat_*` visibility helpers), and is not a reviewed exception;
- does not set its `search_path`; or
- is executable by `anon`, other than `is_admin()` (it returns false when signed out).

**The limit.** The test proves a check exists, not that it is correct or on every path. A human reads each new definer function in its PR: what it reads or writes, who can call it, and whether it checks the caller before touching data. Prefer a check in the body; revoke `EXECUTE` from `public` and `anon` in the migration and grant only what is needed.

**Adding a reviewed exception** (a function that deliberately returns data meant for any signed-in member, or only delegates to one that checks): add one line to `reviewed_exceptions` in the test with the signature, a one-line reason and the PR where it was reviewed. A stale entry (the function is gone, or now has a check) fails the test, so the list stays honest. The current ones: the member directory's alias list and search (aliases of directory-visible members only), per-mentor match counts (members cannot read the matches table, and badges need the counts), and a one-line wrapper over a checked function. `get_profile_writing` returns only items a member marked to show on their profile, and needs no exception.

## Helper Functions

### `is_admin()`

Checks if the current user is an admin:

```sql
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM user_profiles
        WHERE id = auth.uid() AND role = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

Usage in policies:

```sql
CREATE POLICY "Admin only"
    ON some_table FOR ALL
    USING (is_admin());
```

## Auto-Created User Profiles

New users automatically get a `user_profiles` record with role `'admin'` via the `on_auth_user_created` trigger.

To change the default role for new signups, update the trigger function:

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

## Migration Path

When ready to implement role-based access:

1. Identify which users should be admins vs assistants
2. Update their roles in `user_profiles` table
3. Create new policies for each role (see examples above)
4. Drop the broad "authenticated users" policies
5. Test with each role
6. Update UI to show/hide features per role

## Security Considerations

- **Default Deny**: RLS is enabled, so any query without a matching policy will be denied
- **Service Role Bypass**: The service role bypasses RLS (used for migrations and admin scripts)
- **SECURITY DEFINER**: Helper functions run with elevated privileges - be careful with these
- **Policy Overlap**: Multiple policies are OR'd together - be mindful of granting too much access

## References

- [Supabase RLS Documentation](https://supabase.com/docs/guides/auth/row-level-security)
- Migration: `supabase/migrations/20260405172401_setup_rls_and_user_profiles.sql`
- User Profiles Table: `user_profiles`
