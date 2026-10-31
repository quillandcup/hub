-- Rollups of the usage log, so the individual events can be removed after RETENTION.usageMonths (13 months;
-- lib/retention.ts, /privacy: "then only anonymous totals") without losing the long-run numbers.
--
-- analytics_rollups: counts per day, week and month, one dimension at a time (the event itself, its route, the
-- control it names, the action and whether it worked, the browser, OS, device type and viewport size), with no
-- user or session ids, only how many events, visits (distinct sessions) and members. A single-dimension count
-- identifies no one, so nothing is suppressed. Combinations (route by screen size) are a later, separate set.
-- Distinct counts can't be rebuilt from daily numbers, so each period kind is computed from the events themselves.
-- analytics_rollup_periods: which periods have been rolled up. The pruning function only removes an event whose
-- day, week and month have all been, so nothing is lost before its totals are kept.
--
-- Days, weeks (starting Sunday) and months are the organisation's (the timezone is passed in; lib/config.ts).
-- Audience: 'sudo' for events recorded while an admin viewed as a member, else 'staff' or 'member', the same split
-- as the audience filters on the admin pages (20261125000100).

CREATE TABLE public.analytics_rollup_periods (
  period_kind text NOT NULL CHECK (period_kind IN ('day', 'week', 'month')),
  period_start date NOT NULL,
  source_events integer NOT NULL,
  rolled_up_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (period_kind, period_start)
);

CREATE TABLE public.analytics_rollups (
  period_kind text NOT NULL CHECK (period_kind IN ('day', 'week', 'month')),
  period_start date NOT NULL,
  audience text NOT NULL CHECK (audience IN ('member', 'staff', 'sudo')),
  event text NOT NULL,
  dimension text NOT NULL CHECK (dimension IN ('total', 'route', 'control', 'action', 'browser', 'os', 'device_type', 'viewport')),
  value text NOT NULL DEFAULT '',
  events integer NOT NULL,
  visits integer NOT NULL,
  members integer NOT NULL,
  PRIMARY KEY (period_kind, period_start, audience, event, dimension, value)
);

COMMENT ON TABLE public.analytics_rollups IS
  'Anonymous counts of usage events per day/week/month, one dimension at a time; kept after the events are removed at 13 months. No user or session ids.';

ALTER TABLE public.analytics_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_rollup_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read rollups" ON public.analytics_rollups FOR SELECT USING ((SELECT is_admin()));
CREATE POLICY "Admins read rollup periods" ON public.analytics_rollup_periods FOR SELECT USING ((SELECT is_admin()));

GRANT SELECT ON public.analytics_rollups TO authenticated;
GRANT SELECT ON public.analytics_rollup_periods TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.analytics_rollups TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.analytics_rollup_periods TO service_role;

-- Computes one period's rollup from the events, replacing what was there (so a re-run is safe). Returns the
-- number of rollup rows written.
CREATE FUNCTION public.analytics_rollup_period(p_kind text, p_start date, p_tz text)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_from timestamptz;
  v_to timestamptz;
  v_end date;
  v_rows integer;
  v_events integer;
BEGIN
  v_end := CASE p_kind
    WHEN 'day' THEN p_start + 1
    WHEN 'week' THEN p_start + 7
    WHEN 'month' THEN (p_start + interval '1 month')::date
    ELSE NULL END;
  IF v_end IS NULL THEN RAISE EXCEPTION 'unknown period kind: %', p_kind; END IF;
  v_from := p_start::timestamp AT TIME ZONE p_tz;
  v_to := v_end::timestamp AT TIME ZONE p_tz;

  DELETE FROM public.analytics_rollups WHERE period_kind = p_kind AND period_start = p_start;

  WITH base AS (
    SELECT e.event, e.user_id, e.session_id, e.properties, e.context,
           CASE WHEN e.sudo THEN 'sudo'
                WHEN public.analytics_is_staff(e.user_id) THEN 'staff'
                ELSE 'member' END AS audience
    FROM public.analytics_events e
    WHERE e.occurred_at >= v_from AND e.occurred_at < v_to
  ),
  dims AS (
    SELECT audience, event, 'total' AS dimension, '' AS value, user_id, session_id FROM base
    UNION ALL
    SELECT audience, event, 'route', COALESCE(properties ->> 'route', context ->> 'route'), user_id, session_id FROM base
    UNION ALL
    SELECT audience, event, 'control', properties ->> 'name', user_id, session_id FROM base
    UNION ALL
    SELECT audience, event, 'action', (properties ->> 'action') || '/' || COALESCE(properties ->> 'ok', ''), user_id, session_id
      FROM base WHERE properties ? 'action'
    UNION ALL
    SELECT audience, event, 'browser',
           (context ->> 'browser') || COALESCE(' ' || substring(context ->> 'browser_version' FROM '^[0-9]+(?:\.[0-9]+)?'), ''),
           user_id, session_id FROM base
    UNION ALL
    SELECT audience, event, 'os', (context ->> 'os') || COALESCE(' ' || (context ->> 'os_version'), ''), user_id, session_id FROM base
    UNION ALL
    SELECT audience, event, 'device_type', context ->> 'device_type', user_id, session_id FROM base
    UNION ALL
    SELECT audience, event, 'viewport', context ->> 'viewport', user_id, session_id FROM base
  )
  INSERT INTO public.analytics_rollups (period_kind, period_start, audience, event, dimension, value, events, visits, members)
  SELECT p_kind, p_start, audience, event, dimension, value,
         count(*)::integer, count(DISTINCT session_id)::integer, count(DISTINCT user_id)::integer
  FROM dims
  WHERE value IS NOT NULL
  GROUP BY audience, event, dimension, value;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  SELECT count(*)::integer INTO v_events FROM public.analytics_events e WHERE e.occurred_at >= v_from AND e.occurred_at < v_to;
  INSERT INTO public.analytics_rollup_periods (period_kind, period_start, source_events)
  VALUES (p_kind, p_start, v_events)
  ON CONFLICT (period_kind, period_start) DO UPDATE SET source_events = EXCLUDED.source_events, rolled_up_at = now();

  RETURN v_rows;
