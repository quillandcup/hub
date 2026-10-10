-- Reacting from the Hub, phase 3 of docs/SLACK_BRIDGED_CHAT.md. The bot can't react under someone
-- else's name, so a Hub reaction stays in the Hub (synced_to_slack = false) until the member
-- connects their own Slack. It is a chat_reactions row keyed by member (slack_user_id null), which
-- the Slack projection never touches: it only upserts rows keyed by slack_user_id.
--
-- chat_toggle_reaction(message, emoji) adds the caller's reaction, takes it back if they already
-- have it (a soft delete: deleted_at), and puts it back if they had taken it back. SECURITY
-- DEFINER and bound to current_member_id(): members have no INSERT or UPDATE on chat_reactions.

CREATE OR REPLACE FUNCTION public.chat_toggle_reaction(p_message_id UUID, p_emoji TEXT) RETURNS BOOLEAN AS $$
DECLARE
  v_member UUID := (SELECT current_member_id());
  v_channel chat_channels%ROWTYPE;
  v_message chat_messages%ROWTYPE;
  v_existing chat_reactions%ROWTYPE;
BEGIN
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'chat_react: no_member';
  END IF;
  -- A Slack shortcode: lower-case letters, digits and _ + -, with an optional skin tone.
  IF p_emoji IS NULL OR p_emoji !~ '^[a-z0-9_+-]{1,64}(::skin-tone-[2-6])?$' THEN
    RAISE EXCEPTION 'chat_react: bad_emoji';
  END IF;

  SELECT * INTO v_message FROM chat_messages WHERE id = p_message_id;
  IF NOT FOUND OR v_message.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'chat_react: no_message';
  END IF;
  SELECT * INTO v_channel FROM chat_channels WHERE id = v_message.channel_id;
  -- The member's own conversations and public channels (an admin's wider RLS access doesn't count).
  IF NOT (v_channel.visibility = 'public' OR chat_is_channel_member(v_channel.id)) THEN
    RAISE EXCEPTION 'chat_react: no_message';
  END IF;
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'chat_react: archived';
  END IF;

  SELECT * INTO v_existing FROM chat_reactions
  WHERE message_id = p_message_id AND emoji = p_emoji AND member_id = v_member AND slack_user_id IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO chat_reactions (message_id, member_id, emoji, created_at, synced_to_slack)
    VALUES (p_message_id, v_member, p_emoji, now(), false);
    RETURN true;
  END IF;
  IF v_existing.deleted_at IS NULL THEN
    UPDATE chat_reactions SET deleted_at = now() WHERE id = v_existing.id;
    RETURN false;
  END IF;
  UPDATE chat_reactions SET deleted_at = NULL, created_at = now() WHERE id = v_existing.id;
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.chat_toggle_reaction(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_toggle_reaction(UUID, TEXT) TO authenticated, service_role;
