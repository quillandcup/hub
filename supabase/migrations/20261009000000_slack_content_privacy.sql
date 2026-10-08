-- Slack content privacy (docs/SLACK_BRIDGED_CHAT.md, "Access control").
--
-- The boundary is content vs metadata. What people wrote (message text, files,
-- raw payloads) is no longer readable by admins straight from Bronze; who posted
-- where and when still is.
--
-- 1. bronze.slack_messages and bronze.slack_files: service role only. Admins read
--    bronze.slack_messages_meta, which has no content columns.
-- 2. raw_payload on the other Slack tables: service role only (column grants).
-- 3. public.restricted_slack_channels (Local): channels whose content staff can't
--    read. Audited, and restricting one clears the text already copied into
--    member_activities.
-- 4. reprocess_slack_activities_atomic: no message text for restricted channels,
--    and callable by the service role only (it reads message content).
-- 5. get_activity_feed / count_activity_feed: p_entity_types, for the Activity
--    Log's Privacy view (restriction changes now, break-glass grants and reads
--    when they exist).
--
-- Guarded so the migration can be re-run.

------------------------------------------------------------------------------------------------
-- 1. Message content: service role only, plus a metadata view for admins.
------------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can read slack_messages" ON bronze.slack_messages;
DROP POLICY IF EXISTS "Admins can insert slack_messages" ON bronze.slack_messages;
DROP POLICY IF EXISTS "Admins can update slack_messages" ON bronze.slack_messages;
DROP POLICY IF EXISTS "Admins can delete slack_messages" ON bronze.slack_messages;
REVOKE ALL ON bronze.slack_messages FROM anon, authenticated;
GRANT ALL ON bronze.slack_messages TO service_role;

DROP POLICY IF EXISTS "Admins can read slack_files" ON bronze.slack_files;
REVOKE ALL ON bronze.slack_files FROM anon, authenticated;
GRANT ALL ON bronze.slack_files TO service_role;

COMMENT ON TABLE bronze.slack_messages IS
  'BRONZE: Slack messages (UPSERT by channel_id, message_ts; deleted_at is a soft delete). Holds content, so service role only: admins read bronze.slack_messages_meta.';

-- Not security_invoker: the view runs as its owner so it can read the table API
-- users can't, and gates rows itself. No text, files or raw_payload.
CREATE OR REPLACE VIEW bronze.slack_messages_meta AS
  SELECT
    m.id,
    m.message_ts,
    m.channel_id,
    m.channel_name,
    m.channel_type,
    m.user_id,
    m.user_email,
    m.user_name,
    m.message_type,
    m.thread_ts,
    m.reply_count,
    m.reply_users_count,
    m.occurred_at,
    m.edited_at,
    m.deleted_at,
    (m.files IS NOT NULL AND m.files <> 'null'::jsonb) AS has_files,
    m.imported_at
  FROM bronze.slack_messages m
  WHERE (SELECT public.is_admin()) OR (SELECT auth.role()) = 'service_role';

COMMENT ON VIEW bronze.slack_messages_meta IS
  'Slack messages without their content (who, where, when, thread shape). Admin-readable; the text lives in bronze.slack_messages, service role only.';

REVOKE ALL ON bronze.slack_messages_meta FROM anon, authenticated;
GRANT SELECT ON bronze.slack_messages_meta TO authenticated, service_role;

------------------------------------------------------------------------------------------------
-- 2. raw_payload elsewhere: service role only. Admins keep every other column.
--    A column added to one of these tables later needs its own
--    GRANT SELECT (col) ... TO authenticated (slack_content_privacy.test.sql
--    fails if one is missed).
------------------------------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
  cols TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['slack_users', 'slack_channels', 'slack_reactions', 'slack_channel_member_events'] LOOP
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
    FROM information_schema.columns
    WHERE table_schema = 'bronze' AND table_name = t AND column_name <> 'raw_payload';

    EXECUTE format('REVOKE SELECT ON bronze.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT (%s) ON bronze.%I TO authenticated', cols, t);
  END LOOP;
END $$;

