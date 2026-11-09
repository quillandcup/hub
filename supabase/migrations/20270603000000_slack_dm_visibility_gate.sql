set lock_timeout = '5s';

-- Who sees a pulled Slack DM. A DM is read with one member's own token (the slack_dm_bridge feature, docs/SLACK_BRIDGED_CHAT.md), and
-- both of its Hub members were put in it, so the other person saw it in their chat even when the bridge was not on for them.
-- Now a Slack DM is in the chat of the members who have pulled their own DMs (member_slack_connections.dms_pulled_at, stamped by
-- the pull and when a member opens a DM), and only them: the other person gets it when their own pull finds it. A Hub-only DM
-- (chat_dms; no Slack channel) is not touched. Same two functions as 20270430000000_slack_dm_bridge.sql, with the check added,
-- and a one-time closing of the memberships that exist without it.

-- Whether this member has pulled their DMs: a working connection that has been pulled at least once.
CREATE OR REPLACE FUNCTION public.slack_dm_member_pulled(p_member text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM member_slack_connections c
    WHERE c.member_id = p_member AND c.revoked_at IS NULL AND c.dms_pulled_at IS NOT NULL
  );
$function$;

REVOKE ALL ON FUNCTION public.slack_dm_member_pulled(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.slack_dm_member_pulled(text) TO service_role;
COMMENT ON FUNCTION public.slack_dm_member_pulled(text) IS
  'Service role: whether the member has a working Slack connection whose DMs have been pulled at least once (they are in the chat of the Slack DMs they pulled).';

CREATE OR REPLACE FUNCTION public.project_slack_dm(p_channel_id text, p_members jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_channel text;
BEGIN
  INSERT INTO chat_channels (kind, slack_channel_id, visibility, restricted, created_at)
  SELECT 'dm', c.channel_id, 'private', true, COALESCE(c.created, now())
  FROM bronze.slack_channels c
  WHERE c.channel_id = p_channel_id AND c.is_im
  ON CONFLICT (slack_channel_id) DO UPDATE SET kind = 'dm', visibility = 'private', restricted = true
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

-- Close what exists without it: the memberships of Slack DMs held by a member who has not pulled.
UPDATE chat_channel_members cm
SET left_at = now()
FROM chat_channels cc
WHERE cc.id = cm.channel_id
  AND cc.kind = 'dm'
  AND cc.slack_channel_id IS NOT NULL
  AND cm.left_at IS NULL
  AND cm.source = 'slack'
  AND NOT slack_dm_member_pulled(cm.member_id);

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
      -- A Slack DM is in the chat of the members who pulled their own DMs, not of the other person just for being in it.
      AND (cc.kind <> 'dm' OR slack_dm_member_pulled(user_member_map->>bm.user_id))
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
        -- A Slack DM is kept only by the members who pulled their own DMs.
        (cc.kind = 'dm' AND NOT slack_dm_member_pulled(cm.member_id))
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
