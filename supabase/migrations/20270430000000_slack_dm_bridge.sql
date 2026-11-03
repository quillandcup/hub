set lock_timeout = '5s';

-- Slack 1:1 DMs, read with the members' own tokens (docs/SLACK_BRIDGED_CHAT.md, "Slack 1:1 DMs through members' own tokens").
-- The bot can't be in them, so a member's token lists and reads their DMs into the same Bronze tables as
-- everything else; this lets the chat projection treat them as direct messages: kind 'dm', private and
-- restricted (staff only through break-glass access), no name.

ALTER TABLE bronze.slack_channels
  ADD COLUMN IF NOT EXISTS is_im BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS im_user_id TEXT;

COMMENT ON COLUMN bronze.slack_channels.is_im IS
  'A Slack 1:1 direct message, read with a member''s own token (the bot is never in one). Its content is direct-message content: never shown to admins as text.';
COMMENT ON COLUMN bronze.slack_channels.im_user_id IS
  'For a 1:1 DM: the Slack user id of the other person, as conversations.list reports it for the member whose token listed it.';

-- raw_payload is hidden from signed-in users on this table; each other column needs its own grant
-- (slack_content_privacy.test.sql). Which conversations are DMs and who is in them is metadata staff may see.
GRANT SELECT (is_im, im_user_id) ON bronze.slack_channels TO authenticated;

-- When a member's DMs were last pulled, so opening chat repeatedly doesn't list and read them every time.
ALTER TABLE public.member_slack_connections ADD COLUMN IF NOT EXISTS dms_pulled_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.chat_claim_slack_dm_pull(p_member text, p_min_seconds integer)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH claimed AS (
    UPDATE member_slack_connections
    SET dms_pulled_at = now()
    WHERE member_id = p_member
      AND revoked_at IS NULL
      AND (dms_pulled_at IS NULL OR dms_pulled_at < now() - make_interval(secs => p_min_seconds))
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$function$;

REVOKE ALL ON FUNCTION public.chat_claim_slack_dm_pull(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_claim_slack_dm_pull(text, integer) TO service_role;
COMMENT ON FUNCTION public.chat_claim_slack_dm_pull(text, integer) IS
  'Service role: true at most once per p_min_seconds for a member with a working Slack connection (and stamps it), so one caller pulls their DMs.';

-- One 1:1 DM into the chat right now, from the Bronze row a member's token just wrote: the conversation
-- (a direct message: private, restricted, unnamed) and the participants who are Hub members
-- (p_members: Slack user id -> member id). It also fills chat_slack_authors for them if the full projection
-- hasn't yet, never replacing a row it has. The messages are projected one at a time with
-- project_slack_chat_message; the full projection below covers everything else.
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

  INSERT INTO chat_slack_authors (slack_user_id, member_id)
  SELECT e.key, e.value FROM jsonb_each_text(p_members) e
  WHERE EXISTS (SELECT 1 FROM members m WHERE m.id = e.value)
  ON CONFLICT (slack_user_id) DO NOTHING;

  INSERT INTO chat_channel_members (channel_id, member_id, joined_at)
  SELECT v_channel, e.value, now() FROM jsonb_each_text(p_members) e
  WHERE EXISTS (SELECT 1 FROM members m WHERE m.id = e.value)
  ON CONFLICT (channel_id, member_id) DO UPDATE SET left_at = NULL;

  RETURN jsonb_build_object('channel', v_channel);
END;
$function$;

REVOKE ALL ON FUNCTION public.project_slack_dm(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_slack_dm(text, jsonb) TO service_role;
COMMENT ON FUNCTION public.project_slack_dm(text, jsonb) IS
  'Service role: projects one Slack 1:1 DM (bronze.slack_channels.is_im) and its Hub-member participants into chat_channels and chat_channel_members.';

INSERT INTO feature_flags (feature_key, enabled_globally)
VALUES ('slack_dm_bridge', false)
ON CONFLICT (feature_key) DO NOTHING;

-- Same function as 20270422000000_chat_close_unbacked_memberships.sql, except that a 1:1 DM is kind 'dm':
-- private, restricted and unnamed.
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
