-- Channel-change notices Slack posts itself ("Ania renamed the channel from X to Y") in the chat.
--
-- Bronze now keeps them (lib/slack-messages.ts, message_type = the Slack subtype). They are not
-- something a member wrote, so:
--  * chat_messages.system_subtype marks them, filled from Bronze by a trigger (like
--    chat_fill_content_files) so the two projection functions stay as they are; the Hub renders
--    them as a quiet line instead of a post;
--  * the activity rebuild skips them (otherwise the person who renamed a channel "posted in" it).
--    The function is otherwise identical to 20261104000000_slack_activities_channel_names.sql
--    (the latest version), including privacy rules and grants;
--  * the unread badge doesn't count them. Otherwise identical to 20261017000000_chat_read_state.sql.
-- The subtype list lives in slack_is_system_message_type and SLACK_SYSTEM_SUBTYPES
-- (lib/slack-messages.ts); change both together.

CREATE OR REPLACE FUNCTION public.slack_is_system_message_type(p_type TEXT) RETURNS BOOLEAN AS $$
  SELECT COALESCE(p_type IN (
    'channel_name', 'channel_topic', 'channel_purpose', 'channel_archive', 'channel_unarchive',
    'group_name', 'group_topic', 'group_purpose', 'group_archive', 'group_unarchive'
  ), false);
$$ LANGUAGE sql IMMUTABLE SET search_path = public;

