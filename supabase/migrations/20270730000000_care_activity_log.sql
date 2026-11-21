set lock_timeout = '5s';

-- Hedgie Care in the Activity Log (docs/architecture/ACTIVITY_AND_AUDIT_LOG.md, "A feature launches with its events in the activity log").
-- Three things, none of them a schema change (no table or column is added, changed or dropped):
--
--   1. The audit rows of a care plan never carry what staff typed. The plan's note and next step were logged with their text in
--      the change delta, which the Activity Log shows to every admin. The three audit triggers now redact those two columns (the
--      row still says the note changed, never what it said), and the rows already written are scrubbed the same way.
--
--   2. A care plan's events are said once in the central Activity Log. Each one is written twice by design: the audit row, which
--      the database writes whatever the app does, and a `member_activities` row (source 'care', written by the action) that the
--      plan card's "Activity during this plan" reads, because the community manager can read member_activities but not audit_log.
--      The feed lists the audit row and leaves the care activity rows out, and leaves out the second audit row of a renewal (the
--      old plan closed as "renewed": the new plan's row already says "renewed"). Only get_activity_feed and count_activity_feed
--      change, by those two conditions; their signatures and grants stay.
--
--   3. A member does not read the care rows about themselves. member_activities is readable by its member (own rows) and by
--      admins; the care rows are what staff did and decided about a member (a plan started, handed to a colleague), so the member's
--      policy now leaves them out. Admins and the community manager read them as before.

------------------------------------------------------------------------------------------------
-- 1. Redact the typed columns in the audit triggers, and scrub what is already there.
------------------------------------------------------------------------------------------------

CREATE OR REPLACE TRIGGER audit_row_change_insert
  AFTER INSERT ON public.care_engagements
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('care_engagement', 'id', 'notes,next_step');

CREATE OR REPLACE TRIGGER audit_row_change_update
  AFTER UPDATE ON public.care_engagements
  FOR EACH ROW WHEN (
    (to_jsonb(OLD) - 'updated_at' - 'last_staff_message_at' - 'last_member_message_at')
    IS DISTINCT FROM (to_jsonb(NEW) - 'updated_at' - 'last_staff_message_at' - 'last_member_message_at')
  )
  EXECUTE FUNCTION public.audit_row_change('care_engagement', 'id', 'notes,next_step');

CREATE OR REPLACE TRIGGER audit_row_change_delete
  AFTER DELETE ON public.care_engagements
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('care_engagement', 'id', 'notes,next_step');

-- Rows written before: a value that was there becomes the redaction marker, a null stays null (as the trigger writes them).
UPDATE public.audit_log
   SET changes = changes
     || CASE WHEN changes ? 'notes' THEN jsonb_build_object('notes', jsonb_build_object(
          'old', CASE WHEN jsonb_typeof(changes -> 'notes' -> 'old') IN ('null') OR changes -> 'notes' -> 'old' IS NULL THEN 'null'::jsonb ELSE '"[redacted]"'::jsonb END,
          'new', CASE WHEN jsonb_typeof(changes -> 'notes' -> 'new') IN ('null') OR changes -> 'notes' -> 'new' IS NULL THEN 'null'::jsonb ELSE '"[redacted]"'::jsonb END)) ELSE '{}'::jsonb END
     || CASE WHEN changes ? 'next_step' THEN jsonb_build_object('next_step', jsonb_build_object(
          'old', CASE WHEN jsonb_typeof(changes -> 'next_step' -> 'old') IN ('null') OR changes -> 'next_step' -> 'old' IS NULL THEN 'null'::jsonb ELSE '"[redacted]"'::jsonb END,
          'new', CASE WHEN jsonb_typeof(changes -> 'next_step' -> 'new') IN ('null') OR changes -> 'next_step' -> 'new' IS NULL THEN 'null'::jsonb ELSE '"[redacted]"'::jsonb END)) ELSE '{}'::jsonb END
 WHERE entity_type = 'care_engagement'
   AND (changes ? 'notes' OR changes ? 'next_step');

------------------------------------------------------------------------------------------------
-- 2. The feed says a care plan's events once.
------------------------------------------------------------------------------------------------

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
          AND m.source IS DISTINCT FROM 'care')
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
          AND m.source IS DISTINCT FROM 'care'
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

------------------------------------------------------------------------------------------------
-- 3. A member reads their own activity except the care rows about them.
------------------------------------------------------------------------------------------------

DROP POLICY "View own activities, admins view all" ON public.member_activities;
CREATE POLICY "View own activities, admins view all" ON public.member_activities
  FOR SELECT TO authenticated
  USING (
    (member_id = (SELECT public.current_member_id()) AND source IS DISTINCT FROM 'care')
    OR (SELECT public.is_admin())
  );
