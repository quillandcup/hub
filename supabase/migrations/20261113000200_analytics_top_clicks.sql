-- The most-clicked things, from the autocaptured `element_clicked` events: each control named by
-- the best label it has (its data-track name or id, else its text, else the route a link goes to),
-- with how often, by how many members, in how many visits, and on how many different pages.
-- `route_prefix` keeps only clicks on pages under it ("/courses"); `hide_admin` leaves out the
-- admin area, where staff clicking around would drown out what members do.
-- SECURITY INVOKER, so RLS applies: admins see everything, anyone else only their own. Sudo
-- events are left out. At most 100 rows, most clicked first.
CREATE OR REPLACE FUNCTION analytics_top_clicks(
    since timestamptz,
    route_prefix text DEFAULT NULL,
    hide_admin boolean DEFAULT false
)
RETURNS TABLE (label text, element text, events bigint, members bigint, sessions bigint, routes bigint)
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT
        coalesce(
            nullif(e.properties ->> 'name', ''),
            nullif(e.properties ->> 'text', ''),
            nullif(e.properties ->> 'target_route', ''),
            '(unlabelled)'
        ),
        e.properties ->> 'element',
        count(*),
        count(DISTINCT e.user_id),
        count(DISTINCT (e.user_id, e.session_id)),
        count(DISTINCT e.properties ->> 'route')
    FROM analytics_events e
    WHERE e.event = 'element_clicked'
      AND e.occurred_at >= since
      AND NOT e.sudo
      AND (route_prefix IS NULL OR coalesce(starts_with(e.properties ->> 'route', route_prefix), false))
      AND (NOT hide_admin OR NOT coalesce(starts_with(e.properties ->> 'route', '/admin'), false))
    GROUP BY 1, 2
    ORDER BY count(*) DESC, 1
    LIMIT 100;
$$;

REVOKE EXECUTE ON FUNCTION analytics_top_clicks(timestamptz, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION analytics_top_clicks(timestamptz, text, boolean) TO authenticated;
