-- member_slack_channels: the channels a member has been active in on Slack, busiest first, for the
-- admin member page's channel filter (one aggregate instead of reading every activity row).
-- SECURITY INVOKER, so RLS on member_activities decides what the caller counts.

CREATE OR REPLACE FUNCTION public.member_slack_channels(p_member_id text)
 RETURNS TABLE (channel_name text, n bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT data->>'channel_name', count(*)
    FROM member_activities
   WHERE member_id = p_member_id AND source = 'slack' AND data->>'channel_name' IS NOT NULL
   GROUP BY 1
   ORDER BY 2 DESC, 1;
$function$;

COMMENT ON FUNCTION public.member_slack_channels(text) IS 'Channels one member has Slack activity in, with the count, busiest first. Respects RLS.';

REVOKE ALL ON FUNCTION public.member_slack_channels(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_slack_channels(text) TO authenticated, service_role;
