set lock_timeout = '5s';

-- Several roles per user, contract step 2 (docs/architecture/PERMISSIONS.md, "A person can hold several roles"): drop the old
-- user_profiles.role column. user_roles is the only place a person's roles live. The previous step (20271102000000_user_roles_readers)
-- moved every reader to user_roles and has been deployed, so nothing in the app or in the database reads the column any more
-- (production, read-only, before this migration: the column and user_roles agreed for every user, and the only functions that
-- mention it are the three below).
--
--   * user_has_any_role(): user_roles only (the column was its second source).
--   * guard_user_profile_privileged_columns(): no longer compares role (email and id stay guarded).
--   * create_user_profile(): the new profile has no role to default.
--   * custom_access_token_hook(): the token carries app_roles only; app_role (the primary role) had no reader.
--   * The sync both ways between the column and user_roles goes: sync_profile_role (on user_roles) and sync_user_roles_insert and
--     sync_user_roles_update (on user_profiles) with their two functions.
--   * The user_profiles audit trigger is one trigger again (insert, update and delete); it was split in two only to leave out role.
--   * The index on role, the check constraint and the column are dropped.

-- 1. Functions and triggers that name the column are replaced before it goes.
CREATE OR REPLACE FUNCTION public.user_has_any_role(p_user uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user AND role = ANY (p_roles));
$function$;

COMMENT ON FUNCTION public.user_has_any_role(uuid, text[]) IS
  'Whether a user holds any of these staff roles (user_roles). Not callable by clients; is_admin() and the other helpers use it.';

CREATE OR REPLACE FUNCTION public.guard_user_profile_privileged_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (NEW.email IS DISTINCT FROM OLD.email
      OR NEW.id IS DISTINCT FROM OLD.id)
     AND current_user NOT IN ('postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin')
     AND NOT public.is_admin()
  THEN
    RAISE EXCEPTION 'Only admins can change email or id on user_profiles'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_user_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    INSERT INTO public.user_profiles (id, email)
    VALUES (NEW.id, NEW.email)
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.create_user_profile() IS 'Auto-creates the user profile on signup (a new account holds no staff role)';

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  claims jsonb := event -> 'claims';
  user_roles_list jsonb;
BEGIN
  BEGIN
    SELECT COALESCE(jsonb_agg(r.role ORDER BY public.staff_role_rank(r.role)), '[]'::jsonb) INTO user_roles_list
    FROM public.user_roles AS r
    WHERE r.user_id = (event ->> 'user_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    -- A hook error blocks sign-in and token refresh for everyone. Never do that over a hint:
    -- leave the claim out and let the proxy refuse the admin area until a token carries it.
    RETURN event;
  END;

  RETURN jsonb_set(event, '{claims}', jsonb_set(claims, '{app_roles}', user_roles_list));
END;
$$;

COMMENT ON FUNCTION public.custom_access_token_hook(jsonb) IS
  'Supabase Auth custom access token hook: adds app_roles (every staff role held, highest first, from user_roles). '
  'Optimistic hint for the proxy only; src/lib/admin-auth.ts re-checks the database.';

COMMENT ON TABLE public.user_roles IS
  'The staff roles a user holds (a member holds none). What they may do is the union of the roles. [id prefix: urol_]';

COMMENT ON FUNCTION public.set_user_roles(uuid, text[]) IS
  'Replaces a user''s staff roles (member = none). Admin, assistant (only roles below assistant, on people below assistant) or the service role. The user_roles triggers enforce who may change what and write the Activity Log entries as the caller.';

-- 2. The sync between the column and user_roles, and the split audit trigger.
-- The triggers only copied between the column and user_roles; nothing reads the column (previous PR, deployed).
DROP TRIGGER sync_profile_role ON public.user_roles;
DROP TRIGGER sync_user_roles_insert ON public.user_profiles;
DROP TRIGGER sync_user_roles_update ON public.user_profiles;
-- Approved ban-drop-function ignore (the user, in the session): the trigger above was the only caller, and it is dropped in this migration.
-- squawk-ignore ban-drop-function
DROP FUNCTION public.sync_profile_role_from_user_roles();
-- Approved ban-drop-function ignore (the user, in the session): the two triggers above were the only callers, and they are dropped in this migration.
-- squawk-ignore ban-drop-function
DROP FUNCTION public.sync_user_roles_from_profile_role();

DROP TRIGGER audit_row_change ON public.user_profiles;
DROP TRIGGER audit_row_change_update ON public.user_profiles;
CREATE TRIGGER audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('user_profile', 'id');

-- 3. The column, with its index and check.
DROP INDEX public.idx_user_profiles_role;

-- Approved ban-drop-constraint ignore (the user, in the session): the check only listed the values of the column that is dropped
-- next; no live code depends on it.
-- squawk-ignore ban-drop-constraint
ALTER TABLE public.user_profiles DROP CONSTRAINT user_profiles_role_check;

-- Approved ban-drop-column ignore (the user, in the session): the previous PR (20271102000000_user_roles_readers) stopped every
-- read of the column and is deployed; production's column and user_roles agreed for every user.
-- squawk-ignore ban-drop-column
ALTER TABLE public.user_profiles DROP COLUMN role;

NOTIFY pgrst, 'reload schema';
