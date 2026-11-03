set lock_timeout = '5s';

-- A member who is no longer in a Slack channel kept seeing it in the Hub when nothing closed their
-- chat_channel_members row: project_slack_chat_channels only upserted the rows Bronze still lists, so a row
-- whose Slack account stopped matching the member (or whose Bronze row is gone) stayed active. The projection
-- now also closes Slack-sourced rows that no active Bronze membership backs through the current user ->
-- member map, in channels where Bronze lists someone (an empty list could be a failed fetch). The webhook
-- applies leaves immediately (lib/slack-capture.ts); this is the reconciliation behind it.
-- Same function as 20261215000000_short_ids_tier1.sql, plus the step and the `closed` count.

CREATE OR REPLACE FUNCTION public.project_slack_chat_channels(user_member_map jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  channel_count INTEGER;
  member_count INTEGER;
  closed_count INTEGER;
BEGIN
  -- The Slack user -> member map, kept for the per-message projection.
  INSERT INTO chat_slack_authors (slack_user_id, member_id)
  SELECT e.key, e.value
  FROM jsonb_each_text(user_member_map) e
  WHERE EXISTS (SELECT 1 FROM members m WHERE m.id = e.value)
  ON CONFLICT (slack_user_id) DO UPDATE SET member_id = EXCLUDED.member_id, updated_at = now();
  DELETE FROM chat_slack_authors a WHERE NOT (user_member_map ? a.slack_user_id);

  WITH upserted AS (
    INSERT INTO chat_channels (kind, slack_channel_id, visibility, restricted, name, topic, purpose, archived_at, created_at)
    SELECT
      CASE WHEN c.is_mpim THEN 'group_dm' ELSE 'channel' END,
      c.channel_id,
      CASE WHEN c.is_private OR c.is_mpim THEN 'private' ELSE 'public' END,
      c.is_mpim OR EXISTS (SELECT 1 FROM restricted_slack_channels rc WHERE rc.channel_id = c.channel_id),
      -- A group DM's Slack name lists its members: not shown.
      CASE WHEN c.is_mpim THEN NULL ELSE c.name END,
      NULLIF(c.topic, ''),
      NULLIF(c.purpose, ''),
      CASE WHEN c.is_archived THEN COALESCE(c.imported_at, now()) END,
      COALESCE(c.created, now())
    FROM bronze.slack_channels c
    ON CONFLICT (slack_channel_id) DO UPDATE SET
      kind        = EXCLUDED.kind,
      visibility  = EXCLUDED.visibility,
      restricted  = EXCLUDED.restricted,
      name        = EXCLUDED.name,
      topic       = EXCLUDED.topic,
      purpose     = EXCLUDED.purpose,
      archived_at = CASE WHEN EXCLUDED.archived_at IS NULL THEN NULL
                         ELSE COALESCE(chat_channels.archived_at, EXCLUDED.archived_at) END
    RETURNING 1
  )
  SELECT count(*) INTO channel_count FROM upserted;

  -- Who is in each conversation, for members we can match. Rejoining clears left_at.
  WITH upserted AS (
    INSERT INTO chat_channel_members (channel_id, member_id, joined_at, left_at)
    SELECT DISTINCT ON (cc.id, (user_member_map->>bm.user_id))
      cc.id, (user_member_map->>bm.user_id), bm.first_seen_at, bm.left_at
    FROM bronze.slack_channel_members bm
    JOIN chat_channels cc ON cc.slack_channel_id = bm.channel_id AND NOT cc.bridge_disabled
    WHERE user_member_map ? bm.user_id
      AND EXISTS (SELECT 1 FROM members m WHERE m.id = (user_member_map->>bm.user_id))
    ORDER BY cc.id, (user_member_map->>bm.user_id), bm.left_at NULLS FIRST
    ON CONFLICT (channel_id, member_id) DO UPDATE SET left_at = EXCLUDED.left_at
    RETURNING 1
  )
  SELECT count(*) INTO member_count FROM upserted;

  -- Close what Bronze no longer backs. The upsert above only touches rows Bronze still lists, so a row whose
  -- Slack account is no longer matched to that member (the matching changed) was never closed, and kept
  -- showing the member a private channel. Slack-sourced rows only (a Hub-made membership is not Slack's to
  -- end), and only in a channel where Bronze lists someone active: an empty list reads as a failed fetch,
  -- not as everyone leaving. Rejoining clears left_at in the upsert above, so this is safe to repeat.
  WITH closed AS (
    UPDATE chat_channel_members cm
    SET left_at = now()
    FROM chat_channels cc
    WHERE cc.id = cm.channel_id
      AND cm.source = 'slack'
      AND cm.left_at IS NULL
      AND cc.slack_channel_id IS NOT NULL
      AND NOT cc.bridge_disabled
      AND EXISTS (
        SELECT 1 FROM bronze.slack_channel_members b
        WHERE b.channel_id = cc.slack_channel_id AND b.left_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM bronze.slack_channel_members b
        WHERE b.channel_id = cc.slack_channel_id
          AND b.left_at IS NULL
          AND user_member_map ? b.user_id
          AND (user_member_map->>b.user_id) = cm.member_id
      )
    RETURNING 1
  )
  SELECT count(*) INTO closed_count FROM closed;

  RETURN jsonb_build_object('channels', channel_count, 'members', member_count, 'closed', closed_count);
END;
$function$;
