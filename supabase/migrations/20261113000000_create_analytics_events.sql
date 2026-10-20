-- Product analytics events: what members do inside the Hub (opened the On air popover, clicked
-- "Join on Zoom", ...), so each feature can be shown to earn its place.
--
-- Local layer, append-only: events are never updated, soft-deleted or reprocessed. Erased with
-- the account (ON DELETE CASCADE): a session id on its own can still single someone out, and
-- telemetry has no history worth keeping once its person is gone.
--
-- Written by app/api/track/events with the member's own session (RLS below), from the browser
-- queue in lib/analytics/client.ts. The names and properties that may be stored are the registry
-- in lib/analytics/events.ts: anything else is dropped before it gets here.

CREATE TABLE analytics_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Client-generated; a retried batch re-sends the same ids, so the insert is idempotent.
    message_id uuid NOT NULL,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- Groups one visit's events (rotates after 30 idle minutes); only meaningful with user_id.
    session_id uuid NOT NULL,
    event text NOT NULL CHECK (char_length(event) BETWEEN 1 AND 64),
    properties jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(properties::text) <= 4000),
    -- Where it happened: route template (never a real path), viewport class, user agent.
    context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(context::text) <= 2000),
    -- An admin viewing as a member. Kept so the row can be told apart, and left out of every
    -- usage number: an admin testing a feature is not the member using it.
    sudo boolean NOT NULL DEFAULT false,
    -- When it happened (client clock, corrected for skew by the receiver) and when we got it.
    occurred_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, message_id)
);

CREATE INDEX analytics_events_event_occurred_idx ON analytics_events (event, occurred_at DESC);
CREATE INDEX analytics_events_user_occurred_idx ON analytics_events (user_id, occurred_at DESC);
CREATE INDEX analytics_events_session_idx ON analytics_events (user_id, session_id, occurred_at);

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- Members can only ever record events as themselves.
CREATE POLICY "Users can log their own analytics events"
    ON analytics_events FOR INSERT
    WITH CHECK (user_id = auth.uid());

-- Needed for the receiver's idempotent insert, not just for show: Postgres applies the SELECT
-- policy to rows written with ON CONFLICT, so without this a member's batch fails.
CREATE POLICY "Users can view their own analytics events"
    ON analytics_events FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Admins can view all analytics events"
    ON analytics_events FOR SELECT
    USING (is_admin());

COMMENT ON TABLE analytics_events IS
    'Append-only product analytics events (see lib/analytics/events.ts for the registry). Erased with the account.';

-- Usage per event over a window: how often, by how many members, in how many visits.
-- SECURITY INVOKER (the default), so the table's admin-only SELECT policy applies: anyone else
-- gets no rows. Sudo events are left out.
CREATE OR REPLACE FUNCTION analytics_event_summary(since timestamptz)
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
    WHERE e.occurred_at >= since AND NOT e.sudo
    GROUP BY e.event
    ORDER BY count(*) DESC;
$$;

-- Ordered funnel: how many visits reached step 1, then went on to step 2 afterwards, and so on.
-- Counts visits (a member's session), each at most once per step; a step only counts if it came
-- at or after the visit's previous step. `filters` is an optional JSON array, one object per step,
-- of properties that step's event must have (`[{"live": false}, {"live": false}]`). Sudo events
-- are left out.
CREATE OR REPLACE FUNCTION analytics_funnel(steps text[], since timestamptz, filters jsonb DEFAULT '[]'::jsonb)
RETURNS TABLE (step integer, event text, sessions bigint)
LANGUAGE sql STABLE
SET search_path = public
AS $$
    WITH RECURSIVE reached (i, user_id, session_id, at) AS (
        SELECT 1, e.user_id, e.session_id, min(e.occurred_at)
        FROM analytics_events e
        WHERE e.event = steps[1] AND e.occurred_at >= since AND NOT e.sudo
          AND e.properties @> coalesce(filters -> 0, '{}'::jsonb)
        GROUP BY e.user_id, e.session_id
        UNION ALL
        SELECT r.i + 1, r.user_id, r.session_id, nxt.at
        FROM reached r
        CROSS JOIN LATERAL (
            SELECT e.occurred_at AS at
            FROM analytics_events e
            WHERE e.user_id = r.user_id AND e.session_id = r.session_id
              AND e.event = steps[r.i + 1] AND e.occurred_at >= r.at AND NOT e.sudo
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

REVOKE EXECUTE ON FUNCTION analytics_event_summary(timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION analytics_funnel(text[], timestamptz, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION analytics_event_summary(timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION analytics_funnel(text[], timestamptz, jsonb) TO authenticated;
