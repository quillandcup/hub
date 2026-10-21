-- Click-through of named controls: for each control (`data-track="..."`) seen in the window, how
-- many visits saw it (`element_seen`) and how many of those visits also clicked it
-- (`element_clicked` with the same name). A control nobody clicks still shows, with 0 clicked,
-- because the impression is the denominator. Lowest click-through first.
--
-- A "visit" is a member's session. A click only counts in a visit that also saw the control, so the
-- rate can't pass 100%. `first_seen` is the control's earliest impression ever (not just in the
-- window), so the page can hold back controls that are too new to judge. `route_prefix` keeps
-- only impressions on pages under it; `hide_admin` leaves out the admin area. The page applies the
-- thresholds that make a rate trustworthy (enough visits, old enough); this returns everything,
-- up to 500 controls.
--
-- SECURITY INVOKER, so RLS applies: admins see everyone, anyone else only their own events. Sudo
-- events are left out.
CREATE OR REPLACE FUNCTION analytics_control_rates(
    since timestamptz,
    route_prefix text DEFAULT NULL,
    hide_admin boolean DEFAULT false
)
RETURNS TABLE (
    name text,
    seen_sessions bigint,
    seen_members bigint,
    clicked_sessions bigint,
    clicked_members bigint,
    first_seen timestamptz
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
    WITH seen AS (
        SELECT DISTINCT e.properties ->> 'name' AS name, e.user_id, e.session_id
        FROM analytics_events e
        WHERE e.event = 'element_seen'
          AND e.occurred_at >= since
          AND NOT e.sudo
          AND e.properties ? 'name'
          AND (route_prefix IS NULL OR coalesce(starts_with(e.properties ->> 'route', route_prefix), false))
          AND (NOT hide_admin OR NOT coalesce(starts_with(e.properties ->> 'route', '/admin'), false))
    ),
    clicked AS (
        SELECT DISTINCT e.properties ->> 'name' AS name, e.user_id, e.session_id
        FROM analytics_events e
        WHERE e.event = 'element_clicked'
          AND e.occurred_at >= since
          AND NOT e.sudo
          AND e.properties ? 'name'
    ),
    launched AS (
        SELECT e.properties ->> 'name' AS name, min(e.occurred_at) AS first_seen
        FROM analytics_events e
        WHERE e.event = 'element_seen' AND NOT e.sudo AND e.properties ? 'name'
        GROUP BY 1
    )
    SELECT
        s.name,
        count(*),
        count(DISTINCT s.user_id),
        count(c.name),
        count(DISTINCT s.user_id) FILTER (WHERE c.name IS NOT NULL),
        l.first_seen
    FROM seen s
    LEFT JOIN clicked c ON c.name = s.name AND c.user_id = s.user_id AND c.session_id = s.session_id
    JOIN launched l ON l.name = s.name
    GROUP BY s.name, l.first_seen
    ORDER BY count(c.name)::numeric / count(*), count(*) DESC, s.name
    LIMIT 500;
$$;

REVOKE EXECUTE ON FUNCTION analytics_control_rates(timestamptz, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION analytics_control_rates(timestamptz, text, boolean) TO authenticated;
