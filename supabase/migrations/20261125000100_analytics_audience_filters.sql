-- Audience filters for the usage analytics functions: leave out staff, and choose whether an admin
-- viewing as a member (sudo) counts.
--
-- Every analytics function (summary, funnel, property breakdown, top clicks, control rates) now takes
--   ignore_sudo  boolean DEFAULT true   -- sudo events are left out (what they always did)
--   ignore_staff boolean DEFAULT false  -- events from staff are left out
-- so callers that pass neither behave exactly as before.
--
-- Staff = an admin (user_profiles.role = 'admin') or a member with a staff_role (owner, staff,
-- contractor). A sudo event belongs to the member being viewed, not to the staff member doing the
-- viewing, so ignore_staff does not remove it: only ignore_sudo decides whether those count. That
-- keeps the two filters independent: "ignore staff" never silently also hides sudo, and turning
-- "ignore sudo" off shows exactly the sudo activity.
--
-- The functions stay SECURITY INVOKER: RLS still decides what a caller may see (admins see all).

CREATE OR REPLACE FUNCTION analytics_is_staff(uid uuid)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT EXISTS (SELECT 1 FROM user_profiles p WHERE p.id = uid AND p.role = 'admin')
        OR EXISTS (SELECT 1 FROM members m WHERE m.user_id = uid AND m.staff_role IS NOT NULL);
$$;

-- Whether an event is counted under the audience filters.
CREATE OR REPLACE FUNCTION analytics_counts(
    event_sudo boolean,
    event_user uuid,
    ignore_sudo boolean,
    ignore_staff boolean
)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT NOT (ignore_sudo AND event_sudo)
       AND NOT (ignore_staff AND NOT event_sudo AND analytics_is_staff(event_user));
$$;

