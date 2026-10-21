-- Outcomes and notifications in the usage log.
--
-- Until now every event came from the browser, so a click on "Save" was recorded but whether it saved
-- was not, and nothing said which notification brought a member in. Two new kinds of event:
--
--   source = 'server'  an outcome recorded by a server action in a visit (`action_completed`: the
--                      action and whether it worked). It carries the visit's session id, read from a
--                      cookie the browser only sets while usage tracking is allowed, so it joins the
--                      funnel next to the clicks that led to it and is never recorded without consent.
--   source = 'system'  something the app did on its own (`notification_sent`: a notification of some
--                      kind went to a member on some channel). There is no visit, so session_id is NULL.
--   source = 'client'  as before (the default).
--
-- A NULL session means "not part of a visit": funnels never match it, and the visit counts below leave
-- it out, so system events can't inflate "visits".

ALTER TABLE analytics_events ALTER COLUMN session_id DROP NOT NULL;
ALTER TABLE analytics_events ADD COLUMN source text NOT NULL DEFAULT 'client' CHECK (source IN ('client', 'server', 'system'));

COMMENT ON COLUMN analytics_events.source IS
    'Where the event came from: client (the browser), server (an outcome recorded by a server action in a visit), system (the app acting on its own, no visit: session_id is NULL).';

-- Visit counts ignore events that belong to no visit. Same signatures as before, so these replace them.
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
        count(DISTINCT (e.user_id, e.session_id)) FILTER (WHERE e.session_id IS NOT NULL),
        max(e.occurred_at)
    FROM analytics_events e
    WHERE e.occurred_at >= since AND analytics_counts(e.sudo, e.user_id, ignore_sudo, ignore_staff)
    GROUP BY e.event
    ORDER BY count(*) DESC;
$$;

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
        count(DISTINCT (e.user_id, e.session_id)) FILTER (WHERE e.session_id IS NOT NULL)
    FROM analytics_events e
    WHERE e.event = event_name
      AND e.occurred_at >= since
      AND analytics_counts(e.sudo, e.user_id, ignore_sudo, ignore_staff)
      AND e.properties @> filter
    GROUP BY 1
    ORDER BY count(*) DESC, 1
    LIMIT 50;
$$;

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
        count(DISTINCT (e.user_id, e.session_id)) FILTER (WHERE e.session_id IS NOT NULL),
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

-- What server actions did: per action, how many times, how often it worked, and for how many members.
-- Lowest success rate is for the page to rank; this returns every action seen in the window.
CREATE OR REPLACE FUNCTION analytics_action_outcomes(
    since timestamptz,
    ignore_staff boolean DEFAULT false,
    ignore_sudo boolean DEFAULT true
)
RETURNS TABLE (action text, attempts bigint, succeeded bigint, failed bigint, members bigint, last_seen timestamptz)
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT
        e.properties ->> 'action',
        count(*),
        count(*) FILTER (WHERE (e.properties ->> 'ok')::boolean),
        count(*) FILTER (WHERE NOT (e.properties ->> 'ok')::boolean),
        count(DISTINCT e.user_id),
        max(e.occurred_at)
    FROM analytics_events e
    WHERE e.event = 'action_completed'
      AND e.occurred_at >= since
      AND e.properties ? 'action'
      AND e.properties ? 'ok'
      AND analytics_counts(e.sudo, e.user_id, ignore_sudo, ignore_staff)
    GROUP BY 1
    ORDER BY count(*) DESC, 1
    LIMIT 200;
$$;

-- Notifications: per kind and channel, how many were sent (`notification_sent`, a system event) and how
-- many were opened (`notification_opened`: a click on an in-app notification, or a visit that arrived
-- through a link in one). Opens are counted in the same window as sends, so a notification sent just
-- before the window can show an open without its send; read short windows with that in mind.
CREATE OR REPLACE FUNCTION analytics_notification_rates(
    since timestamptz,
    ignore_staff boolean DEFAULT false,
    ignore_sudo boolean DEFAULT true
)
RETURNS TABLE (kind text, channel text, sent bigint, sent_members bigint, opened bigint, opened_members bigint)
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT
        e.properties ->> 'kind',
        e.properties ->> 'channel',
        count(*) FILTER (WHERE e.event = 'notification_sent'),
        count(DISTINCT e.user_id) FILTER (WHERE e.event = 'notification_sent'),
        count(*) FILTER (WHERE e.event = 'notification_opened'),
        count(DISTINCT e.user_id) FILTER (WHERE e.event = 'notification_opened')
    FROM analytics_events e
    WHERE e.event IN ('notification_sent', 'notification_opened')
      AND e.occurred_at >= since
      AND e.properties ? 'kind'
      AND e.properties ? 'channel'
      AND analytics_counts(e.sudo, e.user_id, ignore_sudo, ignore_staff)
    GROUP BY 1, 2
    ORDER BY count(*) FILTER (WHERE e.event = 'notification_sent') DESC, 1, 2
    LIMIT 200;
$$;

REVOKE EXECUTE ON FUNCTION analytics_action_outcomes(timestamptz, boolean, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION analytics_notification_rates(timestamptz, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION analytics_action_outcomes(timestamptz, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION analytics_notification_rates(timestamptz, boolean, boolean) TO authenticated;
