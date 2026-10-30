-- Keep the browser and device behind a visit once the raw user-agent string is gone.
--
-- /privacy promises that the exact IP address and the browser's identification string are removed after
-- 90 days (lib/retention.ts), keeping "the type of browser and device". `device` is that kept part:
-- { browser, browser_version, os, os_version, device_type }, parsed once when the row is written
-- (lib/device.ts). The job that removes the raw values (a later change) only touches a row that has it.
-- Nothing is removed here.

ALTER TABLE public.access_events
  ADD COLUMN device jsonb CHECK (device IS NULL OR jsonb_typeof(device) = 'object');

ALTER TABLE public.video_watch_segments
  ADD COLUMN device jsonb CHECK (device IS NULL OR jsonb_typeof(device) = 'object');

COMMENT ON COLUMN public.access_events.device IS
  'Browser, OS and device type parsed from the user agent when the row was written (lib/device.ts); NULL until the backfill reaches an older row or when there was nothing to read. Outlives user_agent.';
COMMENT ON COLUMN public.video_watch_segments.device IS
  'Browser, OS and device type parsed from the user agent when the row was written (lib/device.ts); outlives user_agent.';

-- A visit's device, next to its user agent. Return type changes, so drop and recreate; the body is the
-- latest one (20261107000000_access_events_user_agent.sql) plus `device`.
DROP FUNCTION IF EXISTS public.get_access_sessions(uuid, integer, integer);

CREATE FUNCTION public.get_access_sessions(
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
    user_agent text,
    device jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
    WITH recent_events AS (
        SELECT path, is_page, session_id, user_agent, device, created_at
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
            device,
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
            device,
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
            -- Most recent non-null session_id seen in this group: a group can span a token refresh (same
            -- session_id) but never two real logins, since the 30-minute gap splits those into separate groups.
            (array_agg(session_id ORDER BY created_at DESC) FILTER (WHERE session_id IS NOT NULL))[1] AS auth_session_id,
            -- Most recent user agent and device in the visit. Older rows have no device until the backfill
            -- reaches them, and no user agent once it has been removed.
            (array_agg(user_agent ORDER BY created_at DESC) FILTER (WHERE user_agent IS NOT NULL))[1] AS user_agent,
            (array_agg(device ORDER BY created_at DESC) FILTER (WHERE device IS NOT NULL))[1] AS device
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
        sg.user_agent,
        sg.device
    FROM session_groups sg
    LEFT JOIN auth.sessions s ON s.id = sg.auth_session_id
    ORDER BY sg.session_start DESC;
$function$;

-- Same lockdown as before: it takes an arbitrary target_user_id with no internal admin check, so only the
-- service-role client in app/api/admin/users/[id]/access-history (gated by requireAdmin()) may call it.
REVOKE EXECUTE ON FUNCTION public.get_access_sessions(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
