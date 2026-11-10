set lock_timeout = '5s';

-- Hub chat notifications (docs/SLACK_BRIDGED_CHAT.md, "Notifications"). Per conversation a member chooses what tells them
-- about it: chat_channel_members.muted already exists (nothing tells them); notify_level adds "all" (every message) and
-- "mentions" (only when they are mentioned), and null means the default for the kind of conversation (a direct message:
-- every message; a channel: mentions), as in Slack.
ALTER TABLE public.chat_channel_members ADD COLUMN IF NOT EXISTS notify_level text;

COMMENT ON COLUMN public.chat_channel_members.notify_level IS
  'What notifies the member about this conversation: all (every message), mentions (only when mentioned), or null for the default of its kind (direct messages: all; channels: mentions). muted overrides it.';

-- Members have no UPDATE on chat_channel_members, so the setting goes through a function that only ever touches the caller's
-- own row in a conversation they are in (as chat_mark_read does). p_setting: default, all, mentions or nothing (mutes).
CREATE OR REPLACE FUNCTION public.chat_set_notify_setting(p_channel_id text, p_setting text) RETURNS void AS $$
BEGIN
  IF p_setting NOT IN ('default', 'all', 'mentions', 'nothing') THEN
    RAISE EXCEPTION 'chat_notify: bad_setting';
  END IF;
  UPDATE chat_channel_members
  SET muted = (p_setting = 'nothing'),
      notify_level = CASE WHEN p_setting IN ('all', 'mentions') THEN p_setting ELSE NULL END
  WHERE channel_id = p_channel_id
    AND member_id = (SELECT current_member_id())
    AND left_at IS NULL;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.chat_set_notify_setting(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_set_notify_setting(text, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.chat_set_notify_setting(text, text) IS
  'The signed-in member sets what notifies them about a conversation they are in: default, all, mentions or nothing (mute). Only their own row.';

-- Chat notifications start in dry run: the flag says who gets them for real (an admin's own preview first, then a segment,
-- then everyone); for everyone else the sender only logs what it would have sent.
INSERT INTO feature_flags (feature_key, enabled_globally)
VALUES ('chat_notifications', false)
ON CONFLICT (feature_key) DO NOTHING;
