-- audit_log: who changed which resource, and what changed. Local layer
-- (append-only, not reprocessed). See docs/ACTIVITY_AND_AUDIT_LOG.md.
--
-- Written only by the audit_row_change() trigger below, which is attached per
-- audited table, so every write path (API route, server action, cron, SQL
-- editor) is captured. The actor is auth.uid() -- PostgREST sets it from the
-- caller's JWT per request -- so writes made through the acting user's own
-- client are attributed to them; service-role writes (pipelines, cron) have no
-- auth.uid() and are recorded as actor_kind = 'system'.
--
-- Sudo ("view as member"): auth.uid() stays the real admin, so the admin is
-- the actor, and the member they were acting as goes in acting_as_member_id.
-- Both are recorded. The app forwards the (HMAC-verified) sudo cookie as the
-- `X-Acting-As: <admin user id>:<member id>` request header on its Supabase
-- client, which PostgREST exposes to triggers as request.headers; see
-- current_acting_as_member_id().
CREATE TABLE audit_log (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at   timestamptz NOT NULL DEFAULT now(),
    -- Deliberately no FK: history must outlive a deleted user or member.
    changed_by    uuid,
    actor_kind    text NOT NULL CHECK (actor_kind IN ('member', 'staff', 'system')),
    -- The member an admin was viewing as (sudo) when they made this change.
    acting_as_member_id uuid,
    -- Model-level names ('member', 'prickle_type'), not raw table names, so the
    -- vocabulary survives table renames.
    entity_type   text NOT NULL,
    entity_id     text NOT NULL,
    action        text NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
    -- Delta only: {"status": {"old": "lead", "new": "active"}}. For insert the
    -- old side is null; for delete the new side is null.
    changes       jsonb NOT NULL,
    -- The CRM person this row is about, when there is one (members.id, or the
    -- row's member_id column). Lets the member timeline merge audit rows in.
    member_id     uuid,
    comment       text
);

COMMENT ON TABLE audit_log IS 'Per-field change history of audited resources, written by audit_row_change() triggers. Admin-read only.';

CREATE INDEX audit_log_occurred_idx ON audit_log (occurred_at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_log_changed_by_idx ON audit_log (changed_by, occurred_at DESC);
CREATE INDEX audit_log_member_idx ON audit_log (member_id, occurred_at DESC) WHERE member_id IS NOT NULL;
CREATE INDEX audit_log_acting_as_idx ON audit_log (acting_as_member_id, occurred_at DESC) WHERE acting_as_member_id IS NOT NULL;

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- No INSERT/UPDATE/DELETE policies: only the SECURITY DEFINER trigger writes,
-- and rows are never edited.
CREATE POLICY "Admins can view audit_log"
    ON audit_log FOR SELECT
    USING ((SELECT is_admin()));

-- Sudo columns on the other two logs, so "who did this, as whom" is recorded
-- the same way everywhere.
ALTER TABLE access_events ADD COLUMN acting_as_member_id uuid;
ALTER TABLE member_activities ADD COLUMN acting_as_member_id uuid;
COMMENT ON COLUMN access_events.acting_as_member_id IS 'The member an admin was viewing as (sudo) for this request; user_id is still the real admin.';
COMMENT ON COLUMN member_activities.acting_as_member_id IS 'Set when an admin in sudo mode caused this row; actor_user_id is then the real admin.';

CREATE INDEX access_events_acting_as_idx ON access_events (acting_as_member_id, created_at DESC) WHERE acting_as_member_id IS NOT NULL;
CREATE INDEX member_activities_acting_as_idx ON member_activities (acting_as_member_id, occurred_at DESC) WHERE acting_as_member_id IS NOT NULL;

-- Access events are logged from the proxy with the user's own session, so a
-- user may only claim acting_as_member_id if they're an admin.
DROP POLICY "Users can log their own access events" ON access_events;
CREATE POLICY "Users can log their own access events"
    ON access_events FOR INSERT
    WITH CHECK (user_id = auth.uid() AND (acting_as_member_id IS NULL OR (SELECT is_admin())));

-- The member the signed-in admin is currently viewing as, from the
-- `X-Acting-As: <admin user id>:<member id>` request header, or NULL. Honored
-- only when the header names the caller themself and the caller is an admin,
-- so a non-admin forging the header gets nothing recorded.
CREATE OR REPLACE FUNCTION current_acting_as_member_id() RETURNS uuid AS $$
DECLARE
    uid   uuid := auth.uid();
    hdr   text;
    parts text[];
BEGIN
    IF uid IS NULL THEN
        RETURN NULL;
    END IF;
    BEGIN
        hdr := (current_setting('request.headers', true)::jsonb) ->> 'x-acting-as';
    EXCEPTION WHEN others THEN
        RETURN NULL; -- no request context (SQL editor, cron) or not JSON
    END;
    IF hdr IS NULL THEN
        RETURN NULL;
    END IF;
    parts := string_to_array(hdr, ':');
    IF array_length(parts, 1) <> 2
       OR parts[1] <> uid::text
       OR parts[2] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN NULL;
    END IF;
    IF NOT is_admin() THEN
        RETURN NULL;
    END IF;
    RETURN parts[2]::uuid;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION current_acting_as_member_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION current_acting_as_member_id() TO authenticated;

-- Stamp sudo onto member_activities rows no matter which code inserts them:
-- acting_as_member_id comes only from the verified request header (never from
-- the caller's row), and the real admin becomes the row's actor_user_id.
CREATE OR REPLACE FUNCTION member_activities_stamp_sudo() RETURNS trigger AS $$
BEGIN
    NEW.acting_as_member_id := current_acting_as_member_id();
    IF NEW.acting_as_member_id IS NOT NULL THEN
        NEW.actor_user_id := COALESCE(NEW.actor_user_id, auth.uid());
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER member_activities_stamp_sudo
    BEFORE INSERT ON member_activities
    FOR EACH ROW EXECUTE FUNCTION member_activities_stamp_sudo();

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
BEGIN
    FOR col IN SELECT jsonb_object_keys(subject) LOOP
        -- Bookkeeping timestamps change on every write and say nothing.
        CONTINUE WHEN col IN ('updated_at', 'created_at');
        IF TG_OP = 'UPDATE' AND (old_row -> col) IS NOT DISTINCT FROM (new_row -> col) THEN
            CONTINUE;
        END IF;
        delta := delta || jsonb_build_object(
            col, jsonb_build_object('old', old_row -> col, 'new', new_row -> col)
        );
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

REVOKE EXECUTE ON FUNCTION audit_row_change() FROM PUBLIC, anon, authenticated;

-- Attach to everything staff can write. Member-authored private data
-- (notes, check-ins, onboarding, preferences, writing progress) and
-- append-only logs are deliberately left out; outreach_touches is covered by
-- its member_activities mirror (actor_kind = 'staff'), which the activity
-- feed treats as audit-worthy, so auditing it here would double every row.
DO $$
DECLARE
    spec record;
BEGIN
    FOR spec IN
        SELECT * FROM (VALUES
            ('members',                     'member',                   'id'),
            ('user_profiles',               'user_profile',             'id'),
            ('staff',                       'staff',                    'id'),
            ('member_status_overrides',     'member_status_override',   'id'),
            ('member_join_date_overrides',  'member_join_date_override','member_id'),
            ('member_profile_overrides',    'member_profile_override',  'member_id'),
            ('member_hiatus_history',       'member_hiatus',            'id'),
            ('member_name_aliases',         'member_name_alias',        'id'),
            ('member_email_aliases',        'member_email_alias',       'id'),
            ('ignored_zoom_names',          'ignored_zoom_name',        'id'),
            ('ignored_slack_users',         'ignored_slack_user',       'user_id'),
            ('ambiguous_zoom_names',        'ambiguous_zoom_name',      'id'),
            ('dismissed_duplicate_groups',  'dismissed_duplicate_group','group_key'),
            ('prickle_types',               'prickle_type',             'id'),
            ('prickle_schedules',           'prickle_schedule',         'id'),
            ('prickle_schedule_locks',      'prickle_schedule_lock',    'month'),
            ('prickle_host_vibes',          'prickle_host_vibe',        'id'),
            ('unmatched_calendar_events',   'unmatched_calendar_event', 'id'),
            ('badge_types',                 'badge_type',               'id'),
            ('badge_levels',                'badge_level',              'id'),
            ('member_badges',               'member_badge',             'id'),
            ('member_awards',               'member_award',             'id'),
            ('programs',                    'program',                  'id'),
            ('program_cohorts',             'program_cohort',           'id'),
            ('member_program_enrollments',  'program_enrollment',       'id'),
            ('segments',                    'segment',                  'id'),
            ('segment_members',             'segment_member',           'segment_id,member_id'),
            ('feature_flags',               'feature_flag',             'feature_key'),
            ('feature_flag_segments',       'feature_flag_segment',     'feature_key,segment_id'),
            ('user_feature_previews',       'user_feature_preview',     'user_id,feature_key'),
            ('events',                      'event',                    'id'),
            ('event_attendees',             'event_attendee',           'id'),
            ('event_photos',                'event_photo',              'id'),
            ('outreach_leads',              'outreach_lead',            'member_id'),
            ('admin_work_queue_completions','work_queue_completion',    'id')
        ) AS t(tbl, entity, pk)
    LOOP
        EXECUTE format(
            'CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON %I
             FOR EACH ROW EXECUTE FUNCTION audit_row_change(%L, %L)',
            spec.tbl, spec.entity, spec.pk
        );
    END LOOP;
END $$;

-- One feed over everything an admin might want to watch, in one shape:
--   audit     rows of audit_log                     (is_audit = true)
--   activity  rows of member_activities             (is_audit = true when a
--                                                    staff member did it, or an
--                                                    admin did it in sudo)
--   session   one row per user visit from access_events, with its page trail
--             (is_audit = true when the admin was in sudo)
--
-- The central log and (via p_member_id) a member's CRM timeline both read
-- this. Offset-paginated: each source is capped at p_offset + p_limit rows
-- before merging, so deep pages cost more but stay correct. Use
-- count_activity_feed() with the same filters for the total.
--
-- A p_member_id timeline includes an admin's sudo activity as that member
-- (acting_as_member_id), alongside the member's own.
--
-- Sessions are computed only inside [p_from, p_to) so the window bounds the
-- sessionization cost; a visit straddling p_from is split at the edge. Visits
-- are split wherever acting_as_member_id changes, so a sudo stretch is its own
-- row.
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
            true AS is_audit,
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
            AND (NOT p_sudo_only OR a.acting_as_member_id IS NOT NULL))
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

-- The is_admin() check inside is the gate; anon has no business here at all.
REVOKE EXECUTE ON FUNCTION get_activity_feed(boolean, text[], uuid, uuid, boolean, timestamptz, timestamptz, integer, integer, integer)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_activity_feed(boolean, text[], uuid, uuid, boolean, timestamptz, timestamptz, integer, integer, integer)
    TO authenticated;
REVOKE EXECUTE ON FUNCTION count_activity_feed(boolean, text[], uuid, uuid, boolean, timestamptz, timestamptz, integer)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION count_activity_feed(boolean, text[], uuid, uuid, boolean, timestamptz, timestamptz, integer)
    TO authenticated;
