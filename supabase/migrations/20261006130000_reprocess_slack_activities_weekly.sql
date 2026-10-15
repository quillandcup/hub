-- Let /api/process/slack rebuild Slack activities one week at a time.
--
-- reprocess_slack_activities_atomic deletes every Slack activity in its window
-- and inserts them again. For the 90-day import that is ~23k rows in one
-- statement, which in production runs past the 8s statement timeout (57014) and
-- rolls back, so Slack activity stopped updating. The route now calls it once
-- per week of the range: the same DELETE + INSERT, a few thousand rows a call.
--
-- The function is unchanged except for one new argument. Its "nothing in bronze
-- for this window, leave the activities alone" check protects against wiping
-- activities when bronze is empty. Applied per week it would also keep the
-- activities of a week whose messages were all really deleted in Slack, so the
-- route makes that check once for its whole range and passes
-- skip_empty_check => true for each week. Other callers keep the old behavior.
--
-- Adding an argument means a new signature, so the old one is dropped first.
-- A caller that still passes three named arguments resolves to this function.
DROP FUNCTION IF EXISTS reprocess_slack_activities_atomic(TIMESTAMPTZ, TIMESTAMPTZ, JSONB);

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
       WHERE occurred_at >= from_date AND occurred_at <= to_date AND removed_at IS NULL
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
      CASE
        WHEN c.is_mpim OR COALESCE(m.channel_type, m.raw_payload->>'channel_type') = 'mpim' THEN 'mpim'
        WHEN COALESCE(m.channel_type, m.raw_payload->>'channel_type') = 'im' THEN 'im'
        ELSE m.channel_type
      END AS conversation_type
    FROM bronze.slack_messages m
    LEFT JOIN bronze.slack_channels c ON c.channel_id = m.channel_id
    WHERE m.occurred_at >= from_date
      AND m.occurred_at <= to_date
      AND m.deleted_at IS NULL
      AND user_member_map ? m.user_id
  ),
  inserted AS (
    INSERT INTO member_activities (
      member_id, activity_type, activity_category, title, description, data,
      related_id, engagement_value, occurred_at, source
    )
    SELECT
      (user_member_map->>m.user_id)::uuid,
      CASE WHEN COALESCE(m.thread_ts, '') <> '' AND m.thread_ts <> m.message_ts
           THEN 'slack_thread_reply' ELSE 'slack_message' END,
      'communication',
      CASE m.conversation_type
        WHEN 'mpim' THEN 'Sent a group message'
        WHEN 'im' THEN 'Sent a direct message'
        ELSE 'Posted in #' || COALESCE(m.channel_name, '')
      END,
      CASE WHEN m.conversation_type IN ('mpim', 'im') THEN NULL
           ELSE NULLIF(left(m.text, 200), '') END,
      jsonb_build_object(
        'channel_id', m.channel_id,
        'channel_name', CASE WHEN m.conversation_type IN ('mpim', 'im') THEN NULL ELSE m.channel_name END,
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
        'channel_name', CASE WHEN c.is_mpim THEN NULL ELSE r.channel_name END,
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
      AND r.removed_at IS NULL
      AND user_member_map ? r.user_id
    RETURNING 1
  )
  SELECT count(*) INTO reaction_count FROM inserted;

  RETURN jsonb_build_object('messages', message_count, 'reactions', reaction_count);
END;
$$ LANGUAGE plpgsql SET search_path = 'public';

REVOKE ALL ON FUNCTION reprocess_slack_activities_atomic(TIMESTAMPTZ, TIMESTAMPTZ, JSONB, BOOLEAN)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reprocess_slack_activities_atomic(TIMESTAMPTZ, TIMESTAMPTZ, JSONB, BOOLEAN)
  TO authenticated, service_role;
