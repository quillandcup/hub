-- Capture what members do, not just what staff change.
--
-- The generic audit trigger already records the right actor (auth.uid()) and the sudo
-- "acting as" member for any write made through the user's own client, so covering member
-- actions is a matter of attaching it to the member-authored tables:
--   projects, goals, starting balances, progress edits/deletes, bookshelf, commitments
--   (cancelled), calendar link + hand-added calendar items, Wheel of Wonder spins,
--   "Ask me about" topics.
-- Left out on purpose (private to the member): notes, check-ins, onboarding, notification
-- preferences, writing-prompt dismissals. Progress and commitment *creation* are already
-- mirrored into member_activities, so those tables only audit UPDATE/DELETE.
--
-- Also here:
--   * audit_row_change() takes an optional third trigger argument: columns to redact
--     (changed, but never stored). Used for the calendar feed token.
--   * wheel_of_wonder_matches has no member_id; the spinner is the subject.
--   * calendar_feed_tokens.first_fetched_at: set once, by the feed route, the first time a
--     calendar app fetches the link, so "installed it in their calendar" is observable.
--   * The activity feed treats a member's own edits as audit-worthy only in sudo (like
--     member_activities already does); the Audit view stays about staff/system/sudo, and
--     "Everything" shows the rest.

ALTER TABLE calendar_feed_tokens ADD COLUMN first_fetched_at TIMESTAMPTZ;
COMMENT ON COLUMN calendar_feed_tokens.first_fetched_at IS
  'When a calendar app first fetched the feed for the current token (reset when the link is regenerated).';

-- Generic trigger. Args: TG_ARGV[0] = entity_type, TG_ARGV[1] = comma-separated
-- primary key column(s) used to build entity_id.
CREATE OR REPLACE FUNCTION audit_row_change() RETURNS trigger AS $$
DECLARE
    new_row   jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
    old_row   jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
    subject   jsonb := COALESCE(new_row, old_row);
    delta     jsonb := '{}'::jsonb;
    col       text;
    pk_col    text;
    pk_parts  text[] := '{}';
    uid       uuid := auth.uid();
    kind      text;
    mid       uuid;
    -- Columns named in the third trigger argument are logged as changed but
    -- never with their value (secrets such as a calendar feed token).
    redact    text[] := COALESCE(string_to_array(TG_ARGV[2], ','), '{}');
BEGIN
    FOR col IN SELECT jsonb_object_keys(subject) LOOP
        -- Bookkeeping timestamps change on every write and say nothing.
        CONTINUE WHEN col IN ('updated_at', 'created_at');
        IF TG_OP = 'UPDATE' AND (old_row -> col) IS NOT DISTINCT FROM (new_row -> col) THEN
            CONTINUE;
        END IF;
        IF col = ANY (redact) THEN
            delta := delta || jsonb_build_object(
                col, jsonb_build_object(
                    'old', CASE WHEN old_row IS NULL THEN NULL ELSE '"[redacted]"'::jsonb END,
                    'new', CASE WHEN new_row IS NULL THEN NULL ELSE '"[redacted]"'::jsonb END)
            );
        ELSE
            delta := delta || jsonb_build_object(
                col, jsonb_build_object('old', old_row -> col, 'new', new_row -> col)
            );
        END IF;
    END LOOP;

    -- An UPDATE that only touched bookkeeping columns is not worth a row.
    IF TG_OP = 'UPDATE' AND delta = '{}'::jsonb THEN
        RETURN NEW;
    END IF;

    FOREACH pk_col IN ARRAY string_to_array(TG_ARGV[1], ',') LOOP
        pk_parts := pk_parts || COALESCE(subject ->> trim(pk_col), '');
    END LOOP;

    IF TG_ARGV[0] = 'member' THEN
        mid := (subject ->> 'id')::uuid;
    ELSIF subject ? 'member_id' THEN
        mid := (subject ->> 'member_id')::uuid;
    ELSIF subject ? 'spinner_member_id' THEN
        mid := (subject ->> 'spinner_member_id')::uuid;
    END IF;

    kind := CASE
        WHEN uid IS NULL THEN 'system'
        WHEN EXISTS (
            SELECT 1 FROM user_profiles WHERE id = uid AND role IN ('admin', 'assistant')
        ) THEN 'staff'
        ELSE 'member'
    END;

    INSERT INTO audit_log (changed_by, actor_kind, acting_as_member_id, entity_type, entity_id, action, changes, member_id)
    VALUES (uid, kind, current_acting_as_member_id(), TG_ARGV[0], array_to_string(pk_parts, ':'), lower(TG_OP), delta, mid);

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;



