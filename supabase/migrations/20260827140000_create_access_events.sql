-- Per-user login/access history: lets admins see when a user last came back
-- and what they did, even though they never "log out" (Supabase session
-- cookies persist across visits). A visit is sessionized by grouping events
-- with no >N-minute gap between them; an idle-but-open tab makes zero
-- requests, so it naturally falls off the end of a session rather than
-- extending it forever.
-- Local layer (operational data, append-only — not reprocessed from Bronze).

CREATE TABLE access_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    path text NOT NULL,
    -- false for /api/* requests: those still count as activity for
    -- sessionization (an SPA-style action that only calls an API shouldn't
    -- fracture the session) but are excluded from the page-trail display.
    is_page boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX access_events_user_created_idx ON access_events (user_id, created_at DESC);

ALTER TABLE access_events ENABLE ROW LEVEL SECURITY;

-- Logged from middleware using the request's own cookie-based session, so
-- users can only ever insert rows attributed to themselves.
CREATE POLICY "Users can log their own access events"
    ON access_events FOR INSERT
    WITH CHECK (user_id = auth.uid());

-- Admin-only read surface (app/api/admin/users/[id]/access-history); no
-- "my own history" view exists yet, so no self-select policy.
CREATE POLICY "Admins can view all access events"
    ON access_events FOR SELECT
    USING (is_admin());

-- Sessionize a user's raw events: group rows with no gap larger than
-- session_gap_minutes into one session, returning each session's start/end
-- and its ordered page trail (is_page rows only; API-only activity still
-- counts toward keeping the session alive via the gap calculation above).
CREATE OR REPLACE FUNCTION get_access_sessions(
    target_user_id uuid,
    session_gap_minutes integer DEFAULT 30,
    event_limit integer DEFAULT 2000
) RETURNS TABLE (
    session_start timestamptz,
    session_end timestamptz,
    event_count integer,
    pages jsonb
) AS $$
    WITH recent_events AS (
        SELECT path, is_page, created_at
        FROM access_events
        WHERE user_id = target_user_id
        ORDER BY created_at DESC
        LIMIT event_limit
    ),
    gapped AS (
        SELECT
            path,
            is_page,
            created_at,
            created_at - LAG(created_at) OVER (ORDER BY created_at) AS gap
        FROM recent_events
    ),
    grouped AS (
        SELECT
            path,
            is_page,
            created_at,
            COUNT(*) FILTER (
                WHERE gap IS NULL OR gap > make_interval(mins => session_gap_minutes)
            ) OVER (ORDER BY created_at) AS session_num
        FROM gapped
    )
    SELECT
        MIN(created_at) AS session_start,
        MAX(created_at) AS session_end,
        COUNT(*)::integer AS event_count,
        jsonb_agg(path ORDER BY created_at) FILTER (WHERE is_page) AS pages
    FROM grouped
    GROUP BY session_num
    ORDER BY session_start DESC;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Takes an arbitrary target_user_id with no internal admin check, so it must
-- not be callable via PostgREST by anon/authenticated — only the service-role
-- client in app/api/admin/users/[id]/access-history, which is already gated
-- by requireAdmin(), should ever invoke it.
REVOKE EXECUTE ON FUNCTION get_access_sessions(uuid, integer, integer)
    FROM PUBLIC, anon, authenticated;
