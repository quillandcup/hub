set lock_timeout = '5s';

-- Staff notes join the admin activity feed as a fourth kind ("note"), so a member's Activity Log is the
-- one timeline: notes sit between the outreach touch before them and the Slack post after.
--
-- Notes are not written into member_activities (members can read their own rows there); the feed
-- functions, which are admin-only (SECURITY DEFINER, is_admin()), read member_admin_notes directly.
--
-- Editing: a note can be corrected by its author for a short while after it is written. Direct
-- UPDATEs are narrowed to deleted_at (the soft delete); the text changes only through
-- edit_member_admin_note(), which checks the author, that the note is live and that it is inside
-- the window the app passes (app.config.ts adminNoteEditMinutes, which SQL can't read). edited_at
-- marks an edited note in the timeline.

ALTER TABLE public.member_admin_notes ADD COLUMN edited_at timestamptz;

REVOKE UPDATE ON public.member_admin_notes FROM authenticated;
GRANT UPDATE (deleted_at) ON public.member_admin_notes TO authenticated;

CREATE FUNCTION public.edit_member_admin_note(p_note_id text, p_body text, p_window_minutes integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_rows integer;
BEGIN
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Only staff can edit notes' USING ERRCODE = '42501';
    END IF;
    IF p_window_minutes IS NULL OR p_window_minutes <= 0 THEN
        RAISE EXCEPTION 'The edit window must be positive' USING ERRCODE = '22023';
    END IF;
    UPDATE member_admin_notes
       SET body = btrim(p_body), edited_at = now()
     WHERE id = p_note_id
       AND created_by = auth.uid()
       AND deleted_at IS NULL
       AND created_at > now() - make_interval(mins => p_window_minutes);
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows > 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.edit_member_admin_note(text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_member_admin_note(text, text, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.edit_member_admin_note(text, text, integer) IS
  'Corrects a staff note: only its author, only while it is live and newer than p_window_minutes. False when nothing matched.';

CREATE OR REPLACE FUNCTION public.count_activity_feed(p_audit_only boolean DEFAULT false, p_kinds text[] DEFAULT NULL::text[], p_actor_user_id uuid DEFAULT NULL::uuid, p_member_id text DEFAULT NULL::text, p_sudo_only boolean DEFAULT false, p_from timestamp with time zone DEFAULT (now() - '30 days'::interval), p_to timestamp with time zone DEFAULT (now() + '00:01:00'::interval), p_session_gap_minutes integer DEFAULT 30, p_entity_types text[] DEFAULT NULL::text[], p_hide_system boolean DEFAULT false, p_hide_slack boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
    RETURN (SELECT CASE WHEN NOT is_admin() THEN 0 ELSE (
        (SELECT COUNT(*) FROM audit_log a
          WHERE (p_kinds IS NULL OR 'audit' = ANY (p_kinds))
          AND (p_entity_types IS NULL OR a.entity_type = ANY (p_entity_types))
            AND a.occurred_at >= p_from AND a.occurred_at < p_to
            AND (p_actor_user_id IS NULL OR a.changed_by = p_actor_user_id)
            AND (p_member_id IS NULL OR a.member_id = p_member_id OR a.acting_as_member_id = p_member_id)
            AND (NOT p_sudo_only OR a.acting_as_member_id IS NOT NULL)
            AND (NOT p_audit_only OR (a.actor_kind <> 'member' OR a.acting_as_member_id IS NOT NULL))
            AND (NOT p_hide_system OR a.actor_kind <> 'system'))
        +
        (SELECT COUNT(*) FROM member_activities m
          WHERE p_entity_types IS NULL AND (p_kinds IS NULL OR 'activity' = ANY (p_kinds))
            AND m.occurred_at >= p_from AND m.occurred_at < p_to
            AND (p_actor_user_id IS NULL OR m.actor_user_id = p_actor_user_id
                 OR (m.actor_kind = 'member' AND m.member_id IN (
                        SELECT mm.id FROM members mm WHERE mm.user_id = p_actor_user_id)))
            AND (p_member_id IS NULL OR m.member_id = p_member_id OR m.acting_as_member_id = p_member_id)
            AND (NOT p_sudo_only OR m.acting_as_member_id IS NOT NULL)
            AND (NOT p_audit_only OR m.actor_kind = 'staff' OR m.acting_as_member_id IS NOT NULL)
            AND (NOT p_hide_system OR m.actor_kind <> 'system')
          AND (NOT p_hide_slack OR m.source IS DISTINCT FROM 'slack'))
        +
        (SELECT COUNT(*) FROM member_admin_notes n
          WHERE p_entity_types IS NULL AND (p_kinds IS NULL OR 'note' = ANY (p_kinds))
            AND n.deleted_at IS NULL
            AND n.created_at >= p_from AND n.created_at < p_to
            AND (p_actor_user_id IS NULL OR n.created_by = p_actor_user_id)
            AND (p_member_id IS NULL OR n.member_id = p_member_id)
            AND NOT p_sudo_only)
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
    )::integer END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_activity_feed(p_audit_only boolean DEFAULT false, p_kinds text[] DEFAULT NULL::text[], p_actor_user_id uuid DEFAULT NULL::uuid, p_member_id text DEFAULT NULL::text, p_sudo_only boolean DEFAULT false, p_from timestamp with time zone DEFAULT (now() - '30 days'::interval), p_to timestamp with time zone DEFAULT (now() + '00:01:00'::interval), p_offset integer DEFAULT 0, p_limit integer DEFAULT 50, p_session_gap_minutes integer DEFAULT 30, p_entity_types text[] DEFAULT NULL::text[], p_hide_system boolean DEFAULT false, p_hide_slack boolean DEFAULT false)
 RETURNS TABLE(event_id text, kind text, occurred_at timestamp with time zone, is_audit boolean, actor_user_id uuid, actor_kind text, actor_label text, member_id text, member_name text, acting_as_member_id text, acting_as_member_name text, event_type text, entity_type text, entity_id text, title text, description text, source text, data jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
    RETURN QUERY
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
          AND (NOT p_hide_system OR a.actor_kind <> 'system')
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
          AND (NOT p_hide_system OR m.actor_kind <> 'system')
          AND (NOT p_hide_slack OR m.source IS DISTINCT FROM 'slack')
        ORDER BY m.occurred_at DESC, m.id DESC
        LIMIT p_offset + p_limit
    ),
    note_rows AS (
        SELECT
            'note:' || n.id AS event_id,
            'note'::text AS kind,
            n.created_at AS occurred_at,
            true AS is_audit,
            n.created_by AS actor_user_id,
            'staff'::text AS actor_kind,
            n.member_id,
            NULL::text AS acting_as_member_id,
            'note'::text AS event_type,
            NULL::text AS entity_type,
            NULL::text AS entity_id,
            'Note'::text AS title,
            n.body AS description,
            'member_admin_notes'::text AS source,
            jsonb_build_object('note_id', n.id, 'edited_at', n.edited_at) AS data
        FROM member_admin_notes n
        WHERE p_entity_types IS NULL AND (p_kinds IS NULL OR 'note' = ANY (p_kinds))
          AND n.deleted_at IS NULL
          AND n.created_at >= p_from AND n.created_at < p_to
          AND (p_actor_user_id IS NULL OR n.created_by = p_actor_user_id)
          AND (p_member_id IS NULL OR n.member_id = p_member_id)
          AND NOT p_sudo_only
        ORDER BY n.created_at DESC, n.id DESC
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
            NULL::text AS member_id,
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
        UNION ALL SELECT * FROM note_rows
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
END;
$function$;
