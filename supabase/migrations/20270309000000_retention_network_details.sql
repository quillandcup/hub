-- The database side of the nightly job that enforces "exact IP address and browser identification string are
-- removed after 90 days" (/privacy, lib/retention.ts; the job is lib/retention/network-details.ts).
--
-- Three steps, each a function the job calls in batches (service role only):
--   1. retention_pending_user_agents: the distinct user-agent strings that have no parsed device yet, so the job
--      parses each string once, not each row.
--   2. retention_set_device: stores a string's parsed device on its rows (and, for usage events, replaces the raw
--      string in the event's context with the parsed fields).
--   3. retention_remove_raw_network: removes the exact IP and the raw user agent from rows older than the cutoff;
--      a user agent only where its device is already stored, so nothing is lost before its browser and device are kept.
-- `device = '{}'` means "nothing readable in this string": it keeps the row from being looked at again.

-- Finding rows to work on without reading the whole table every night.
CREATE INDEX access_events_pending_device_idx
  ON public.access_events (user_agent) WHERE device IS NULL AND user_agent IS NOT NULL;
CREATE INDEX video_watch_segments_pending_device_idx
  ON public.video_watch_segments (user_agent) WHERE device IS NULL AND user_agent IS NOT NULL;
CREATE INDEX access_events_raw_network_idx
  ON public.access_events (created_at) WHERE ip_address IS NOT NULL OR user_agent IS NOT NULL;
CREATE INDEX video_watch_segments_raw_network_idx
  ON public.video_watch_segments (started_at) WHERE user_agent IS NOT NULL;
CREATE INDEX analytics_events_raw_user_agent_idx
  ON public.analytics_events ((context ->> 'user_agent')) WHERE context ? 'user_agent';

CREATE FUNCTION public.retention_pending_user_agents(p_source text, p_limit integer DEFAULT 500)
RETURNS SETOF text
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $function$
BEGIN
  IF p_source = 'access_events' THEN
    RETURN QUERY SELECT DISTINCT e.user_agent FROM public.access_events e
      WHERE e.device IS NULL AND e.user_agent IS NOT NULL LIMIT p_limit;
  ELSIF p_source = 'video_watch_segments' THEN
    RETURN QUERY SELECT DISTINCT s.user_agent FROM public.video_watch_segments s
      WHERE s.device IS NULL AND s.user_agent IS NOT NULL LIMIT p_limit;
  ELSIF p_source = 'analytics_events' THEN
    RETURN QUERY SELECT DISTINCT a.context ->> 'user_agent' FROM public.analytics_events a
      WHERE a.context ? 'user_agent' LIMIT p_limit;
  ELSE
    RAISE EXCEPTION 'unknown source: %', p_source;
  END IF;
END;
$function$;

-- Returns how many rows it changed (at most p_limit), so the job calls it until it returns 0.
CREATE FUNCTION public.retention_set_device(p_source text, p_user_agent text, p_device jsonb, p_limit integer DEFAULT 5000)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  changed integer;
BEGIN
  IF jsonb_typeof(p_device) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'device must be a JSON object';
  END IF;
  IF p_source = 'access_events' THEN
    UPDATE public.access_events SET device = p_device
    WHERE ctid IN (SELECT e.ctid FROM public.access_events e WHERE e.user_agent = p_user_agent AND e.device IS NULL LIMIT p_limit);
  ELSIF p_source = 'video_watch_segments' THEN
    UPDATE public.video_watch_segments SET device = p_device
    WHERE ctid IN (SELECT s.ctid FROM public.video_watch_segments s WHERE s.user_agent = p_user_agent AND s.device IS NULL LIMIT p_limit);
  ELSIF p_source = 'analytics_events' THEN
    -- The parsed fields replace the raw string in the event's context (new events never carry it).
    UPDATE public.analytics_events SET context = (context - 'user_agent') || p_device
    WHERE ctid IN (SELECT a.ctid FROM public.analytics_events a WHERE a.context ->> 'user_agent' = p_user_agent LIMIT p_limit);
  ELSE
    RAISE EXCEPTION 'unknown source: %', p_source;
  END IF;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$function$;

-- Removes the exact IP and the raw user agent from rows older than p_cutoff, at most p_limit rows per table per
-- call. A user agent is only removed where the device is stored; an IP has no such condition (the place stays).
CREATE FUNCTION public.retention_remove_raw_network(p_cutoff timestamptz, p_limit integer DEFAULT 5000)
RETURNS TABLE (source text, removed integer)
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  n integer;
BEGIN
  UPDATE public.access_events
  SET ip_address = NULL,
      user_agent = CASE WHEN device IS NOT NULL THEN NULL ELSE user_agent END
  WHERE ctid IN (
    SELECT e.ctid FROM public.access_events e
    WHERE e.created_at < p_cutoff
      AND (e.ip_address IS NOT NULL OR (e.user_agent IS NOT NULL AND e.device IS NOT NULL))
    LIMIT p_limit);
  GET DIAGNOSTICS n = ROW_COUNT;
  source := 'access_events'; removed := n; RETURN NEXT;

  UPDATE public.video_watch_segments SET user_agent = NULL
  WHERE ctid IN (
    SELECT s.ctid FROM public.video_watch_segments s
    WHERE s.started_at < p_cutoff AND s.user_agent IS NOT NULL AND s.device IS NOT NULL
    LIMIT p_limit);
  GET DIAGNOSTICS n = ROW_COUNT;
  source := 'video_watch_segments'; removed := n; RETURN NEXT;
END;
$function$;

-- Only the service-role job calls these: they take no user and change other people's rows.
REVOKE EXECUTE ON FUNCTION public.retention_pending_user_agents(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.retention_set_device(text, text, jsonb, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.retention_remove_raw_network(timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retention_pending_user_agents(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.retention_set_device(text, text, jsonb, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.retention_remove_raw_network(timestamptz, integer) TO service_role;