REVOKE ALL ON FUNCTION public.slack_is_system_message_type(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.slack_is_system_message_type(TEXT) TO service_role;

ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS system_subtype TEXT;

COMMENT ON COLUMN public.chat_messages.system_subtype IS
  'LOCAL: the Slack subtype (channel_name, channel_topic, ...) of a notice Slack posted itself; null for something a member wrote. Filled from Bronze on insert.';

CREATE OR REPLACE FUNCTION public.chat_fill_system_subtype() RETURNS trigger AS $$
BEGIN
  IF NEW.slack_ts IS NOT NULL AND NEW.system_subtype IS NULL THEN
    SELECT b.message_type INTO NEW.system_subtype
    FROM chat_channels cc
    JOIN bronze.slack_messages b ON b.channel_id = cc.slack_channel_id AND b.message_ts = NEW.slack_ts
    WHERE cc.id = NEW.channel_id AND public.slack_is_system_message_type(b.message_type);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS chat_fill_system_subtype ON public.chat_messages;
CREATE TRIGGER chat_fill_system_subtype
  BEFORE INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.chat_fill_system_subtype();

CREATE OR REPLACE FUNCTION reprocess_slack_activities_atomic(
  from_date TIMESTAMPTZ,
  to_date TIMESTAMPTZ,
  user_member_map JSONB,
  skip_empty_check BOOLEAN DEFAULT false
) RETURNS JSONB AS $$
DECLARE
  message_count INTEGER;
  reaction_count INTEGER;
BEGIN
  -- Nothing in bronze for this window: leave the existing activities alone
  -- instead of wiping them. A caller that has already made that check for its
  -- whole range passes skip_empty_check, so a window inside the range whose
  -- messages were all deleted in Slack still loses its activities.
  IF NOT skip_empty_check
     AND NOT EXISTS (
       SELECT 1 FROM bronze.slack_messages
       WHERE occurred_at >= from_date AND occurred_at <= to_date AND deleted_at IS NULL
     )
     AND NOT EXISTS (
       SELECT 1 FROM bronze.slack_reactions
       WHERE occurred_at >= from_date AND occurred_at <= to_date AND deleted_at IS NULL
     )
  THEN
    RETURN jsonb_build_object('messages', 0, 'reactions', 0);
  END IF;

  DELETE FROM member_activities
  WHERE source = 'slack'
    AND occurred_at >= from_date
    AND occurred_at <= to_date;

  WITH typed AS (
    SELECT
      m.*,
      -- The name Slack gave the channel: the webhook never stores one on the message, only the importer does.
      COALESCE(NULLIF(m.channel_name, ''), c.name) AS channel_label,
      -- Who wrote it: the Hub author of a message posted from the Hub, else the Slack user's member.
      COALESCE(hub.author_member_id, (user_member_map->>m.user_id)::uuid) AS author_member_id,
      CASE
        WHEN c.is_mpim OR COALESCE(m.channel_type, m.raw_payload->>'channel_type') = 'mpim' THEN 'mpim'
        WHEN COALESCE(m.channel_type, m.raw_payload->>'channel_type') = 'im' THEN 'im'
        ELSE m.channel_type
      END AS conversation_type,
      EXISTS (
        SELECT 1 FROM restricted_slack_channels rc WHERE rc.channel_id = m.channel_id
      ) AS restricted
    FROM bronze.slack_messages m
    LEFT JOIN bronze.slack_channels c ON c.channel_id = m.channel_id
    LEFT JOIN LATERAL (
      SELECT cm.author_member_id
      FROM chat_channels cc
      JOIN chat_messages cm ON cm.channel_id = cc.id AND cm.slack_ts = m.message_ts AND cm.origin = 'app'
      WHERE cc.slack_channel_id = m.channel_id AND cm.author_member_id IS NOT NULL
    ) hub ON true
    WHERE m.occurred_at >= from_date
      AND m.occurred_at <= to_date
      AND m.deleted_at IS NULL
      AND NOT public.slack_is_system_message_type(m.message_type)
      AND (hub.author_member_id IS NOT NULL OR user_member_map ? m.user_id)
  ),
  inserted AS (
    INSERT INTO member_activities (
      member_id, activity_type, activity_category, title, description, data,
      related_id, engagement_value, occurred_at, source
    )
    SELECT
      m.author_member_id,
      CASE WHEN COALESCE(m.thread_ts, '') <> '' AND m.thread_ts <> m.message_ts
           THEN 'slack_thread_reply' ELSE 'slack_message' END,
      'communication',
      CASE m.conversation_type
        WHEN 'mpim' THEN 'Sent a group message'
        WHEN 'im' THEN 'Sent a direct message'
        ELSE 'Posted in #' || COALESCE(m.channel_label, '')
      END,
      CASE WHEN m.conversation_type IN ('mpim', 'im') OR m.restricted THEN NULL
           ELSE NULLIF(left(m.text, 200), '') END,
      jsonb_build_object(
        'channel_id', m.channel_id,
        'channel_name', CASE WHEN m.conversation_type IN ('mpim', 'im') THEN NULL ELSE m.channel_label END,
        'channel_type', m.conversation_type,
        'message_ts', m.message_ts,
        'thread_ts', m.thread_ts,
        'is_thread_reply', (COALESCE(m.thread_ts, '') <> '' AND m.thread_ts <> m.message_ts),
        'has_files', (m.files IS NOT NULL AND m.files <> 'null'::jsonb)
      ),
      m.channel_id || ':' || m.message_ts,
      1
        + CASE WHEN COALESCE(m.thread_ts, '') = '' THEN 2 ELSE 0 END
        + CASE WHEN COALESCE(m.thread_ts, '') <> '' AND m.thread_ts <> m.message_ts THEN 1 ELSE 0 END
        + CASE WHEN m.files IS NOT NULL AND m.files <> 'null'::jsonb THEN 2 ELSE 0 END
        + CASE WHEN char_length(COALESCE(m.text, '')) > 500 THEN 1 ELSE 0 END,
      m.occurred_at,
      'slack'
    FROM typed m
    RETURNING 1
  )
  SELECT count(*) INTO message_count FROM inserted;

  WITH inserted AS (
    INSERT INTO member_activities (
      member_id, activity_type, activity_category, title, description, data,
      related_id, engagement_value, occurred_at, source
    )
    SELECT
      (user_member_map->>r.user_id)::uuid,
      'slack_reaction',
      'communication',
      'Reacted :' || r.reaction || ':',
      NULL,
      jsonb_build_object(
        'channel_id', r.channel_id,
        'channel_name', CASE WHEN c.is_mpim THEN NULL ELSE COALESCE(NULLIF(r.channel_name, ''), c.name) END,
        'message_ts', r.message_ts,
        'reaction', r.reaction
      ),
      r.channel_id || ':' || r.message_ts,
      1,
      r.occurred_at,
      'slack'
    FROM bronze.slack_reactions r
    LEFT JOIN bronze.slack_channels c ON c.channel_id = r.channel_id
    WHERE r.occurred_at >= from_date
      AND r.occurred_at <= to_date
      AND r.deleted_at IS NULL
      AND user_member_map ? r.user_id
    RETURNING 1
  )
  SELECT count(*) INTO reaction_count FROM inserted;

  RETURN jsonb_build_object('messages', message_count, 'reactions', reaction_count);
END;
$$ LANGUAGE plpgsql SET search_path = 'public';

REVOKE ALL ON FUNCTION reprocess_slack_activities_atomic(TIMESTAMPTZ, TIMESTAMPTZ, JSONB, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reprocess_slack_activities_atomic(TIMESTAMPTZ, TIMESTAMPTZ, JSONB, BOOLEAN)
  TO service_role;

CREATE OR REPLACE FUNCTION public.chat_unread_counts() RETURNS TABLE (channel_id UUID, unread INTEGER) AS $$
  SELECT counted.channel_id, counted.unread
  FROM (
    SELECT cm.channel_id,
      (
        SELECT count(*)::int FROM (
          SELECT 1 FROM chat_messages m
          WHERE m.channel_id = cm.channel_id
            AND m.thread_root_id IS NULL
            AND m.deleted_at IS NULL
            AND m.system_subtype IS NULL
            AND m.created_at > COALESCE(cm.last_read_at, cm.joined_at)
            AND m.author_member_id IS DISTINCT FROM cm.member_id
          LIMIT 100
        ) capped
      ) AS unread
    FROM chat_channel_members cm
    JOIN chat_channels c ON c.id = cm.channel_id AND c.archived_at IS NULL
    WHERE cm.member_id = (SELECT current_member_id()) AND cm.left_at IS NULL
  ) counted
  WHERE counted.unread > 0;
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public;

REVOKE ALL ON FUNCTION public.chat_unread_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_unread_counts() TO authenticated, service_role;
