-- Channel names on Slack activities. The activity rebuild took a message's channel from
-- bronze.slack_messages.channel_name, which only the bulk importer fills in: messages that arrived
-- through the webhook (every live one) have none, so the activity log said "Posted in #" and the
-- member's Slack tab "#unknown". The rebuild already joins bronze.slack_channels, which has the real
-- names, so it now uses that when the message's own name is empty (same for reactions).
-- Otherwise identical to 20261019000000_slack_activities_credit_hub_posts.sql (the latest version
-- of this function), including the privacy rules and grants. The UPDATE repairs activities already
-- built without a name; direct and group messages stay nameless on purpose.

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


UPDATE member_activities a
   SET title = CASE WHEN a.title = 'Posted in #' THEN 'Posted in #' || c.name ELSE a.title END,
       data = jsonb_set(a.data, '{channel_name}', to_jsonb(c.name))
  FROM bronze.slack_channels c
 WHERE a.source = 'slack'
   AND c.channel_id = a.data ->> 'channel_id'
   AND COALESCE(a.data ->> 'channel_name', '') = ''
   AND COALESCE(a.data ->> 'channel_type', '') NOT IN ('mpim', 'im')
   AND NOT c.is_mpim
   AND COALESCE(c.name, '') <> '';