------------------------------------------------------------------------------------------------
-- 3. Restricted channels (Local). A row = staff can't read this channel's content.
--    Direct messages and group DMs are always restricted and need no row.
------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.restricted_slack_channels (
  channel_id    TEXT PRIMARY KEY,
  name          TEXT,
  reason        TEXT,
  restricted_by UUID DEFAULT auth.uid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.restricted_slack_channels IS
  'LOCAL: Slack channels whose message content staff cannot read without break-glass. A row means restricted; deleting it lifts the restriction. Every change is in audit_log.';
COMMENT ON COLUMN public.restricted_slack_channels.name IS
  'The channel''s name when it was restricted, so the audit log can say which channel.';

ALTER TABLE public.restricted_slack_channels ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.restricted_slack_channels FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.restricted_slack_channels TO authenticated;
GRANT ALL ON public.restricted_slack_channels TO service_role;

DROP POLICY IF EXISTS "Admins can read restricted_slack_channels" ON public.restricted_slack_channels;
CREATE POLICY "Admins can read restricted_slack_channels" ON public.restricted_slack_channels
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can insert restricted_slack_channels" ON public.restricted_slack_channels;
CREATE POLICY "Admins can insert restricted_slack_channels" ON public.restricted_slack_channels
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete restricted_slack_channels" ON public.restricted_slack_channels;
CREATE POLICY "Admins can delete restricted_slack_channels" ON public.restricted_slack_channels
  FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

DROP TRIGGER IF EXISTS audit_row_change ON public.restricted_slack_channels;
CREATE TRIGGER audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON public.restricted_slack_channels
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('restricted_slack_channel', 'channel_id');

-- Restricting a channel takes effect on what was already copied, however old:
-- the Slack activity rebuild only rewrites the range it is asked for.
CREATE OR REPLACE FUNCTION public.scrub_restricted_slack_channel_activities() RETURNS trigger AS $$
BEGIN
  UPDATE member_activities
  SET description = NULL
  WHERE source = 'slack'
    AND description IS NOT NULL
    AND data->>'channel_id' = NEW.channel_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.scrub_restricted_slack_channel_activities() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS scrub_restricted_slack_channel_activities ON public.restricted_slack_channels;
CREATE TRIGGER scrub_restricted_slack_channel_activities
  AFTER INSERT ON public.restricted_slack_channels
  FOR EACH ROW EXECUTE FUNCTION public.scrub_restricted_slack_channel_activities();

------------------------------------------------------------------------------------------------
-- 4. Slack activity rebuild: no message text for restricted channels. Identical to
--    20261007034100_slack_soft_deletes_use_deleted_at.sql otherwise. It reads
--    message content, so only the service role may call it now.
------------------------------------------------------------------------------------------------
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
      CASE WHEN m.conversation_type IN ('mpim', 'im') OR m.restricted THEN NULL
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

------------------------------------------------------------------------------------------------
-- 5. Activity feed: p_entity_types narrows to audit rows about those entities
--    (member activity and page visits have no entity, so they drop out). Otherwise
--    identical to 20261006110000 (get) and 20261006100000 (count). The old
--    signatures are dropped: a second overload would make the RPC ambiguous.
------------------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS get_activity_feed(boolean, text[], uuid, uuid, boolean, timestamptz, timestamptz, integer, integer, integer);
DROP FUNCTION IF EXISTS count_activity_feed(boolean, text[], uuid, uuid, boolean, timestamptz, timestamptz, integer);

CREATE OR REPLACE FUNCTION get_activity_feed(
    p_audit_only    boolean     DEFAULT false,
    p_kinds         text[]      DEFAULT NULL,   -- subset of {audit, activity, session}
    p_actor_user_id uuid        DEFAULT NULL,
    p_member_id     uuid        DEFAULT NULL,
    p_sudo_only     boolean     DEFAULT false,
    p_from          timestamptz DEFAULT now() - interval '30 days',
    p_to            timestamptz DEFAULT now() + interval '1 minute',
    p_offset        integer     DEFAULT 0,
    p_limit         integer     DEFAULT 50,
    p_session_gap_minutes integer DEFAULT 30,
    p_entity_types  text[]      DEFAULT NULL    -- audit rows about these entity types only
) RETURNS TABLE (
    event_id       text,
    kind           text,
    occurred_at    timestamptz,
    is_audit       boolean,
    actor_user_id  uuid,
    actor_kind     text,
    actor_label    text,
    member_id      uuid,
    member_name    text,
    acting_as_member_id   uuid,
    acting_as_member_name text,
    event_type     text,
    entity_type    text,
    entity_id      text,
    title          text,
    description    text,
    source         text,
    data           jsonb
) AS $$
    WITH
    audit_rows AS (
        SELECT
            'audit:' || a.id AS event_id,
            'audit'::text AS kind,
            a.occurred_at,
            (a.actor_kind <> 'member' OR a.acting_as_member_id IS NOT NULL) AS is_audit,
            a.changed_by AS actor_user_id,
            a.actor_kind,
            a.member_id,
            a.acting_as_member_id,
            a.action AS event_type,
            a.entity_type,
            a.entity_id,
            a.comment AS title,
            a.entity_label AS description,
            'audit_log'::text AS source,
            a.changes AS data
        FROM audit_log a
        WHERE (p_kinds IS NULL OR 'audit' = ANY (p_kinds))
          AND (p_entity_types IS NULL OR a.entity_type = ANY (p_entity_types))
          AND a.occurred_at >= p_from AND a.occurred_at < p_to
          AND (p_actor_user_id IS NULL OR a.changed_by = p_actor_user_id)
          AND (p_member_id IS NULL OR a.member_id = p_member_id OR a.acting_as_member_id = p_member_id)
          AND (NOT p_sudo_only OR a.acting_as_member_id IS NOT NULL)
          AND (NOT p_audit_only OR (a.actor_kind <> 'member' OR a.acting_as_member_id IS NOT NULL))
        ORDER BY a.occurred_at DESC, a.id DESC
        LIMIT p_offset + p_limit
    ),
    activity_rows AS (
        SELECT
            'activity:' || m.id AS event_id,
            'activity'::text AS kind,
            m.occurred_at,
            (m.actor_kind = 'staff' OR m.acting_as_member_id IS NOT NULL) AS is_audit,
            m.actor_user_id,
            m.actor_kind,
            m.member_id,
            m.acting_as_member_id,
            m.activity_type AS event_type,
            NULL::text AS entity_type,
            NULL::text AS entity_id,
            m.title,
            m.description,
            m.source,
            m.data
        FROM member_activities m
        WHERE p_entity_types IS NULL AND (p_kinds IS NULL OR 'activity' = ANY (p_kinds))
          AND m.occurred_at >= p_from AND m.occurred_at < p_to
          AND (p_actor_user_id IS NULL OR m.actor_user_id = p_actor_user_id
               OR (m.actor_kind = 'member' AND m.member_id IN (
                      SELECT mm.id FROM members mm WHERE mm.user_id = p_actor_user_id)))
          AND (p_member_id IS NULL OR m.member_id = p_member_id OR m.acting_as_member_id = p_member_id)
          AND (NOT p_sudo_only OR m.acting_as_member_id IS NOT NULL)
          AND (NOT p_audit_only OR m.actor_kind = 'staff' OR m.acting_as_member_id IS NOT NULL)
        ORDER BY m.occurred_at DESC, m.id DESC
        LIMIT p_offset + p_limit
    ),
    gapped AS (
        SELECT
            e.user_id, e.acting_as_member_id, e.path, e.is_page, e.created_at,
            e.created_at - LAG(e.created_at) OVER (
                PARTITION BY e.user_id, e.acting_as_member_id ORDER BY e.created_at
            ) AS gap
        FROM access_events e
        WHERE p_entity_types IS NULL AND (p_kinds IS NULL OR 'session' = ANY (p_kinds))
          AND e.created_at >= p_from AND e.created_at < p_to
          AND (NOT p_audit_only OR e.acting_as_member_id IS NOT NULL)
          AND (NOT p_sudo_only OR e.acting_as_member_id IS NOT NULL)
          AND (p_actor_user_id IS NULL OR e.user_id = p_actor_user_id)
          AND (p_member_id IS NULL
               OR e.acting_as_member_id = p_member_id
               OR (e.acting_as_member_id IS NULL
                   AND e.user_id = (SELECT mm.user_id FROM members mm WHERE mm.id = p_member_id)))
    ),
    numbered AS (
        SELECT
            g.*,
            COUNT(*) FILTER (
                WHERE g.gap IS NULL OR g.gap > make_interval(mins => p_session_gap_minutes)
            ) OVER (PARTITION BY g.user_id, g.acting_as_member_id ORDER BY g.created_at) AS session_num
        FROM gapped g
    ),
    session_rows AS (
        SELECT
            'session:' || n.user_id || ':' || COALESCE(n.acting_as_member_id::text, '') || ':' || MIN(n.created_at) AS event_id,
            'session'::text AS kind,
            MAX(n.created_at) AS occurred_at,
            (n.acting_as_member_id IS NOT NULL) AS is_audit,
            n.user_id AS actor_user_id,
            -- Staff browsing as themselves are staff; everyone else is a member.
            CASE WHEN EXISTS (
                SELECT 1 FROM user_profiles vp WHERE vp.id = n.user_id AND vp.role IN ('admin', 'assistant')
            ) THEN 'staff' ELSE 'member' END AS actor_kind,
            NULL::uuid AS member_id,
            n.acting_as_member_id,
            'visit'::text AS event_type,
            NULL::text AS entity_type,
            NULL::text AS entity_id,
            NULL::text AS title,
            NULL::text AS description,
            'access_events'::text AS source,
            jsonb_build_object(
                'started_at', MIN(n.created_at),
                'ended_at', MAX(n.created_at),
                'event_count', COUNT(*),
                'pages', COALESCE(jsonb_agg(n.path ORDER BY n.created_at) FILTER (WHERE n.is_page), '[]'::jsonb)
            ) AS data
        FROM numbered n
        GROUP BY n.user_id, n.acting_as_member_id, n.session_num
        ORDER BY MAX(n.created_at) DESC, n.user_id
        LIMIT p_offset + p_limit
    ),
    combined AS (
        SELECT * FROM audit_rows
        UNION ALL SELECT * FROM activity_rows
        UNION ALL SELECT * FROM session_rows
    ),
    resolved AS (
        SELECT
            c.*,
            -- A visit has no member_id of its own: it's about the member being
            -- viewed as (sudo), else the visiting user's own member record.
            CASE WHEN c.kind = 'session'
                 THEN COALESCE(c.acting_as_member_id, (SELECT sm.id FROM members sm WHERE sm.user_id = c.actor_user_id))
                 ELSE c.member_id
            END AS subject_member_id
        FROM combined c
    )
    SELECT
        r.event_id, r.kind, r.occurred_at, r.is_audit, r.actor_user_id, r.actor_kind,
        -- Member-actor rows (e.g. Slack imports) carry no user id: the
        -- subject is the actor.
        COALESCE(am.name, up.email, CASE WHEN r.actor_kind = 'member' THEN mem.name END) AS actor_label,
        r.subject_member_id AS member_id,
        mem.name AS member_name,
        r.acting_as_member_id,
        aam.name AS acting_as_member_name,
        r.event_type, r.entity_type, r.entity_id, r.title, r.description, r.source, r.data
    FROM resolved r
    LEFT JOIN user_profiles up ON up.id = r.actor_user_id
    LEFT JOIN members am ON am.user_id = r.actor_user_id
    LEFT JOIN members mem ON mem.id = r.subject_member_id
    LEFT JOIN members aam ON aam.id = r.acting_as_member_id
    WHERE (NOT p_audit_only OR r.is_audit)
      AND is_admin()
    ORDER BY r.occurred_at DESC, r.event_id DESC
    OFFSET p_offset
    LIMIT p_limit;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Total rows get_activity_feed() would return across all pages for the same
-- filters (visits counted as sessions), for the pager.
CREATE OR REPLACE FUNCTION count_activity_feed(
    p_audit_only    boolean     DEFAULT false,
    p_kinds         text[]      DEFAULT NULL,
    p_actor_user_id uuid        DEFAULT NULL,
    p_member_id     uuid        DEFAULT NULL,
    p_sudo_only     boolean     DEFAULT false,
    p_from          timestamptz DEFAULT now() - interval '30 days',
    p_to            timestamptz DEFAULT now() + interval '1 minute',
    p_session_gap_minutes integer DEFAULT 30,
    p_entity_types  text[]      DEFAULT NULL    -- audit rows about these entity types only
) RETURNS integer AS $$
    SELECT CASE WHEN NOT is_admin() THEN 0 ELSE (
        (SELECT COUNT(*) FROM audit_log a
          WHERE (p_kinds IS NULL OR 'audit' = ANY (p_kinds))
          AND (p_entity_types IS NULL OR a.entity_type = ANY (p_entity_types))
            AND a.occurred_at >= p_from AND a.occurred_at < p_to
            AND (p_actor_user_id IS NULL OR a.changed_by = p_actor_user_id)
            AND (p_member_id IS NULL OR a.member_id = p_member_id OR a.acting_as_member_id = p_member_id)
            AND (NOT p_sudo_only OR a.acting_as_member_id IS NOT NULL)
            AND (NOT p_audit_only OR (a.actor_kind <> 'member' OR a.acting_as_member_id IS NOT NULL)))
        +
        (SELECT COUNT(*) FROM member_activities m
          WHERE p_entity_types IS NULL AND (p_kinds IS NULL OR 'activity' = ANY (p_kinds))
            AND m.occurred_at >= p_from AND m.occurred_at < p_to
            AND (p_actor_user_id IS NULL OR m.actor_user_id = p_actor_user_id
                 OR (m.actor_kind = 'member' AND m.member_id IN (
                        SELECT mm.id FROM members mm WHERE mm.user_id = p_actor_user_id)))
            AND (p_member_id IS NULL OR m.member_id = p_member_id OR m.acting_as_member_id = p_member_id)
            AND (NOT p_sudo_only OR m.acting_as_member_id IS NOT NULL)
            AND (NOT p_audit_only OR m.actor_kind = 'staff' OR m.acting_as_member_id IS NOT NULL))
        +
        (SELECT COUNT(*) FROM (
            SELECT
                e.created_at - LAG(e.created_at) OVER (
                    PARTITION BY e.user_id, e.acting_as_member_id ORDER BY e.created_at
                ) AS gap
            FROM access_events e
            WHERE p_entity_types IS NULL AND (p_kinds IS NULL OR 'session' = ANY (p_kinds))
              AND e.created_at >= p_from AND e.created_at < p_to
              AND (NOT p_audit_only OR e.acting_as_member_id IS NOT NULL)
              AND (NOT p_sudo_only OR e.acting_as_member_id IS NOT NULL)
              AND (p_actor_user_id IS NULL OR e.user_id = p_actor_user_id)
              AND (p_member_id IS NULL
                   OR e.acting_as_member_id = p_member_id
                   OR (e.acting_as_member_id IS NULL
                       AND e.user_id = (SELECT mm.user_id FROM members mm WHERE mm.id = p_member_id)))
         ) s
         WHERE s.gap IS NULL OR s.gap > make_interval(mins => p_session_gap_minutes))
    )::integer END;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION get_activity_feed(boolean, text[], uuid, uuid, boolean, timestamptz, timestamptz, integer, integer, integer, text[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_activity_feed(boolean, text[], uuid, uuid, boolean, timestamptz, timestamptz, integer, integer, integer, text[])
  TO authenticated;
REVOKE EXECUTE ON FUNCTION count_activity_feed(boolean, text[], uuid, uuid, boolean, timestamptz, timestamptz, integer, text[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION count_activity_feed(boolean, text[], uuid, uuid, boolean, timestamptz, timestamptz, integer, text[])
  TO authenticated;
