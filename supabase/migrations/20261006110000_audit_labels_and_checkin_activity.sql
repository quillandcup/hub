-- Readable audit rows + check-in/check-out activity.
--
-- * audit_log.entity_label: what the record is called (a project's title, a book's title, an
--   award's name...), filled by the trigger, so an UPDATE row ("moved writing project to
--   revising") can still name its project. The feed returns it as `description` for audit rows.
-- * prickle_checkins.saved_via ('web' | 'slack') + a trigger that writes a member_activities row
--   when the check-in half (feelings coming in / need) or the check-out half (rating / feelings
--   after) first becomes answered. One row per half per prickle, never for later edits, and never
--   the answers themselves (they're private to the member): only who, which prickle, which
--   half and the channel. engagement_value is 0 so it doesn't move engagement scores.

ALTER TABLE audit_log ADD COLUMN entity_label TEXT;

ALTER TABLE prickle_checkins ADD COLUMN saved_via TEXT NOT NULL DEFAULT 'web' CHECK (saved_via IN ('web', 'slack'));
COMMENT ON COLUMN prickle_checkins.saved_via IS 'Where the latest save came from: the website or a Slack DM.';

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
    label     text;
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

    -- What the record is called, so a row can say which project/book/award it was about even when
    -- an UPDATE's delta carries only the changed fields.
    label := left(COALESCE(
        NULLIF(subject ->> 'title', ''), NULLIF(subject ->> 'name', ''),
        NULLIF(subject ->> 'alias', ''), NULLIF(subject ->> 'award_name', '')), 120);

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

    INSERT INTO audit_log (changed_by, actor_kind, acting_as_member_id, entity_type, entity_id, action, changes, member_id, entity_label)
    VALUES (uid, kind, current_acting_as_member_id(), TG_ARGV[0], array_to_string(pk_parts, ':'), lower(TG_OP), delta, mid, label);

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


CREATE OR REPLACE FUNCTION prickle_checkins_log_activity() RETURNS trigger AS $$
DECLARE
    half     text;
    type_name text;
    was_in   boolean := false;
    was_out  boolean := false;
    is_in    boolean := cardinality(NEW.feelings_before) > 0 OR NEW.need IS NOT NULL;
    is_out   boolean := NEW.session_rating IS NOT NULL OR cardinality(NEW.feelings_after) > 0;
BEGIN
    IF NEW.deleted_at IS NOT NULL THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.deleted_at IS NULL THEN
        was_in  := cardinality(OLD.feelings_before) > 0 OR OLD.need IS NOT NULL;
        was_out := OLD.session_rating IS NOT NULL OR cardinality(OLD.feelings_after) > 0;
    END IF;

    SELECT pt.name INTO type_name
      FROM prickles p LEFT JOIN prickle_types pt ON pt.id = p.type_id WHERE p.id = NEW.prickle_id;

    FOREACH half IN ARRAY ARRAY['checkin', 'checkout'] LOOP
        CONTINUE WHEN half = 'checkin' AND NOT (is_in AND NOT was_in);
        CONTINUE WHEN half = 'checkout' AND NOT (is_out AND NOT was_out);
        INSERT INTO member_activities (member_id, activity_type, activity_category, title, prickle_id,
                                       related_id, engagement_value, occurred_at, source, actor_kind, data)
        VALUES (NEW.member_id, 'prickle_' || half, 'event',
                CASE half WHEN 'checkin' THEN 'Checked in to ' ELSE 'Checked out of ' END || COALESCE(type_name, 'a prickle'),
                NEW.prickle_id, NEW.id::text, 0, now(), 'prickle_checkins', 'member',
                jsonb_build_object('via', NEW.saved_via));
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION prickle_checkins_log_activity() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER prickle_checkins_log_activity
    AFTER INSERT OR UPDATE ON prickle_checkins
    FOR EACH ROW EXECUTE FUNCTION prickle_checkins_log_activity();

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
            a.entity_label AS description,
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
