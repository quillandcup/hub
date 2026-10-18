-- Record the browser/OS behind each access event, so a member's visit history
-- shows which devices they use (and we can see who is on Safari vs Chrome,
-- iPhone vs desktop, when deciding which browser features to build on).
-- Supabase's auth.sessions also has a user_agent, but those rows disappear at
-- sign-out or expiry; access_events is kept, so this is the durable record.
--
-- Written by the proxy (lib/supabase/middleware.ts) and the page-view tracker
-- (app/api/track/page-view), both through userAgentForStorage() in
-- lib/device-label.ts, which caps it at 512 characters. The CHECK backs that up,
-- since the header is client-controlled and the insert runs as the user.

ALTER TABLE access_events
    ADD COLUMN user_agent text CHECK (char_length(user_agent) <= 512);

COMMENT ON COLUMN access_events.user_agent IS
    'The request''s User-Agent header (capped at 512 chars), or NULL if none was sent. Label it with describeDevice() in lib/device-label.ts.';

-- Return type is changing (new user_agent column), so drop and recreate:
-- CREATE OR REPLACE FUNCTION can't change a RETURNS TABLE signature. Body is
-- 20260827160000_link_access_events_to_auth_sessions.sql's, plus user_agent.
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
    auth_session_created_at timestamptz,
    user_agent text
) AS $$
    WITH recent_events AS (
        SELECT path, is_page, session_id, user_agent, created_at
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
            user_agent,
            created_at,
            created_at - LAG(created_at) OVER (ORDER BY created_at) AS gap
        FROM recent_events
    ),
    grouped AS (
        SELECT
            path,
            is_page,
            session_id,
            user_agent,
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
            (array_agg(session_id ORDER BY created_at DESC) FILTER (WHERE session_id IS NOT NULL))[1] AS auth_session_id,
            -- Most recent user agent in the visit. Rows from before this
            -- column existed have none, so older visits return NULL.
            (array_agg(user_agent ORDER BY created_at DESC) FILTER (WHERE user_agent IS NOT NULL))[1] AS user_agent
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
        s.created_at AS auth_session_created_at,
        sg.user_agent
    FROM session_groups sg
    LEFT JOIN auth.sessions s ON s.id = sg.auth_session_id
    ORDER BY sg.session_start DESC;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Same lockdown as before: takes an arbitrary target_user_id with no internal
-- admin check, so only the service-role client in
-- app/api/admin/users/[id]/access-history (gated by requireAdmin()) may call it.
REVOKE EXECUTE ON FUNCTION get_access_sessions(uuid, integer, integer)
    FROM PUBLIC, anon, authenticated;
