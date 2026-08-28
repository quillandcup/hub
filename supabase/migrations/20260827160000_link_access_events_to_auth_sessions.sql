-- Link the heuristic (gap-sessionized) access-event trail to real Supabase
-- Auth sessions, and give admins a way to force-revoke a user's sessions.
--
-- Why: get_access_sessions() groups access_events by a 30-minute activity
-- gap, which approximates "a visit" but isn't the same thing as a real
-- login — a tab reopened after 31 idle minutes on a still-valid token looks
-- like a new "session" there even though no new auth.sessions row was
-- created. Tagging each event with the JWT's session_id (captured in
-- middleware.ts, see lib/supabase/session-claims.ts) lets us join back to
-- the actual auth.sessions row for the true login time and whether that
-- session is still active (i.e. hasn't been revoked / hasn't expired).

ALTER TABLE access_events ADD COLUMN session_id uuid;

CREATE INDEX access_events_session_id_idx ON access_events (session_id)
    WHERE session_id IS NOT NULL;

-- Return type is changing (new output columns), so the old function must be
-- dropped before recreating — CREATE OR REPLACE FUNCTION disallows changing
-- a RETURNS TABLE signature in place.
DROP FUNCTION IF EXISTS get_access_sessions(uuid, integer, integer);

CREATE FUNCTION get_access_sessions(
    target_user_id uuid,
    session_gap_minutes integer DEFAULT 30,
    event_limit integer DEFAULT 2000
) RETURNS TABLE (
    session_start timestamptz,
    session_end timestamptz,
    event_count integer,
    pages jsonb,
    auth_session_id uuid,
    session_active boolean,
    auth_session_created_at timestamptz
) AS $$
    WITH recent_events AS (
        SELECT path, is_page, session_id, created_at
        FROM access_events
        WHERE user_id = target_user_id
        ORDER BY created_at DESC
        LIMIT event_limit
    ),
    gapped AS (
        SELECT
            path,
            is_page,
            session_id,
            created_at,
            created_at - LAG(created_at) OVER (ORDER BY created_at) AS gap
        FROM recent_events
    ),
    grouped AS (
        SELECT
            path,
            is_page,
            session_id,
            created_at,
            COUNT(*) FILTER (
                WHERE gap IS NULL OR gap > make_interval(mins => session_gap_minutes)
            ) OVER (ORDER BY created_at) AS session_num
        FROM gapped
    ),
    session_groups AS (
        SELECT
            MIN(created_at) AS session_start,
            MAX(created_at) AS session_end,
            COUNT(*)::integer AS event_count,
            jsonb_agg(path ORDER BY created_at) FILTER (WHERE is_page) AS pages,
            -- Most recent non-null session_id seen in this group — a group
            -- can span a token refresh (same session_id) but should never
            -- span two different real logins given the 30-min gap already
            -- splits those into separate groups.
            (array_agg(session_id ORDER BY created_at DESC) FILTER (WHERE session_id IS NOT NULL))[1] AS auth_session_id
        FROM grouped
        GROUP BY session_num
    )
    SELECT
        sg.session_start,
        sg.session_end,
        sg.event_count,
        sg.pages,
        sg.auth_session_id,
        (s.id IS NOT NULL) AS session_active,
        s.created_at AS auth_session_created_at
    FROM session_groups sg
    LEFT JOIN auth.sessions s ON s.id = sg.auth_session_id
    ORDER BY sg.session_start DESC;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Takes an arbitrary target_user_id with no internal admin check, so it must
-- not be callable via PostgREST by anon/authenticated — only the service-role
-- client in app/api/admin/users/[id]/access-history, which is already gated
-- by requireAdmin(), should ever invoke it.
REVOKE EXECUTE ON FUNCTION get_access_sessions(uuid, integer, integer)
    FROM PUBLIC, anon, authenticated;

-- Force-revoke every active session for a user (admin "sign out everywhere"
-- action). Deleting the auth.sessions row is exactly how GoTrue itself logs
-- a session out — auth.refresh_tokens.session_id cascades on delete, and the
-- next request through this app's own middleware (which calls the verified,
-- DB-round-tripping supabase.auth.getUser() on every request) will fail.
--
-- Admins can't reach a member's real session via sudo mode (lib/sudo.ts is a
-- pure app-level adminId:memberId cookie — auth.uid() never changes), so this
-- is the only way for an admin to force a member's session(s) to end.
CREATE FUNCTION revoke_user_sessions(target_user_id uuid) RETURNS void AS $$
    DELETE FROM auth.sessions WHERE user_id = target_user_id;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

-- Same lockdown as get_access_sessions: takes an arbitrary target with no
-- internal admin check, so only the service-role client in
-- app/api/admin/users/[id]/revoke-sessions (gated by requireAdmin()) may
-- call it — never expose this to PostgREST for anon/authenticated.
REVOKE EXECUTE ON FUNCTION revoke_user_sessions(uuid)
    FROM PUBLIC, anon, authenticated;
