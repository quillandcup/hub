-- Counts of one event grouped by the value of one of its properties (live vs off air, element
-- kind, ...), for the explorer at /admin/analytics/explore. `filter` limits it to events whose
-- properties contain it, like a funnel step's filter. At most 50 values, most frequent first.
-- SECURITY INVOKER, so the table's RLS applies: admins see everything, anyone else only their own
-- events. Sudo events are left out.
CREATE OR REPLACE FUNCTION analytics_property_breakdown(
    event_name text,
    property text,
    since timestamptz,
    filter jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (value text, events bigint, members bigint, sessions bigint)
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT
        e.properties ->> property,
        count(*),
        count(DISTINCT e.user_id),
        count(DISTINCT (e.user_id, e.session_id))
    FROM analytics_events e
    WHERE e.event = event_name
      AND e.occurred_at >= since
      AND NOT e.sudo
      AND e.properties @> filter
    GROUP BY 1
    ORDER BY count(*) DESC, 1
    LIMIT 50;
$$;

REVOKE EXECUTE ON FUNCTION analytics_property_breakdown(text, text, timestamptz, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION analytics_property_breakdown(text, text, timestamptz, jsonb) TO authenticated;