END;
$function$;

-- The completed periods (ended at least two days ago: a client may send an event up to a day late) that have no
-- rollup yet, from the first event to p_now, oldest first. A period with no events is skipped.
CREATE FUNCTION public.analytics_unrolled_periods(p_tz text, p_now timestamptz DEFAULT now())
RETURNS TABLE (period_kind text, period_start date)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH bounds AS (
    SELECT (min(occurred_at) AT TIME ZONE p_tz)::date AS first_day,
           ((p_now - interval '2 days') AT TIME ZONE p_tz)::date AS last_day
    FROM public.analytics_events
  ),
  days AS (
    SELECT d::date AS day FROM bounds, generate_series(bounds.first_day, bounds.last_day, interval '1 day') AS d
    WHERE bounds.first_day IS NOT NULL
  ),
  candidates AS (
    SELECT 'day'::text AS kind, day AS start, day + 1 AS stop FROM days
    UNION
    SELECT 'week', day - extract(dow FROM day)::integer, day - extract(dow FROM day)::integer + 7 FROM days
    UNION
    SELECT 'month', date_trunc('month', day)::date, (date_trunc('month', day) + interval '1 month')::date FROM days
  )
  SELECT c.kind, c.start
  FROM candidates c
  WHERE (c.stop::timestamp AT TIME ZONE p_tz) <= (p_now - interval '2 days')
    AND NOT EXISTS (SELECT 1 FROM public.analytics_rollup_periods r WHERE r.period_kind = c.kind AND r.period_start = c.start)
    AND EXISTS (
      SELECT 1 FROM public.analytics_events e
      WHERE e.occurred_at >= (c.start::timestamp AT TIME ZONE p_tz) AND e.occurred_at < (c.stop::timestamp AT TIME ZONE p_tz))
  ORDER BY c.start, c.kind;
$function$;

-- Removes events older than p_cutoff that the app's users caused (source 'client' or 'server'; the app's own
-- records, source 'system', are kept), but only where the event's day, week and month have all been rolled up.
-- At most p_limit rows per call; the job calls it until it returns 0.
CREATE FUNCTION public.analytics_prune_usage_events(p_cutoff timestamptz, p_tz text, p_limit integer DEFAULT 5000)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  n integer;
BEGIN
  DELETE FROM public.analytics_events
  WHERE ctid IN (
    SELECT e.ctid FROM public.analytics_events e
    CROSS JOIN LATERAL (SELECT (e.occurred_at AT TIME ZONE p_tz)::date AS day) d
    WHERE e.source IN ('client', 'server')
      AND e.occurred_at < p_cutoff
      AND EXISTS (SELECT 1 FROM public.analytics_rollup_periods r WHERE r.period_kind = 'day' AND r.period_start = d.day)
      AND EXISTS (SELECT 1 FROM public.analytics_rollup_periods r WHERE r.period_kind = 'week' AND r.period_start = d.day - extract(dow FROM d.day)::integer)
      AND EXISTS (SELECT 1 FROM public.analytics_rollup_periods r WHERE r.period_kind = 'month' AND r.period_start = date_trunc('month', d.day)::date)
    LIMIT p_limit);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

-- Only the service-role job calls these.
REVOKE EXECUTE ON FUNCTION public.analytics_rollup_period(text, date, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.analytics_unrolled_periods(text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.analytics_prune_usage_events(timestamptz, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_rollup_period(text, date, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.analytics_unrolled_periods(text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.analytics_prune_usage_events(timestamptz, text, integer) TO service_role;
