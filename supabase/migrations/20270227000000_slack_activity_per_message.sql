-- Slack activities, one message at a time (docs/TODO.md, "Slack Webhook: The Per-Event Activity Rebuild
-- Doesn't Scale").
--
-- Every Slack message, edit, delete and reaction webhook used to rebuild a whole day of Slack
-- member_activities (reprocess_slack_activities_atomic: DELETE the day, INSERT it again) after loading and
-- matching every member in TypeScript. Several events at once rebuilt the same rows at the same time and
-- queued behind each other's row locks until Postgres's 8-second statement timeout cancelled them (57014 in the
-- logs, a few a day, more with every message once chat is busy); the reads themselves take about 100 ms.
--
-- slack_activity_project_message(channel, ts) re-derives the activities of ONE message and its reactions: it
-- deletes the rows keyed by that message (member_activities.related_id = channel:ts, source slack) and inserts
-- what Bronze says now. A constant cost however busy the day, and events about different messages never touch
-- the same rows. It applies the SAME rules as the windowed rebuild (which stays, for imports, restriction changes
-- and the nightly run): no text for group DMs, DMs or restricted channels, the same engagement values, nothing for
-- system notices or deleted messages and reactions. Where the window gets "which member is this Slack user" from
-- the matching the caller did in TypeScript and passed in, this reads the map the chat projection already keeps
-- (chat_slack_authors, rewritten by each full projection from that same matching), so a Slack user who
-- appeared since the last full projection has no activity until the next rebuild (the nightly one).
--
-- Two events about the same message wait for each other (an advisory transaction lock on the message), so the
-- second one sees the first one's rows when it deletes and nothing is inserted twice. tests/api/ checks that
-- this and the windowed function produce identical rows.

-- Finding a message's activities by key without scanning the table.
CREATE INDEX IF NOT EXISTS idx_member_activities_slack_related
  ON public.member_activities (related_id)
  WHERE source = 'slack';

CREATE OR REPLACE FUNCTION public.slack_activity_project_message(p_channel_id TEXT, p_message_ts TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path TO 'public'
SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_key TEXT := p_channel_id || ':' || p_message_ts;
  message_count INTEGER;
  reaction_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('slack_activity:' || v_key, 0));

  DELETE FROM member_activities WHERE source = 'slack' AND related_id = v_key;

  WITH typed AS (
    SELECT
      m.*,
      -- The name Slack gave the channel: the webhook never stores one on the message, only the importer does.
      COALESCE(NULLIF(m.channel_name, ''), c.name) AS channel_label,
      -- Who wrote it: the Hub author of a message posted from the Hub, else the Slack user's member.
      COALESCE(hub.author_member_id, a.member_id) AS author_member_id,
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
    LEFT JOIN chat_slack_authors a ON a.slack_user_id = m.user_id
    LEFT JOIN LATERAL (
      SELECT cm.author_member_id
      FROM chat_channels cc
      JOIN chat_messages cm ON cm.channel_id = cc.id AND cm.slack_ts = m.message_ts AND cm.origin = 'app'
      WHERE cc.slack_channel_id = m.channel_id AND cm.author_member_id IS NOT NULL
    ) hub ON true
    WHERE m.channel_id = p_channel_id
      AND m.message_ts = p_message_ts
      AND m.deleted_at IS NULL
      AND NOT public.slack_is_system_message_type(m.message_type)
      AND COALESCE(hub.author_member_id, a.member_id) IS NOT NULL
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
      a.member_id,
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
    JOIN chat_slack_authors a ON a.slack_user_id = r.user_id
    WHERE r.channel_id = p_channel_id
      AND r.message_ts = p_message_ts
      AND r.deleted_at IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO reaction_count FROM inserted;

  RETURN jsonb_build_object('messages', message_count, 'reactions', reaction_count);
END;
$function$;

COMMENT ON FUNCTION public.slack_activity_project_message(TEXT, TEXT) IS
  'LOCAL: rebuild the Slack member_activities of one message and its reactions from Bronze (same rules as reprocess_slack_activities_atomic, the Slack user->member map from chat_slack_authors). Called per webhook event; service role only.';

REVOKE ALL ON FUNCTION public.slack_activity_project_message(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.slack_activity_project_message(TEXT, TEXT) TO service_role;