REVOKE EXECUTE ON FUNCTION analytics_is_staff(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION analytics_counts(boolean, uuid, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION analytics_is_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION analytics_counts(boolean, uuid, boolean, boolean) TO authenticated;

-- Usage per event over a window.
DROP FUNCTION IF EXISTS analytics_event_summary(timestamptz);
CREATE OR REPLACE FUNCTION analytics_event_summary(
    since timestamptz,
    ignore_staff boolean DEFAULT false,
    ignore_sudo boolean DEFAULT true
)
RETURNS TABLE (event text, events bigint, members bigint, sessions bigint, last_seen timestamptz)
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT
        e.event,
        count(*),
        count(DISTINCT e.user_id),
        count(DISTINCT (e.user_id, e.session_id)),
        max(e.occurred_at)
    FROM analytics_events e
    WHERE e.occurred_at >= since AND analytics_counts(e.sudo, e.user_id, ignore_sudo, ignore_staff)
    GROUP BY e.event
    ORDER BY count(*) DESC;
$$;

-- Ordered funnel, counted per visit.
DROP FUNCTION IF EXISTS analytics_funnel(text[], timestamptz, jsonb);
CREATE OR REPLACE FUNCTION analytics_funnel(
    steps text[],
    since timestamptz,
    filters jsonb DEFAULT '[]'::jsonb,
    ignore_staff boolean DEFAULT false,
    ignore_sudo boolean DEFAULT true
)
RETURNS TABLE (step integer, event text, sessions bigint)
LANGUAGE sql STABLE
SET search_path = public
AS $$
    WITH RECURSIVE reached (i, user_id, session_id, at) AS (
        SELECT 1, e.user_id, e.session_id, min(e.occurred_at)
        FROM analytics_events e
        WHERE e.event = steps[1] AND e.occurred_at >= since
          AND analytics_counts(e.sudo, e.user_id, ignore_sudo, ignore_staff)
          AND e.properties @> coalesce(filters -> 0, '{}'::jsonb)
        GROUP BY e.user_id, e.session_id
        UNION ALL
        SELECT r.i + 1, r.user_id, r.session_id, nxt.at
        FROM reached r
        CROSS JOIN LATERAL (
            SELECT e.occurred_at AS at
            FROM analytics_events e
            WHERE e.user_id = r.user_id AND e.session_id = r.session_id
              AND e.event = steps[r.i + 1] AND e.occurred_at >= r.at
              AND analytics_counts(e.sudo, e.user_id, ignore_sudo, ignore_staff)
              AND e.properties @> coalesce(filters -> r.i, '{}'::jsonb)
            ORDER BY e.occurred_at
            LIMIT 1
        ) nxt
        WHERE r.i < coalesce(array_length(steps, 1), 0)
    )
    SELECT s.i, steps[s.i], count(r.user_id)
    FROM generate_series(1, coalesce(array_length(steps, 1), 0)) AS s (i)
    LEFT JOIN reached r ON r.i = s.i
    GROUP BY s.i
    ORDER BY s.i;
$$;

-- One event counted by the values of one property.
DROP FUNCTION IF EXISTS analytics_property_breakdown(text, text, timestamptz, jsonb);
CREATE OR REPLACE FUNCTION analytics_property_breakdown(
    event_name text,
    property text,
    since timestamptz,
    filter jsonb DEFAULT '{}'::jsonb,
    ignore_staff boolean DEFAULT false,
    ignore_sudo boolean DEFAULT true
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
      AND analytics_counts(e.sudo, e.user_id, ignore_sudo, ignore_staff)
      AND e.properties @> filter
    GROUP BY 1
    ORDER BY count(*) DESC, 1
    LIMIT 50;
$$;

-- The most-clicked things.
DROP FUNCTION IF EXISTS analytics_top_clicks(timestamptz, text, boolean);
CREATE OR REPLACE FUNCTION analytics_top_clicks(
    since timestamptz,
    route_prefix text DEFAULT NULL,
    hide_admin boolean DEFAULT false,
    ignore_staff boolean DEFAULT false,
    ignore_sudo boolean DEFAULT true
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
      AND analytics_counts(e.sudo, e.user_id, ignore_sudo, ignore_staff)
      AND (route_prefix IS NULL OR coalesce(starts_with(e.properties ->> 'route', route_prefix), false))
      AND (NOT hide_admin OR NOT coalesce(starts_with(e.properties ->> 'route', '/admin'), false))
    GROUP BY 1, 2
    ORDER BY count(*) DESC, 1
    LIMIT 100;
$$;

-- Click-through of named controls.
DROP FUNCTION IF EXISTS analytics_control_rates(timestamptz, text, boolean);
CREATE OR REPLACE FUNCTION analytics_control_rates(
    since timestamptz,
    route_prefix text DEFAULT NULL,
    hide_admin boolean DEFAULT false,
    ignore_staff boolean DEFAULT false,
    ignore_sudo boolean DEFAULT true
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
          AND analytics_counts(e.sudo, e.user_id, ignore_sudo, ignore_staff)
          AND e.properties ? 'name'
          AND (route_prefix IS NULL OR coalesce(starts_with(e.properties ->> 'route', route_prefix), false))
          AND (NOT hide_admin OR NOT coalesce(starts_with(e.properties ->> 'route', '/admin'), false))
    ),
    clicked AS (
        SELECT DISTINCT e.properties ->> 'name' AS name, e.user_id, e.session_id
        FROM analytics_events e
        WHERE e.event = 'element_clicked'
          AND e.occurred_at >= since
          AND analytics_counts(e.sudo, e.user_id, ignore_sudo, ignore_staff)
          AND e.properties ? 'name'
    ),
    launched AS (
        SELECT e.properties ->> 'name' AS name, min(e.occurred_at) AS first_seen
        FROM analytics_events e
        WHERE e.event = 'element_seen'
          AND analytics_counts(e.sudo, e.user_id, ignore_sudo, ignore_staff)
          AND e.properties ? 'name'
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

REVOKE EXECUTE ON FUNCTION analytics_event_summary(timestamptz, boolean, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION analytics_funnel(text[], timestamptz, jsonb, boolean, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION analytics_property_breakdown(text, text, timestamptz, jsonb, boolean, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION analytics_top_clicks(timestamptz, text, boolean, boolean, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION analytics_control_rates(timestamptz, text, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION analytics_event_summary(timestamptz, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION analytics_funnel(text[], timestamptz, jsonb, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION analytics_property_breakdown(text, text, timestamptz, jsonb, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION analytics_top_clicks(timestamptz, text, boolean, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION analytics_control_rates(timestamptz, text, boolean, boolean, boolean) TO authenticated;
