-- member_slack_summary: the admin member page's Slack totals (tab count, Messages, Reactions,
-- Last 30 Days, Channels) in one aggregate instead of paging every Slack activity row of the
-- member through PostgREST (up to ~6k rows, one request per 1000, on production's busiest members).
-- SECURITY INVOKER, so RLS on member_activities decides what the caller counts, as it did when
-- the app read the rows itself.

CREATE OR REPLACE FUNCTION public.member_slack_summary(p_member_id text, p_since timestamptz)
 RETURNS TABLE (total bigint, messages bigint, reactions bigint, channels bigint, last_30_days bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT count(*),
         count(*) FILTER (WHERE activity_type IN ('slack_message', 'slack_thread_reply')),
         count(*) FILTER (WHERE activity_type = 'slack_reaction'),
         count(DISTINCT data->>'channel_name'),
         count(*) FILTER (WHERE occurred_at >= p_since)
    FROM member_activities
   WHERE member_id = p_member_id AND source = 'slack';
$function$;

COMMENT ON FUNCTION public.member_slack_summary(text, timestamptz) IS 'Totals over all of one member''s Slack activities; p_since bounds the last_30_days count. Respects RLS.';

REVOKE ALL ON FUNCTION public.member_slack_summary(text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_slack_summary(text, timestamptz) TO authenticated, service_role;
