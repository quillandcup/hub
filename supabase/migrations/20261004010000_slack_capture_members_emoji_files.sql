-- Capture the Slack data the import wasn't keeping: group DMs the bot is in,
-- who is in each conversation, custom emoji, and the files attached to messages.
--
-- The workspace is on Slack's free plan: the API only serves about 90 days of
-- history and Slack deletes anything older than a year, so whatever isn't
-- copied while Slack still has it is gone. See docs/SLACK_BRIDGED_CHAT.md.
--
-- All of these are BRONZE. Membership, emoji and file *metadata* are readable by
-- admins, like the other bronze Slack tables. File *contents* go in a private
-- storage bucket with no policies, so only the service role can read them.

------------------------------------------------------------------------------------------------
-- 1. Group DMs sit in slack_channels next to channels.
------------------------------------------------------------------------------------------------
ALTER TABLE bronze.slack_channels
  ADD COLUMN IF NOT EXISTS is_mpim BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN bronze.slack_channels.is_mpim IS
  'A Slack group DM (mpim) the bot is in. Its content is direct-message content: never shown to admins as text.';

------------------------------------------------------------------------------------------------
-- 2. Who is in each conversation.
------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bronze.slack_channel_members (
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  -- When we first saw them in the channel (not when they joined: Slack doesn't say).
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Soft delete: set when a full member list no longer includes them, or on a
  -- member_left_channel event. Cleared if they come back.
  left_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX IF NOT EXISTS slack_channel_members_user_idx ON bronze.slack_channel_members (user_id);

COMMENT ON TABLE bronze.slack_channel_members IS
  'BRONZE: members of each Slack conversation the bot is in (UPSERT by channel_id + user_id; left_at is a soft delete).';

ALTER TABLE bronze.slack_channel_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bronze.slack_channel_members FROM anon, authenticated;
GRANT SELECT ON bronze.slack_channel_members TO authenticated;
GRANT ALL ON bronze.slack_channel_members TO service_role;
CREATE POLICY "Admins can read slack_channel_members" ON bronze.slack_channel_members
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

------------------------------------------------------------------------------------------------
-- 3. Custom emoji.
------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bronze.slack_custom_emoji (
  name TEXT PRIMARY KEY,
  -- Exactly one of these is set: an image, or the emoji this name is an alias for.
  image_url TEXT,
  alias_for TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE bronze.slack_custom_emoji IS
  'BRONZE: the workspace''s custom emoji (UPSERT by name; removed_at is a soft delete).';

ALTER TABLE bronze.slack_custom_emoji ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bronze.slack_custom_emoji FROM anon, authenticated;
GRANT SELECT ON bronze.slack_custom_emoji TO authenticated;
GRANT ALL ON bronze.slack_custom_emoji TO service_role;
CREATE POLICY "Admins can read slack_custom_emoji" ON bronze.slack_custom_emoji
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

------------------------------------------------------------------------------------------------
-- 4. Files attached to messages, and where our copy lives.
------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bronze.slack_files (
  file_id TEXT PRIMARY KEY,
  -- The first message we saw the file on (a file can be shared to several).
  channel_id TEXT NOT NULL,
  message_ts TEXT NOT NULL,
  name TEXT,
  mimetype TEXT,
  size_bytes BIGINT,
  -- Path in the slack-files bucket once copied.
  storage_path TEXT,
  copied_at TIMESTAMPTZ,
  -- Why it wasn't copied (too large, hosted outside Slack, download failed).
  -- 'skipped:' errors are permanent; anything else is retried on the next import.
  copy_error TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS slack_files_pending_idx ON bronze.slack_files (first_seen_at)
  WHERE storage_path IS NULL;
CREATE INDEX IF NOT EXISTS slack_files_message_idx ON bronze.slack_files (channel_id, message_ts);

COMMENT ON TABLE bronze.slack_files IS
  'BRONZE: files attached to Slack messages (UPSERT by file_id) and the path of our copy in the slack-files bucket.';

ALTER TABLE bronze.slack_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bronze.slack_files FROM anon, authenticated;
GRANT SELECT ON bronze.slack_files TO authenticated;
GRANT ALL ON bronze.slack_files TO service_role;
CREATE POLICY "Admins can read slack_files" ON bronze.slack_files
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

-- Private, and deliberately no storage.objects policies: files from private
-- channels and group DMs are in here, so only the service role reads or writes.
INSERT INTO storage.buckets (id, name, public)
VALUES ('slack-files', 'slack-files', false)
ON CONFLICT (id) DO NOTHING;

------------------------------------------------------------------------------------------------
-- 5. Direct-message text never reaches member_activities.
--
-- Group DMs (and DMs with the bot) are stored in bronze.slack_messages like any
-- other message, and they count toward engagement. But the activity row is
-- visible to admins, so for those conversations it carries no message text and
-- a generic title instead of the conversation's name (a group DM's name lists
-- its members). Who talked with whom stays available as metadata in `data`.
--
-- Otherwise identical to 20261003020000_reprocess_slack_activities_atomic.sql.
-- The webhook doesn't set channel_type, so it's also read from the raw event.
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reprocess_slack_activities_atomic(
  from_date TIMESTAMPTZ,
  to_date TIMESTAMPTZ,
  user_member_map JSONB
) RETURNS JSONB AS $$
DECLARE
  message_count INTEGER;
  reaction_count INTEGER;
BEGIN
  -- Nothing in bronze for this window: leave the existing activities alone
  -- instead of wiping them (same as the route's old early return).
  IF NOT EXISTS (
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

REVOKE ALL ON FUNCTION reprocess_slack_activities_atomic(TIMESTAMPTZ, TIMESTAMPTZ, JSONB)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reprocess_slack_activities_atomic(TIMESTAMPTZ, TIMESTAMPTZ, JSONB)
  TO authenticated, service_role;
