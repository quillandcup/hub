set lock_timeout = '5s';

-- Which of a member's direct messages are with an app (a Slack bot such as Billie Bot) rather than a person, and the
-- app's name, so the sidebar can list them under "Apps" as Slack does. chat_dm_counterparts leaves bots out of a DM's
-- name, so an app's DM read only "Direct message". A DM counts as an app's when the Slack conversation has a bot in it
-- and nobody else besides the member. Names only, no content; a member can ask only for their own, the service role for
-- anyone's.
CREATE OR REPLACE FUNCTION public.chat_dm_apps(p_member text)
 RETURNS TABLE(channel_id text, name text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT c.id, COALESCE(NULLIF(u.real_name, ''), NULLIF(u.display_name, ''), NULLIF(u.name, ''))
  FROM chat_channels c
  JOIN chat_channel_members mine ON mine.channel_id = c.id AND mine.member_id = p_member AND mine.left_at IS NULL
  JOIN bronze.slack_channel_members b ON b.channel_id = c.slack_channel_id AND b.left_at IS NULL
  JOIN bronze.slack_users u ON u.user_id = b.user_id AND u.is_bot
  WHERE (p_member = (SELECT current_member_id()) OR (SELECT auth.role()) = 'service_role')
    AND c.kind = 'dm'
    AND NOT EXISTS (
      SELECT 1
      FROM bronze.slack_channel_members b2
      LEFT JOIN bronze.slack_users u2 ON u2.user_id = b2.user_id
      LEFT JOIN chat_slack_authors a2 ON a2.slack_user_id = b2.user_id
      WHERE b2.channel_id = c.slack_channel_id AND b2.left_at IS NULL
        AND COALESCE(u2.is_bot, false) = false
        AND a2.member_id IS DISTINCT FROM p_member
    );
$function$;

REVOKE ALL ON FUNCTION public.chat_dm_apps(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_dm_apps(text) TO authenticated, service_role;
COMMENT ON FUNCTION public.chat_dm_apps(text) IS
  'The member''s own Slack DMs that are with an app (a bot, nobody else in them): channel and the app''s name. Names only. A member may ask only for themselves; the service role for anyone.';
