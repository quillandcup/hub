-- Self-service session management: lets a signed-in member see their own
-- active sessions (device/browser, IP, created/last-refreshed timestamps)
-- and revoke one, or sign out everywhere else in one action. Companion to
-- the admin-only get_access_sessions() in
-- 20260827140000_create_access_events.sql, but this one is self-scoped
-- (auth.uid()) and mutating, so any authenticated user can call it directly
-- with no admin gate — it can never touch another user's rows.
--
-- Supabase Auth (GoTrue) does not expose a public API to list a user's
-- sessions or revoke one specific session by id — supabase-js only offers
-- bulk scope-based signOut({ scope: 'local' | 'others' | 'global' }).
-- Per GoTrue's own source (internal/models/sessions.go), "revoke this one
-- session" IS literally `DELETE FROM auth.sessions WHERE id = ?` — that's
-- what its internal LogoutSession does, and refresh_tokens.session_id has
-- `ON DELETE CASCADE` onto auth.sessions, so deleting the row also revokes
-- that session's refresh tokens. Reading/deleting auth.sessions directly
-- via a SECURITY DEFINER function (scoped to auth.uid(), never taking a
-- target user id) reproduces that exact mechanism for self-service use.
--
-- Note this doesn't immediately kill a live access token — an already-issued
-- JWT can remain accepted until its exp claim, same caveat Supabase
-- documents for signOut(). In this app specifically, the effect is faster
-- than that worst case: lib/supabase/middleware.ts calls
-- supabase.auth.getUser() (a real network round-trip, not just local JWT
-- decoding) on every request, and GoTrue's getUser looks up the session by
-- the JWT's session_id claim — so a revoked session starts failing on the
-- very next request that hits our middleware, not just at token expiry.

CREATE OR REPLACE FUNCTION public.get_my_sessions()
RETURNS TABLE (
    id uuid,
    created_at timestamptz,
    updated_at timestamptz,
    refreshed_at timestamptz,
    not_after timestamptz,
    user_agent text,
    ip text,
    is_current boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        s.id,
        s.created_at,
        s.updated_at,
        s.refreshed_at,
        s.not_after,
        s.user_agent,
        host(s.ip) AS ip,
        s.id = (auth.jwt() ->> 'session_id')::uuid AS is_current
    FROM auth.sessions s
    WHERE s.user_id = auth.uid()
    ORDER BY COALESCE(s.refreshed_at, s.updated_at, s.created_at) DESC;
$$;

COMMENT ON FUNCTION public.get_my_sessions() IS
    'Lists the calling user''s own active Supabase Auth sessions (self-scoped via auth.uid()). Member-facing session management on /profile.';

REVOKE EXECUTE ON FUNCTION public.get_my_sessions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_sessions() TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_my_session(target_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    deleted_count integer;
BEGIN
    DELETE FROM auth.sessions
    WHERE id = target_session_id
      AND user_id = auth.uid();

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count > 0;
END;
$$;

COMMENT ON FUNCTION public.revoke_my_session(uuid) IS
    'Revokes one of the calling user''s own sessions by id (self-scoped via auth.uid() — cannot touch another user''s session). Cascades to auth.refresh_tokens via FK, matching GoTrue''s own single-session logout.';

REVOKE EXECUTE ON FUNCTION public.revoke_my_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_my_session(uuid) TO authenticated;
