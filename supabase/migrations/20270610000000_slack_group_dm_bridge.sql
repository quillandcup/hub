set lock_timeout = '5s';

-- Slack group DMs the bot is not in, read with members' own tokens (docs/SLACK_BRIDGED_CHAT.md, "Slack 1:1 DMs through
-- members' own tokens"). Group DMs the bot is in are bridged by the bot, for everyone in them; one only a member's token
-- can read must follow the 1:1 DM rule (20270603000000_slack_dm_visibility_gate.sql): it is in the chat of the members who
-- have pulled their own DMs, and no one else.
--
-- The marker is bronze.slack_channels.token_only. The member's pull inserts a group the bot has not recorded with it set
-- (INSERT ... ON CONFLICT DO NOTHING, so it never touches a row the bot has, and the member's pull never writes it again);
-- the bot's import writes it false on every upsert of a group it lists, so a group the bot later joins flips to bot-read.

ALTER TABLE bronze.slack_channels ADD COLUMN IF NOT EXISTS token_only BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN bronze.slack_channels.token_only IS
  'A group DM that only a member''s own token reads (the bot is not in it): set when a member''s pull records a group the bot has not, written false by the bot''s import whenever it lists the group. Such a group is in the chat only of the members who have pulled their DMs.';

-- raw_payload is hidden from signed-in users on this table; each other column needs its own grant.
GRANT SELECT (token_only) ON bronze.slack_channels TO authenticated;

CREATE OR REPLACE FUNCTION public.slack_group_dm_token_only(p_channel text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM bronze.slack_channels c
    WHERE c.channel_id = p_channel AND c.is_mpim AND c.token_only
  );
$function$;

REVOKE ALL ON FUNCTION public.slack_group_dm_token_only(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.slack_group_dm_token_only(text) TO service_role;
COMMENT ON FUNCTION public.slack_group_dm_token_only(text) IS
  'Service role: whether the Slack conversation is a group DM that only members'' own tokens read (bronze.slack_channels.token_only).';

-- One token-only group DM into the chat right now: the conversation (a group message: private, restricted, unnamed) and
-- the participants who are Hub members and have pulled (p_members: Slack user id -> member id). Returns channel null for
-- anything else (unknown, or a group the bot reads, which the bot's projection owns).
CREATE OR REPLACE FUNCTION public.project_slack_group_dm(p_channel_id text, p_members jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_channel text;
BEGIN
  INSERT INTO chat_channels (kind, slack_channel_id, visibility, restricted, created_at)
  SELECT 'group_dm', c.channel_id, 'private', true, COALESCE(c.created, now())
  FROM bronze.slack_channels c
  WHERE c.channel_id = p_channel_id AND c.is_mpim AND c.token_only
  ON CONFLICT (slack_channel_id) DO UPDATE SET kind = 'group_dm', visibility = 'private', restricted = true
  RETURNING id INTO v_channel;
  IF v_channel IS NULL THEN
    RETURN jsonb_build_object('channel', NULL);
  END IF;

  -- Every matched participant is the author of their messages, whether or not they have pulled.
  INSERT INTO chat_slack_authors (slack_user_id, member_id)
  SELECT e.key, e.value FROM jsonb_each_text(p_members) e
  WHERE EXISTS (SELECT 1 FROM members m WHERE m.id = e.value)
  ON CONFLICT (slack_user_id) DO NOTHING;

  -- But only a member who has pulled is in the conversation (sees it).
  INSERT INTO chat_channel_members (channel_id, member_id, joined_at)
  SELECT v_channel, e.value, now() FROM jsonb_each_text(p_members) e
  WHERE EXISTS (SELECT 1 FROM members m WHERE m.id = e.value) AND slack_dm_member_pulled(e.value)
  ON CONFLICT (channel_id, member_id) DO UPDATE SET left_at = NULL;

  RETURN jsonb_build_object('channel', v_channel);
END;
$function$;

REVOKE ALL ON FUNCTION public.project_slack_group_dm(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_slack_group_dm(text, jsonb) TO service_role;
COMMENT ON FUNCTION public.project_slack_group_dm(text, jsonb) IS
  'Service role: projects one token-only Slack group DM (bronze.slack_channels.token_only) and its Hub-member participants who have pulled into chat_channels and chat_channel_members.';

-- Same function as 20270603000000_slack_dm_visibility_gate.sql, with a token-only group DM held to the same rule as a 1:1 DM.
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
      CASE WHEN c.is_im THEN 'dm' WHEN c.is_mpim THEN 'group_dm' ELSE 'channel' END,
      c.channel_id,
      CASE WHEN c.is_private OR c.is_mpim OR c.is_im THEN 'private' ELSE 'public' END,
      c.is_im OR c.is_mpim OR EXISTS (SELECT 1 FROM restricted_slack_channels rc WHERE rc.channel_id = c.channel_id),
      -- A group DM's Slack name lists its members: not shown. A 1:1 DM has none.
      CASE WHEN c.is_mpim OR c.is_im THEN NULL ELSE c.name END,
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
      -- A Slack DM, or a group DM only a member's token reads, is in the chat of the members who pulled their own DMs,
      -- not of the others just for being in it.
      AND (NOT (cc.kind = 'dm' OR slack_group_dm_token_only(cc.slack_channel_id)) OR slack_dm_member_pulled(user_member_map->>bm.user_id))
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
      AND (
        -- A Slack DM, or a token-only group DM, is kept only by the members who pulled their own DMs.
        ((cc.kind = 'dm' OR slack_group_dm_token_only(cc.slack_channel_id)) AND NOT slack_dm_member_pulled(cm.member_id))
        OR (
          EXISTS (
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
        )
      )
    RETURNING 1
  )
  SELECT count(*) INTO closed_count FROM closed;

  RETURN jsonb_build_object('channels', channel_count, 'members', member_count, 'closed', closed_count);
END;
$function$;
