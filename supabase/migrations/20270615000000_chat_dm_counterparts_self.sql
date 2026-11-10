set lock_timeout = '5s';

-- A DM with yourself is named after you, as Slack does. chat_dm_counterparts (20270613000000) left the viewer out
-- unconditionally, so a conversation with nobody else in it came back empty and read "Direct message". Same function and
-- signature, with the viewer kept when they are the only person in the conversation.
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
    -- The viewer is left out, except in a conversation with nobody else in it (a DM with yourself, which Slack names after you).
    AND (
      a.member_id IS DISTINCT FROM p_member
      OR NOT EXISTS (
        SELECT 1
        FROM bronze.slack_channel_members b2
        LEFT JOIN chat_slack_authors a2 ON a2.slack_user_id = b2.user_id
        WHERE b2.channel_id = c.slack_channel_id AND b2.left_at IS NULL AND a2.member_id IS DISTINCT FROM p_member
      )
    )
    AND COALESCE(u.is_bot, false) = false;
$function$;

GRANT EXECUTE ON FUNCTION public.chat_dm_counterparts(text) TO authenticated, service_role;
