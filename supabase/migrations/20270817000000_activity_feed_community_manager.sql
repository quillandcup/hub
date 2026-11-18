set lock_timeout = '5s';

-- The community manager reads one member's activity on the member page (Activity tab), nothing else of the feed.
-- Only get_activity_feed and count_activity_feed change, with the same signatures and grants (no table, column or
-- function is added, dropped or retyped), so the code live in production keeps working through the deploy.
--
-- Before: both functions answer only is_admin(). A community manager (is_community_manager()) got 0 and no rows.
-- Now, for a community manager and only with a member (p_member_id not null; the global feed stays admin-only):
--   * the `activity` kind only (member_activities): the member's own activity, what staff did for them, and what an admin did
--     while viewing as them (acting_as_member_id). A request for any other kind returns nothing (it is intersected with
--     {activity}, never widened), and so does a request with p_entity_types (those select audit rows: the Privacy view);
--   * never audit_log rows (before and after values of staff changes: legal name, emails, aliases, status overrides, merges,
--     removals: they would reach around the Identity and Account tabs she may not open), never access_events (page trails
--     of sessions), never member_admin_notes (she reads notes on others through her own table policy, and the one about her
--     own member record is hidden from her; the feed does not carry them for her at all);
--   * the rows her table policy "Community managers read member_activities" would show her, which is every row (the
--     functions are SECURITY DEFINER, so that predicate is repeated here by is_community_manager()); a test pins the
--     function's rows to what a direct read under her policies shows, so the two cannot drift;
--   * `source = 'care'` rows are included for her (they are left out for admins, whose feed says the same event once through
--     the audit row); she cannot read audit rows, so for her the activity row is the one entry, and it is the same row her
--     plan card lists under "Activity during this plan";
--   * the actor of a row is named by member name, never by the staff account's email address.
-- An admin gets exactly what they got before. Anyone else (a member, anon) still gets 0 and no rows.

CREATE OR REPLACE FUNCTION public.count_activity_feed(p_audit_only boolean DEFAULT false, p_kinds text[] DEFAULT NULL::text[], p_actor_user_id uuid DEFAULT NULL::uuid, p_member_id text DEFAULT NULL::text, p_sudo_only boolean DEFAULT false, p_from timestamp with time zone DEFAULT (now() - '30 days'::interval), p_to timestamp with time zone DEFAULT (now() + '00:01:00'::interval), p_session_gap_minutes integer DEFAULT 30, p_entity_types text[] DEFAULT NULL::text[], p_hide_system boolean DEFAULT false, p_hide_slack boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
    v_admin boolean := is_admin();
    -- A community manager reads one member's `activity` rows and nothing else (see the header of this migration).
    v_cm boolean := NOT is_admin() AND is_community_manager() AND p_member_id IS NOT NULL;
BEGIN
    RETURN (SELECT CASE WHEN NOT (v_admin OR v_cm) THEN 0 ELSE (
        (SELECT COUNT(*) FROM audit_log a
          WHERE NOT v_cm AND (p_kinds IS NULL OR 'audit' = ANY (p_kinds))
          AND (p_entity_types IS NULL OR a.entity_type = ANY (p_entity_types))
            AND a.occurred_at >= p_from AND a.occurred_at < p_to
            AND (p_actor_user_id IS NULL OR a.changed_by = p_actor_user_id)
            AND (p_member_id IS NULL OR a.member_id = p_member_id OR a.acting_as_member_id = p_member_id)
            AND (NOT p_sudo_only OR a.acting_as_member_id IS NOT NULL)
            AND (NOT p_audit_only OR (a.actor_kind <> 'member' OR a.acting_as_member_id IS NOT NULL))
            AND (NOT p_hide_system OR a.actor_kind <> 'system')
            AND NOT (a.entity_type = 'care_engagement' AND a.action = 'update' AND a.changes #>> '{ended_how,new}' = 'renewed'))
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
          AND (NOT p_hide_slack OR m.source IS DISTINCT FROM 'slack')
          AND (v_cm OR m.source IS DISTINCT FROM 'care'))
        +
        (SELECT COUNT(*) FROM member_admin_notes n
          WHERE NOT v_cm AND p_entity_types IS NULL AND (p_kinds IS NULL OR 'note' = ANY (p_kinds))
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
            WHERE NOT v_cm AND p_entity_types IS NULL AND (p_kinds IS NULL OR 'session' = ANY (p_kinds))
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
DECLARE
    v_admin boolean := is_admin();
    -- A community manager reads one member's `activity` rows and nothing else (see the header of this migration).
    v_cm boolean := NOT is_admin() AND is_community_manager() AND p_member_id IS NOT NULL;
BEGIN
    -- Anyone else (a member, anon, a community manager asking for the global feed) gets no rows.
    IF NOT (v_admin OR v_cm) THEN
        RETURN;
    END IF;
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
        WHERE NOT v_cm AND (p_kinds IS NULL OR 'audit' = ANY (p_kinds))
          AND (p_entity_types IS NULL OR a.entity_type = ANY (p_entity_types))
          AND a.occurred_at >= p_from AND a.occurred_at < p_to
          AND (p_actor_user_id IS NULL OR a.changed_by = p_actor_user_id)
          AND (p_member_id IS NULL OR a.member_id = p_member_id OR a.acting_as_member_id = p_member_id)
          AND (NOT p_sudo_only OR a.acting_as_member_id IS NOT NULL)
          AND (NOT p_audit_only OR (a.actor_kind <> 'member' OR a.acting_as_member_id IS NOT NULL))
          AND (NOT p_hide_system OR a.actor_kind <> 'system')
          AND NOT (a.entity_type = 'care_engagement' AND a.action = 'update' AND a.changes #>> '{ended_how,new}' = 'renewed')
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
            -- Where the source can be opened (lib/activity-links.ts): the prickle of a check-in or attendance, the member's feedback.
            CASE WHEN m.source IN ('prickle_attendance', 'prickle_checkins') THEN 'prickle'
                 WHEN m.source = 'feedback' THEN 'feedback' END AS entity_type,
            CASE WHEN m.source IN ('prickle_attendance', 'prickle_checkins') THEN COALESCE(m.prickle_id, m.related_id)
                 WHEN m.source = 'feedback' THEN m.related_id END AS entity_id,
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
          AND (v_cm OR m.source IS DISTINCT FROM 'care')
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
        WHERE NOT v_cm AND p_entity_types IS NULL AND (p_kinds IS NULL OR 'note' = ANY (p_kinds))
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
        WHERE NOT v_cm AND p_entity_types IS NULL AND (p_kinds IS NULL OR 'session' = ANY (p_kinds))
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
        COALESCE(am.name, CASE WHEN NOT v_cm THEN up.email END, CASE WHEN r.actor_kind = 'member' THEN mem.name END) AS actor_label,
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
    ORDER BY r.occurred_at DESC, r.event_id DESC
    OFFSET p_offset
    LIMIT p_limit;
END;
$function$;

