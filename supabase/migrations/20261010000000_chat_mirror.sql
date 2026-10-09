-- Chat mirror, phase 2 of docs/SLACK_BRIDGED_CHAT.md: Slack conversations projected from
-- Bronze into Local-layer chat_* tables, readable by members under the content/metadata
-- rules in "Access control". Read-only: only the service role writes.
--
--   chat_channels          one row per bridged conversation (public/private channel, group DM)
--   chat_channel_members   who is in each one ("subscribed"); left_at is a soft delete
--   chat_messages          metadata only (who, where, when, thread shape)
--   chat_message_contents  the content (body, blocks, attachments); split out because RLS is
--                          row-level and admins and members share the authenticated role
--   chat_reactions         emoji reactions, deleted_at soft delete
--
-- project_slack_chat_channels / project_slack_chat_messages rebuild them from Bronze (see
-- app/api/process/chat/route.ts). Re-runnable: UPSERT on the Slack keys, with Bronze's soft
-- deletes carried over, so ids (and /chat/<id> URLs) are stable.
--
-- Guarded so the migration can be re-run.

------------------------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_channels (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             TEXT NOT NULL CHECK (kind IN ('channel', 'dm', 'group_dm')),
  bridge_mode      TEXT NOT NULL DEFAULT 'bridged' CHECK (bridge_mode IN ('bridged', 'app_only')),
  slack_channel_id TEXT UNIQUE,
  visibility       TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
  restricted       BOOLEAN NOT NULL DEFAULT false,
  bridge_disabled  BOOLEAN NOT NULL DEFAULT false,
  bridge_status    TEXT NOT NULL DEFAULT 'ok' CHECK (bridge_status IN ('ok', 'disconnected')),
  name             TEXT,
  topic            TEXT,
  purpose          TEXT,
  archived_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Staff can't read direct messages or group DMs without break-glass.
  CONSTRAINT chat_channels_dms_restricted CHECK (kind = 'channel' OR restricted)
);

COMMENT ON TABLE public.chat_channels IS
  'LOCAL: a conversation in the Hub chat. Slack-origin rows are projected from bronze.slack_channels; restricted comes from restricted_slack_channels (and is always true for DMs and group DMs).';

CREATE TABLE IF NOT EXISTS public.chat_channel_members (
  channel_id   UUID NOT NULL REFERENCES public.chat_channels (id) ON DELETE CASCADE,
  member_id    UUID NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at      TIMESTAMPTZ,
  last_read_at TIMESTAMPTZ,
  muted        BOOLEAN NOT NULL DEFAULT false,
  source       TEXT NOT NULL DEFAULT 'slack' CHECK (source IN ('slack', 'app')),
  PRIMARY KEY (channel_id, member_id)
);

COMMENT ON TABLE public.chat_channel_members IS
  'LOCAL: members subscribed to a conversation (access for private ones). Projected from bronze.slack_channel_members for matched members; left_at is a soft delete.';

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id       UUID NOT NULL REFERENCES public.chat_channels (id) ON DELETE CASCADE,
  author_member_id UUID REFERENCES public.members (id) ON DELETE SET NULL,
  thread_root_id   UUID REFERENCES public.chat_messages (id) ON DELETE SET NULL,
  origin           TEXT NOT NULL DEFAULT 'slack' CHECK (origin IN ('app', 'slack')),
  slack_ts         TEXT,
  reply_count      INTEGER NOT NULL DEFAULT 0,
  last_reply_at    TIMESTAMPTZ,
  has_files        BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL,
  edited_at        TIMESTAMPTZ,
  deleted_at       TIMESTAMPTZ,
  UNIQUE (channel_id, slack_ts)
);

