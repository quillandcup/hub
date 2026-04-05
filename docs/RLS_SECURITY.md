# Row Level Security (RLS) Implementation

## Overview

This document describes the Row Level Security implementation for the Quill & Cup Admin Portal.

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