DO $$
DECLARE
    spec record;
BEGIN
    FOR spec IN
        SELECT * FROM (VALUES
            ('writing_projects',                    'writing_project',           'id',                'AFTER INSERT OR UPDATE OR DELETE', NULL),
            ('writing_goals',                       'writing_goal',              'id',                'AFTER INSERT OR UPDATE OR DELETE', NULL),
            ('writing_project_starting_balances',   'writing_starting_balance',  'project_id,measure','AFTER INSERT OR UPDATE OR DELETE', NULL),
            ('writing_progress_entries',            'writing_progress_entry',    'id',                'AFTER UPDATE OR DELETE',          NULL),
            ('member_books',                        'member_book',               'id',                'AFTER INSERT OR UPDATE OR DELETE', NULL),
            ('prickle_commitments',                 'prickle_commitment',        'id',                'AFTER UPDATE OR DELETE',          NULL),
            ('calendar_feed_tokens',                'calendar_feed',             'member_id',         'AFTER INSERT OR UPDATE OR DELETE', 'token'),
            ('calendar_feed_items',                 'calendar_feed_item',        'id',                'AFTER INSERT OR UPDATE OR DELETE', NULL),
            ('wheel_of_wonder_matches',             'wheel_of_wonder_match',     'id',                'AFTER INSERT OR UPDATE OR DELETE', NULL),
            ('member_ask_me_about',                 'member_ask_me_about',       'member_id',         'AFTER INSERT OR UPDATE OR DELETE', NULL)
        ) AS t(tbl, entity, pk, events, redact)
    LOOP
        EXECUTE format(
            'CREATE TRIGGER audit_row_change %s ON %I
             FOR EACH ROW EXECUTE FUNCTION audit_row_change(%L, %L, %L)',
            spec.events, spec.tbl, spec.entity, spec.pk, COALESCE(spec.redact, '')
        );
    END LOOP;
END $$;

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
    p_session_gap_minutes integer DEFAULT 30
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
            NULL::text AS description,
            'audit_log'::text AS source,
            a.changes AS data
        FROM audit_log a
        WHERE (p_kinds IS NULL OR 'audit' = ANY (p_kinds))
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
        WHERE (p_kinds IS NULL OR 'activity' = ANY (p_kinds))
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
        WHERE (p_kinds IS NULL OR 'session' = ANY (p_kinds))
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
    p_session_gap_minutes integer DEFAULT 30
) RETURNS integer AS $$
    SELECT CASE WHEN NOT is_admin() THEN 0 ELSE (
        (SELECT COUNT(*) FROM audit_log a
          WHERE (p_kinds IS NULL OR 'audit' = ANY (p_kinds))
            AND a.occurred_at >= p_from AND a.occurred_at < p_to
            AND (p_actor_user_id IS NULL OR a.changed_by = p_actor_user_id)
            AND (p_member_id IS NULL OR a.member_id = p_member_id OR a.acting_as_member_id = p_member_id)
            AND (NOT p_sudo_only OR a.acting_as_member_id IS NOT NULL)
            AND (NOT p_audit_only OR (a.actor_kind <> 'member' OR a.acting_as_member_id IS NOT NULL)))
        +
        (SELECT COUNT(*) FROM member_activities m
          WHERE (p_kinds IS NULL OR 'activity' = ANY (p_kinds))
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
            WHERE (p_kinds IS NULL OR 'session' = ANY (p_kinds))
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