CREATE INDEX IF NOT EXISTS chat_messages_channel_created_idx ON public.chat_messages (channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_messages_thread_idx ON public.chat_messages (thread_root_id) WHERE thread_root_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_messages_author_idx ON public.chat_messages (author_member_id, created_at);

COMMENT ON TABLE public.chat_messages IS
  'LOCAL: message metadata only. Content is in chat_message_contents. author_member_id is null for Slack authors we cannot match (integrations, unmatched users).';

CREATE TABLE IF NOT EXISTS public.chat_message_contents (
  message_id    UUID PRIMARY KEY REFERENCES public.chat_messages (id) ON DELETE CASCADE,
  body          TEXT NOT NULL DEFAULT '',
  blocks        JSONB,
  attachments   JSONB,
  search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', body)) STORED
);

COMMENT ON TABLE public.chat_message_contents IS
  'LOCAL: what was written. Readable only where chat_can_read_content() says so; never for a deleted message.';

CREATE TABLE IF NOT EXISTS public.chat_reactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id       UUID NOT NULL REFERENCES public.chat_messages (id) ON DELETE CASCADE,
  member_id        UUID REFERENCES public.members (id) ON DELETE SET NULL,
  slack_user_id    TEXT,
  emoji            TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL,
  deleted_at       TIMESTAMPTZ,
  synced_to_slack  BOOLEAN NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_reactions_slack_user_key
  ON public.chat_reactions (message_id, emoji, slack_user_id) WHERE slack_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS chat_reactions_member_key
  ON public.chat_reactions (message_id, emoji, member_id) WHERE slack_user_id IS NULL;

COMMENT ON TABLE public.chat_reactions IS
  'LOCAL: emoji reactions. Slack-origin rows are keyed by slack_user_id (member_id is null when unmatched); deleted_at is a soft delete.';

-- Which member each Slack user is, as of the last full projection. The matching (alias, then
-- email, then name; lib/slack-matching.ts) lives in TypeScript, so the per-message projection
-- below reads its result from here instead of recomputing it for every webhook event.
CREATE TABLE IF NOT EXISTS public.chat_slack_authors (
  slack_user_id TEXT PRIMARY KEY,
  member_id     UUID NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.chat_slack_authors IS
  'LOCAL (derived): Slack user id -> member, rewritten by project_slack_chat_channels on every full projection. Service role only.';

ALTER TABLE public.chat_slack_authors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_slack_authors FROM anon, authenticated;
GRANT ALL ON public.chat_slack_authors TO service_role;

------------------------------------------------------------------------------------------------
-- Access control. "Visible" = metadata (the channel, its messages, members, reactions);
-- "content" = message text. Admins are not channel members, so they get metadata everywhere
-- and content only where the conversation is not restricted. Nobody reads a deleted
-- message's content through the API (break-glass will, later).
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_is_channel_member(p_channel_id UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM chat_channel_members cm
    WHERE cm.channel_id = p_channel_id
      AND cm.member_id = (SELECT current_member_id())
      AND cm.left_at IS NULL
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.chat_can_see_channel(p_channel_id UUID) RETURNS BOOLEAN AS $$
  SELECT (SELECT is_admin())
      OR EXISTS (
        SELECT 1 FROM chat_channels c
        WHERE c.id = p_channel_id
          AND (
            (c.visibility = 'public' AND (SELECT current_member_id()) IS NOT NULL)
            OR chat_is_channel_member(c.id)
          )
      );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.chat_can_read_content(p_channel_id UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM chat_channels c
    WHERE c.id = p_channel_id
      AND (
        chat_is_channel_member(c.id)
        OR (c.visibility = 'public' AND (SELECT current_member_id()) IS NOT NULL)
        OR (NOT c.restricted AND (SELECT is_admin()))
      )
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.chat_is_channel_member(UUID), public.chat_can_see_channel(UUID), public.chat_can_read_content(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_is_channel_member(UUID), public.chat_can_see_channel(UUID), public.chat_can_read_content(UUID)
  TO authenticated, service_role;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['chat_channels', 'chat_channel_members', 'chat_messages', 'chat_message_contents', 'chat_reactions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "See visible channels" ON public.chat_channels;
CREATE POLICY "See visible channels" ON public.chat_channels
  FOR SELECT TO authenticated USING (chat_can_see_channel(id));

DROP POLICY IF EXISTS "See members of visible channels" ON public.chat_channel_members;
CREATE POLICY "See members of visible channels" ON public.chat_channel_members
  FOR SELECT TO authenticated USING (chat_can_see_channel(channel_id));

DROP POLICY IF EXISTS "See messages of visible channels" ON public.chat_messages;
CREATE POLICY "See messages of visible channels" ON public.chat_messages
  FOR SELECT TO authenticated USING (chat_can_see_channel(channel_id));

DROP POLICY IF EXISTS "Read content of readable channels" ON public.chat_message_contents;
CREATE POLICY "Read content of readable channels" ON public.chat_message_contents
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM chat_messages m
      WHERE m.id = message_id
        AND m.deleted_at IS NULL
        AND chat_can_read_content(m.channel_id)
    )
  );

DROP POLICY IF EXISTS "See reactions of visible channels" ON public.chat_reactions;
CREATE POLICY "See reactions of visible channels" ON public.chat_reactions
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM chat_messages m WHERE m.id = message_id AND chat_can_see_channel(m.channel_id))
  );

------------------------------------------------------------------------------------------------
-- Restricting a channel takes effect on chat access at once (the projection also sets it).
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_chat_channel_restricted() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE chat_channels SET restricted = true WHERE slack_channel_id = NEW.channel_id;
    RETURN NEW;
  END IF;
  UPDATE chat_channels SET restricted = (kind <> 'channel')
  WHERE slack_channel_id = OLD.channel_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.sync_chat_channel_restricted() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_chat_channel_restricted ON public.restricted_slack_channels;
CREATE TRIGGER sync_chat_channel_restricted
  AFTER INSERT OR DELETE ON public.restricted_slack_channels
  FOR EACH ROW EXECUTE FUNCTION public.sync_chat_channel_restricted();

------------------------------------------------------------------------------------------------
-- Projection: channels and membership. Cheap (tens of channels), run with every message window.
-- user_member_map is { slack user id: member id } from lib/slack-matching.ts.
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.project_slack_chat_channels(user_member_map JSONB) RETURNS JSONB AS $$
DECLARE
  channel_count INTEGER;
  member_count INTEGER;
BEGIN
  -- The Slack user -> member map, kept for the per-message projection.
  INSERT INTO chat_slack_authors (slack_user_id, member_id)
  SELECT e.key, e.value::uuid
  FROM jsonb_each_text(user_member_map) e
  WHERE EXISTS (SELECT 1 FROM members m WHERE m.id = e.value::uuid)
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
    SELECT DISTINCT ON (cc.id, (user_member_map->>bm.user_id)::uuid)
      cc.id, (user_member_map->>bm.user_id)::uuid, bm.first_seen_at, bm.left_at
    FROM bronze.slack_channel_members bm
    JOIN chat_channels cc ON cc.slack_channel_id = bm.channel_id AND NOT cc.bridge_disabled
    WHERE user_member_map ? bm.user_id
      AND EXISTS (SELECT 1 FROM members m WHERE m.id = (user_member_map->>bm.user_id)::uuid)
    ORDER BY cc.id, (user_member_map->>bm.user_id)::uuid, bm.left_at NULLS FIRST
    ON CONFLICT (channel_id, member_id) DO UPDATE SET left_at = EXCLUDED.left_at
    RETURNING 1
  )
  SELECT count(*) INTO member_count FROM upserted;

  RETURN jsonb_build_object('channels', channel_count, 'members', member_count);
END;
$$ LANGUAGE plpgsql SET search_path = public;

------------------------------------------------------------------------------------------------
-- Projection: messages, contents, threads and reactions for one window of Bronze
-- (occurred_at in [from_date, to_date]). Bronze's soft deletes carry over; a message that
-- turns up again is un-deleted. Never deletes: a message gone from Bronze keeps its row.
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.project_slack_chat_messages(
  from_date TIMESTAMPTZ,
  to_date TIMESTAMPTZ,
  user_member_map JSONB
) RETURNS JSONB AS $$
DECLARE
  message_count INTEGER;
  reaction_count INTEGER;
BEGIN
  WITH upserted AS (
    INSERT INTO chat_messages (
      channel_id, author_member_id, origin, slack_ts, has_files, created_at, edited_at, deleted_at
    )
    SELECT
      cc.id,
      CASE WHEN user_member_map ? m.user_id
                AND EXISTS (SELECT 1 FROM members mm WHERE mm.id = (user_member_map->>m.user_id)::uuid)
           THEN (user_member_map->>m.user_id)::uuid END,
      'slack',
      m.message_ts,
      (m.files IS NOT NULL AND m.files <> 'null'::jsonb),
      m.occurred_at,
      m.edited_at,
      m.deleted_at
    FROM bronze.slack_messages m
    JOIN chat_channels cc ON cc.slack_channel_id = m.channel_id AND NOT cc.bridge_disabled
    WHERE m.occurred_at >= from_date AND m.occurred_at <= to_date
    ON CONFLICT (channel_id, slack_ts) DO UPDATE SET
      author_member_id = COALESCE(EXCLUDED.author_member_id, chat_messages.author_member_id),
      has_files        = EXCLUDED.has_files,
      edited_at        = EXCLUDED.edited_at,
      deleted_at       = EXCLUDED.deleted_at
    RETURNING 1
  )
  SELECT count(*) INTO message_count FROM upserted;

  INSERT INTO chat_message_contents (message_id, body, blocks, attachments)
  SELECT
    cm.id,
    COALESCE(m.text, ''),
    m.raw_payload->'blocks',
    m.raw_payload->'attachments'
  FROM bronze.slack_messages m
  JOIN chat_channels cc ON cc.slack_channel_id = m.channel_id AND NOT cc.bridge_disabled
  JOIN chat_messages cm ON cm.channel_id = cc.id AND cm.slack_ts = m.message_ts
  WHERE m.occurred_at >= from_date AND m.occurred_at <= to_date
  ON CONFLICT (message_id) DO UPDATE SET
    body        = EXCLUDED.body,
    blocks      = EXCLUDED.blocks,
    attachments = EXCLUDED.attachments;

  -- Replies point at their thread root (when we have it).
  UPDATE chat_messages r
  SET thread_root_id = root.id
  FROM bronze.slack_messages m, chat_channels cc, chat_messages root
  WHERE m.occurred_at >= from_date AND m.occurred_at <= to_date
    AND COALESCE(m.thread_ts, '') <> '' AND m.thread_ts <> m.message_ts
    AND cc.slack_channel_id = m.channel_id
    AND r.channel_id = cc.id AND r.slack_ts = m.message_ts
    AND root.channel_id = cc.id AND root.slack_ts = m.thread_ts
    AND r.thread_root_id IS DISTINCT FROM root.id;

  -- Reply counts for every root touched by this window, whichever window the root is in.
  UPDATE chat_messages root
  SET reply_count = s.n, last_reply_at = s.last_at
  FROM (
    SELECT t.thread_root_id AS id,
           count(*) FILTER (WHERE t.deleted_at IS NULL) AS n,
           max(t.created_at) FILTER (WHERE t.deleted_at IS NULL) AS last_at
    FROM chat_messages t
    WHERE t.thread_root_id IN (
      SELECT x.thread_root_id FROM chat_messages x
      WHERE x.thread_root_id IS NOT NULL AND x.created_at >= from_date AND x.created_at <= to_date
    )
    GROUP BY t.thread_root_id
  ) s
  WHERE root.id = s.id
    AND (root.reply_count IS DISTINCT FROM s.n OR root.last_reply_at IS DISTINCT FROM s.last_at);

  WITH upserted AS (
    INSERT INTO chat_reactions (message_id, member_id, slack_user_id, emoji, created_at, deleted_at)
    SELECT
      cm.id,
      CASE WHEN user_member_map ? r.user_id
                AND EXISTS (SELECT 1 FROM members mm WHERE mm.id = (user_member_map->>r.user_id)::uuid)
           THEN (user_member_map->>r.user_id)::uuid END,
      r.user_id,
      r.reaction,
      r.occurred_at,
      r.deleted_at
    FROM bronze.slack_reactions r
    JOIN chat_channels cc ON cc.slack_channel_id = r.channel_id AND NOT cc.bridge_disabled
    JOIN chat_messages cm ON cm.channel_id = cc.id AND cm.slack_ts = r.message_ts
    WHERE r.occurred_at >= from_date AND r.occurred_at <= to_date
    ON CONFLICT (message_id, emoji, slack_user_id) WHERE slack_user_id IS NOT NULL DO UPDATE SET
      member_id  = COALESCE(EXCLUDED.member_id, chat_reactions.member_id),
      deleted_at = EXCLUDED.deleted_at
    RETURNING 1
  )
  SELECT count(*) INTO reaction_count FROM upserted;

  RETURN jsonb_build_object('messages', message_count, 'reactions', reaction_count);
END;
$$ LANGUAGE plpgsql SET search_path = public;

------------------------------------------------------------------------------------------------
-- Projection: ONE message (the webhook's path). Cost does not depend on how busy the
-- workspace is: a few indexed lookups, whatever happened in the last day. Authors come from
-- chat_slack_authors (an unmatched or brand-new user stays null until the next full
-- projection, which fills it in), and a channel it doesn't know yet is left to that run too.
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.project_slack_chat_message(p_channel_id TEXT, p_message_ts TEXT) RETURNS JSONB AS $$
DECLARE
  v_channel UUID;
  v_message UUID;
  v_thread_ts TEXT;
  v_root UUID;
BEGIN
  SELECT id INTO v_channel FROM chat_channels WHERE slack_channel_id = p_channel_id AND NOT bridge_disabled;
  IF v_channel IS NULL THEN
    RETURN jsonb_build_object('projected', false);
  END IF;

  INSERT INTO chat_messages (channel_id, author_member_id, origin, slack_ts, has_files, created_at, edited_at, deleted_at)
  SELECT v_channel, a.member_id, 'slack', m.message_ts,
         (m.files IS NOT NULL AND m.files <> 'null'::jsonb), m.occurred_at, m.edited_at, m.deleted_at
  FROM bronze.slack_messages m
  LEFT JOIN chat_slack_authors a ON a.slack_user_id = m.user_id
  WHERE m.channel_id = p_channel_id AND m.message_ts = p_message_ts
  ON CONFLICT (channel_id, slack_ts) DO UPDATE SET
    author_member_id = COALESCE(EXCLUDED.author_member_id, chat_messages.author_member_id),
    has_files        = EXCLUDED.has_files,
    edited_at        = EXCLUDED.edited_at,
    deleted_at       = EXCLUDED.deleted_at
  RETURNING id INTO v_message;

  -- Bronze doesn't have it (yet): nothing to project, and its reactions have no message to hang on.
  IF v_message IS NULL THEN
    RETURN jsonb_build_object('projected', false);
  END IF;

  INSERT INTO chat_message_contents (message_id, body, blocks, attachments)
  SELECT v_message, COALESCE(m.text, ''), m.raw_payload->'blocks', m.raw_payload->'attachments'
  FROM bronze.slack_messages m
  WHERE m.channel_id = p_channel_id AND m.message_ts = p_message_ts
  ON CONFLICT (message_id) DO UPDATE SET
    body = EXCLUDED.body, blocks = EXCLUDED.blocks, attachments = EXCLUDED.attachments;

  -- Threads: a reply points at its root; a root adopts replies that arrived before it.
  SELECT NULLIF(m.thread_ts, '') INTO v_thread_ts
  FROM bronze.slack_messages m WHERE m.channel_id = p_channel_id AND m.message_ts = p_message_ts;

  IF v_thread_ts IS NOT NULL AND v_thread_ts <> p_message_ts THEN
    SELECT id INTO v_root FROM chat_messages WHERE channel_id = v_channel AND slack_ts = v_thread_ts;
    UPDATE chat_messages SET thread_root_id = v_root WHERE id = v_message AND thread_root_id IS DISTINCT FROM v_root;
  ELSE
    v_root := v_message;
    UPDATE chat_messages r SET thread_root_id = v_message
    FROM bronze.slack_messages b
    WHERE b.channel_id = p_channel_id AND b.thread_ts = p_message_ts AND b.message_ts <> b.thread_ts
      AND r.channel_id = v_channel AND r.slack_ts = b.message_ts AND r.thread_root_id IS DISTINCT FROM v_message;
  END IF;

  IF v_root IS NOT NULL THEN
    UPDATE chat_messages root
    SET reply_count = s.n, last_reply_at = s.last_at
    FROM (
      SELECT count(*) FILTER (WHERE t.deleted_at IS NULL) AS n,
             max(t.created_at) FILTER (WHERE t.deleted_at IS NULL) AS last_at
      FROM chat_messages t WHERE t.thread_root_id = v_root
    ) s
    WHERE root.id = v_root AND (root.reply_count IS DISTINCT FROM s.n OR root.last_reply_at IS DISTINCT FROM s.last_at);
  END IF;

  INSERT INTO chat_reactions (message_id, member_id, slack_user_id, emoji, created_at, deleted_at)
  SELECT v_message, a.member_id, r.user_id, r.reaction, r.occurred_at, r.deleted_at
  FROM bronze.slack_reactions r
  LEFT JOIN chat_slack_authors a ON a.slack_user_id = r.user_id
  WHERE r.channel_id = p_channel_id AND r.message_ts = p_message_ts
  ON CONFLICT (message_id, emoji, slack_user_id) WHERE slack_user_id IS NOT NULL DO UPDATE SET
    member_id  = COALESCE(EXCLUDED.member_id, chat_reactions.member_id),
    deleted_at = EXCLUDED.deleted_at;

  RETURN jsonb_build_object('projected', true);
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- They read message content: service role only.
REVOKE ALL ON FUNCTION public.project_slack_chat_message(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_slack_chat_message(TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.project_slack_chat_channels(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.project_slack_chat_messages(TIMESTAMPTZ, TIMESTAMPTZ, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_slack_chat_channels(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.project_slack_chat_messages(TIMESTAMPTZ, TIMESTAMPTZ, JSONB) TO service_role;
