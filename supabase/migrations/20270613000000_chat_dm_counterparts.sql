set lock_timeout = '5s';

-- Who a direct message is with, for the sidebar's label. A Slack DM is in a member's chat without the other person
-- (they join it when their own pull finds it: 20270603000000_slack_dm_visibility_gate.sql), so the chat's own member
-- list can't name them, and Bronze's list of who is in the conversation is not readable by members. This returns,
-- for the member's own DMs (and the group DMs only members' tokens can read), the other people's names: the Hub
-- member's display name when the Slack user is matched to one, else their Slack name. Names only, no content; a
-- member can ask only for their own, the service role for anyone's.
CREATE OR REPLACE FUNCTION public.chat_dm_counterparts(p_member text)
 RETURNS TABLE(channel_id text, slack_user_id text, member_id text, name text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT c.id, b.user_id, a.member_id,
         COALESCE(NULLIF(m.display_name, ''), NULLIF(m.name, ''), NULLIF(u.real_name, ''), NULLIF(u.display_name, ''), NULLIF(u.name, ''))
  FROM chat_channels c
  JOIN chat_channel_members mine ON mine.channel_id = c.id AND mine.member_id = p_member AND mine.left_at IS NULL
  JOIN bronze.slack_channels sc ON sc.channel_id = c.slack_channel_id
  JOIN bronze.slack_channel_members b ON b.channel_id = c.slack_channel_id AND b.left_at IS NULL
  LEFT JOIN chat_slack_authors a ON a.slack_user_id = b.user_id
  LEFT JOIN members m ON m.id = a.member_id
  LEFT JOIN bronze.slack_users u ON u.user_id = b.user_id
  WHERE (p_member = (SELECT current_member_id()) OR (SELECT auth.role()) = 'service_role')
    AND (c.kind = 'dm' OR (c.kind = 'group_dm' AND sc.token_only))
    AND a.member_id IS DISTINCT FROM p_member
    AND COALESCE(u.is_bot, false) = false;
$function$;

REVOKE ALL ON FUNCTION public.chat_dm_counterparts(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_dm_counterparts(text) TO authenticated, service_role;
COMMENT ON FUNCTION public.chat_dm_counterparts(text) IS
  'The other people in the member''s own Slack DMs (and group DMs only members'' tokens read): channel, Slack user, Hub member if matched, and a display name. Names only. A member may ask only for themselves; the service role for anyone.';
