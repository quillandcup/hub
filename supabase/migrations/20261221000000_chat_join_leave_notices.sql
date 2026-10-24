-- Slack's "X has joined the channel" / "X was added to the channel by Y" / "X has left the channel" notices
-- are shown in the chat like Slack shows them, as system lines (lib/slack-messages.ts keeps them in Bronze now).
-- They join the other channel notices in the system-message list, which is what:
--  * marks chat_messages.system_subtype (chat_fill_system_subtype, from Bronze on insert),
--  * keeps them out of the Slack activity rebuild (reprocess_slack_activities_atomic reads this function,
--    so someone joining a channel doesn't "post" in it) and out of the unread count.
-- The list lives here and in SLACK_SYSTEM_SUBTYPES (lib/slack-messages.ts); change both together.

CREATE OR REPLACE FUNCTION public.slack_is_system_message_type(p_type TEXT) RETURNS BOOLEAN AS $$
  SELECT COALESCE(p_type IN (
    'channel_name', 'channel_topic', 'channel_purpose', 'channel_archive', 'channel_unarchive',
    'group_name', 'group_topic', 'group_purpose', 'group_archive', 'group_unarchive',
    'channel_join', 'channel_leave', 'group_join', 'group_leave'
  ), false);
$$ LANGUAGE sql IMMUTABLE SET search_path = public;

REVOKE ALL ON FUNCTION public.slack_is_system_message_type(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.slack_is_system_message_type(TEXT) TO service_role;
