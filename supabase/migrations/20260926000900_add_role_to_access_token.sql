-- Custom Access Token Hook: put user_profiles.role into every access token Supabase Auth mints,
-- as the `app_role` claim, so proxy.ts's optimistic /admin pre-filter can read the role from the
-- already-verified JWT instead of querying user_profiles on every /admin request.
--
-- `app_role`, not `role`: the reserved `role` claim is the Postgres role PostgREST switches to
-- and must stay `authenticated`.
--
-- Claim values:
--   * "admin" / "assistant" / "member"  -- user_profiles.role
--   * null                              -- no user_profiles row (never an admin)
--   * absent                            -- token minted before the hook was enabled, or the
--                                          lookup failed; the proxy falls back to a DB read
--
-- The claim is a hint for the proxy only. It is as old as the access token (auth.jwt_expiry,
-- 1h), so requireAdminPage()/requireAdminAction() (lib/admin-auth.ts) keep reading
-- user_profiles for the real authorization decision. See "Admin Route Protection" in CLAUDE.md.
--
-- Enabled locally by [auth.hook.custom_access_token] in supabase/config.toml. The migration
-- must be applied before the hook is enabled on a project: Auth refuses to issue tokens
-- (sign-in and refresh fail) while the hook points at a function that doesn't exist.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  claims jsonb := event -> 'claims';
  user_role text;
BEGIN
  BEGIN
    SELECT p.role INTO user_role
    FROM public.user_profiles AS p
    WHERE p.id = (event ->> 'user_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    -- A hook error blocks sign-in and token refresh for everyone. Never do that over a hint:
    -- leave the claim out and let the proxy fall back to its DB read.
    RETURN event;
  END;

  -- No row → JSON null (to_jsonb(NULL) is SQL NULL, which jsonb_set would turn into a NULL event).
  claims := jsonb_set(claims, '{app_role}', COALESCE(to_jsonb(user_role), 'null'::jsonb));
  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

COMMENT ON FUNCTION public.custom_access_token_hook(jsonb) IS
  'Supabase Auth custom access token hook: adds the app_role claim from user_profiles.role. '
  'Optimistic hint for proxy.ts only; lib/admin-auth.ts re-checks user_profiles.';

-- Only Supabase Auth may run it (not callable through PostgREST /rpc).
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM service_role;

-- The hook runs as supabase_auth_admin, which is subject to user_profiles' RLS. Read-only,
-- and only for this role; the app's own policies on user_profiles are unchanged.
GRANT SELECT ON TABLE public.user_profiles TO supabase_auth_admin;

DROP POLICY IF EXISTS "Auth admin can read roles for access token hook" ON public.user_profiles;
CREATE POLICY "Auth admin can read roles for access token hook"
  ON public.user_profiles
  AS PERMISSIVE
  FOR SELECT
  TO supabase_auth_admin
  USING (true);
