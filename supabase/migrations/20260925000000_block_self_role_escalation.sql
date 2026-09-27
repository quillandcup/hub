-- Block privilege escalation through user_profiles.
--
-- The "Users can update own profile" policy (USING/WITH CHECK auth.uid() = id)
-- lets every signed-in user UPDATE their own row, and `authenticated` holds
-- table-wide UPDATE, so a member could run
--   UPDATE user_profiles SET role = 'admin' WHERE id = auth.uid()
-- through the REST API and become an admin. Every admin check in the app
-- (requireAdmin, the admin layout, is_admin() in RLS) trusts this column.
--
-- A column-level GRANT can't fix it: admins change other users' roles from
-- their own `authenticated` session (app/api/admin/users/[id]/route.ts), so
-- revoking UPDATE (role) from `authenticated` would break that too. Instead a
-- BEFORE UPDATE trigger rejects changes to role/email/id unless the caller is
-- already an admin or a privileged database role (service_role for server-side
-- jobs and tests, postgres/supabase_admin for migrations). Members can still
-- update their own timezone_preference, the only column the app lets them set.

CREATE OR REPLACE FUNCTION public.guard_user_profile_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (NEW.role IS DISTINCT FROM OLD.role
      OR NEW.email IS DISTINCT FROM OLD.email
      OR NEW.id IS DISTINCT FROM OLD.id)
     AND current_user NOT IN ('postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin')
     AND NOT public.is_admin()
  THEN
    RAISE EXCEPTION 'Only admins can change role, email or id on user_profiles'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.guard_user_profile_privileged_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_user_profile_privileged_columns ON public.user_profiles;
CREATE TRIGGER guard_user_profile_privileged_columns
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_user_profile_privileged_columns();
