-- Chat adoption: how much of what members write is written in the Hub and how much in Slack, in total, by week
-- and per person. chat_messages.origin is 'app' for a message written in the Hub and 'slack' for one written in
-- Slack. Counts only, never content. Left out: deleted messages, system messages, messages with no member as the
-- author, and every restricted conversation (direct messages and group messages are always restricted, and so are
-- private channels staff chose to keep out of reach). Admins only: anyone else gets no rows.

set lock_timeout = '5s';

CREATE FUNCTION public.admin_chat_adoption_weekly(p_since timestamptz, p_timezone text)
RETURNS TABLE (week_start date, hub_messages bigint, slack_messages bigint, hub_authors bigint, slack_authors bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT (date_trunc('week', (m.created_at AT TIME ZONE p_timezone) + interval '1 day') - interval '1 day')::date AS week_start,
         count(*) FILTER (WHERE m.origin = 'app'),
         count(*) FILTER (WHERE m.origin = 'slack'),
         count(DISTINCT m.author_member_id) FILTER (WHERE m.origin = 'app'),
         count(DISTINCT m.author_member_id) FILTER (WHERE m.origin = 'slack')
    FROM public.chat_messages m
    JOIN public.chat_channels c ON c.id = m.channel_id
   WHERE (SELECT public.is_admin())
     AND m.created_at >= p_since AND m.deleted_at IS NULL AND m.system_subtype IS NULL
     AND m.author_member_id IS NOT NULL AND NOT c.restricted
   GROUP BY 1
   ORDER BY 1;
$function$;

CREATE FUNCTION public.admin_chat_adoption_people(p_since timestamptz)
RETURNS TABLE (member_id text, name text, display_name text, hub_messages bigint, slack_messages bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT m.author_member_id,
         mem.name,
         mem.display_name,
         count(*) FILTER (WHERE m.origin = 'app'),
         count(*) FILTER (WHERE m.origin = 'slack')
    FROM public.chat_messages m
    JOIN public.chat_channels c ON c.id = m.channel_id
    JOIN public.members mem ON mem.id = m.author_member_id
   WHERE (SELECT public.is_admin())
     AND m.created_at >= p_since AND m.deleted_at IS NULL AND m.system_subtype IS NULL
     AND NOT c.restricted
   GROUP BY m.author_member_id, mem.name, mem.display_name
   ORDER BY count(*) DESC, mem.name;
$function$;

COMMENT ON FUNCTION public.admin_chat_adoption_weekly(timestamptz, text) IS
  'Messages written in the Hub (origin app) and in Slack per week (Sunday start in the given time zone), with distinct authors. Counts only; restricted conversations left out. Admins only.';
COMMENT ON FUNCTION public.admin_chat_adoption_people(timestamptz) IS
  'Per author: messages written in the Hub and in Slack since a date. Counts only; restricted conversations left out. Admins only.';

REVOKE EXECUTE ON FUNCTION public.admin_chat_adoption_weekly(timestamptz, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_chat_adoption_people(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_chat_adoption_weekly(timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_chat_adoption_people(timestamptz) TO authenticated, service_role;
