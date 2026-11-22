set lock_timeout = '5s';

-- Several roles per user, contract step 1 (docs/TODO.md, "Let a user hold several roles: the contract step"): every reader of
-- user_profiles.role moves to user_roles. Nothing is dropped and nothing changes for a single-role user: the column, its check,
-- the two sync triggers and user_has_any_role()'s second source stay and keep being written, so a rolled-back deploy and old code
-- that is still running keep working. The drop is the next PR, once this one is deployed.
--
-- Each function below is the LATEST definition (read from the database after every earlier migration), with only the read of
-- the column replaced:
--   * analytics_is_staff, get_activity_feed (a visit by an admin or assistant is a staff visit), reorder_writing_goals and
--     reorder_writing_projects (the audit actor kind), member_removal_extras (the role shown for the profile to be deleted):
--     read user_roles.
--   * custom_access_token_hook: app_role is the primary role (the lowest rank held in user_roles, 'member' for none, null with no
--     profile row) and app_roles every role held, both from user_roles.
--   * enforce_user_role_changes: "another admin exists" counts user_roles only.
--   * top_role_rank: the highest role held, from user_roles only.
-- The guard test supabase/tests/database/user_roles_readers.test.sql fails on any new function that reads the column.


CREATE OR REPLACE FUNCTION public.analytics_is_staff(uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = uid AND r.role = 'admin')
        OR EXISTS (SELECT 1 FROM members m WHERE m.user_id = uid AND m.staff_role IS NOT NULL);
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
                SELECT 1 FROM user_roles vr WHERE vr.user_id = n.user_id AND vr.role IN ('admin', 'assistant')
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

CREATE OR REPLACE FUNCTION public.reorder_writing_goals(p_member_id text, p_project_id text, p_ids text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  old_ids text[];
  new_ids text[];
BEGIN
  -- Each test is coalesced: without a member row or a role they are NULL, and NOT NULL doesn't raise.
  IF NOT (coalesce(p_member_id = public.current_member_id(), false) OR coalesce(public.is_admin(), false) OR coalesce(auth.role() = 'service_role', false)) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  -- Lock the rows in a fixed order, so two reorders at once wait for each other instead of deadlocking.
  PERFORM 1 FROM public.writing_goals
    WHERE member_id = p_member_id AND project_id = p_project_id AND archived_at IS NULL AND deleted_at IS NULL AND id::text = ANY (p_ids)
    ORDER BY id FOR UPDATE;

  -- A goal's id is a uuid (a project's is text), so the ids are compared as text.
  WITH given AS (
    SELECT u.id, min(u.ord) AS ord FROM unnest(p_ids) WITH ORDINALITY AS u(id, ord) GROUP BY u.id
  ), mine AS (
    SELECT w.id AS gid, w.id::text AS id, w.sort_position, gv.ord
      FROM public.writing_goals w JOIN given gv ON gv.id = w.id::text
      WHERE w.member_id = p_member_id AND w.project_id = p_project_id AND w.archived_at IS NULL AND w.deleted_at IS NULL
  )
  SELECT
    coalesce((SELECT array_agg(id ORDER BY sort_position ASC NULLS LAST, gid ASC) FROM mine), '{}'),
    coalesce((SELECT array_agg(id ORDER BY ord) FROM mine), '{}')
  INTO old_ids, new_ids;

  UPDATE public.writing_goals w SET sort_position = o.pos
    FROM (SELECT x.id, row_number() OVER (ORDER BY x.ord)::integer AS pos
            FROM (SELECT u.id, min(u.ord) AS ord FROM unnest(p_ids) WITH ORDINALITY AS u(id, ord) GROUP BY u.id) x
            WHERE x.id = ANY (new_ids)) o
    WHERE w.id::text = o.id AND w.member_id = p_member_id AND w.project_id = p_project_id AND w.archived_at IS NULL AND w.deleted_at IS NULL
      AND w.sort_position IS DISTINCT FROM o.pos;

  -- One audit entry for the reorder, as whoever did it, and none when the order is the one it was.
  IF old_ids IS DISTINCT FROM new_ids THEN
    INSERT INTO public.audit_log (changed_by, actor_kind, acting_as_member_id, entity_type, entity_id, action, changes, member_id)
    VALUES (
      uid,
      CASE
        WHEN uid IS NULL THEN 'system'
        WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid AND role IN ('admin', 'assistant', 'community_manager')) THEN 'staff'
        ELSE 'member'
      END,
      public.current_acting_as_member_id(), 'writing_goal_order', p_project_id, 'update',
      jsonb_build_object('order', jsonb_build_object('old', to_jsonb(old_ids), 'new', to_jsonb(new_ids))),
      p_member_id
    );
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.reorder_writing_projects(p_member_id text, p_ids text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  old_ids text[];
  new_ids text[];
BEGIN
  -- Each test is coalesced: without a member row or a role they are NULL, and NOT NULL doesn't raise.
  IF NOT (coalesce(p_member_id = public.current_member_id(), false) OR coalesce(public.is_admin(), false) OR coalesce(auth.role() = 'service_role', false)) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  -- Lock the rows in a fixed order, so two reorders at once wait for each other instead of deadlocking.
  PERFORM 1 FROM public.writing_projects
    WHERE member_id = p_member_id AND deleted_at IS NULL AND id = ANY (p_ids)
    ORDER BY id FOR UPDATE;

  WITH given AS (
    SELECT u.id, min(u.ord) AS ord FROM unnest(p_ids) WITH ORDINALITY AS u(id, ord) GROUP BY u.id
  ), mine AS (
    SELECT p.id, p.sort_position, p.created_at, g.ord
      FROM public.writing_projects p JOIN given g ON g.id = p.id
      WHERE p.member_id = p_member_id AND p.deleted_at IS NULL
  )
  SELECT
    coalesce((SELECT array_agg(id ORDER BY sort_position ASC NULLS FIRST, created_at DESC, id DESC) FROM mine), '{}'),
    coalesce((SELECT array_agg(id ORDER BY ord) FROM mine), '{}')
  INTO old_ids, new_ids;

  UPDATE public.writing_projects p SET sort_position = o.pos
    FROM (SELECT x.id, row_number() OVER (ORDER BY x.ord)::integer AS pos
            FROM (SELECT u.id, min(u.ord) AS ord FROM unnest(p_ids) WITH ORDINALITY AS u(id, ord) GROUP BY u.id) x
            WHERE x.id = ANY (new_ids)) o
    WHERE p.id = o.id AND p.member_id = p_member_id AND p.deleted_at IS NULL AND p.sort_position IS DISTINCT FROM o.pos;

  -- One audit entry for the reorder, as whoever did it, and none when the order is the one it was.
  IF old_ids IS DISTINCT FROM new_ids THEN
    INSERT INTO public.audit_log (changed_by, actor_kind, acting_as_member_id, entity_type, entity_id, action, changes, member_id)
    VALUES (
      uid,
      CASE
        WHEN uid IS NULL THEN 'system'
        WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid AND role IN ('admin', 'assistant', 'community_manager')) THEN 'staff'
        ELSE 'member'
      END,
      public.current_acting_as_member_id(), 'writing_project_order', p_member_id, 'update',
      jsonb_build_object('order', jsonb_build_object('old', to_jsonb(old_ids), 'new', to_jsonb(new_ids))),
      p_member_id
    );
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.member_removal_extras(p_member_id text)
 RETURNS TABLE(item text, action text, row_count bigint, samples text[])
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  m public.members%ROWTYPE;
  v_user uuid;
  nm text;
  names text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO m FROM public.members WHERE id = p_member_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no member %', p_member_id;
  END IF;
  v_user := m.user_id;

  -- Sign-in side, keyed by the auth user.
  item := 'auth_user'; action := 'delete'; samples := ARRAY[]::text[];
  row_count := CASE WHEN v_user IS NULL THEN 0 ELSE 1 END; RETURN NEXT;

  item := 'user_profiles'; action := 'delete';
  SELECT count(*), COALESCE(array_agg('Profile, role ' || COALESCE((SELECT r.role FROM public.user_roles r WHERE r.user_id = up.id ORDER BY public.staff_role_rank(r.role) LIMIT 1), 'member')), ARRAY[]::text[]) INTO row_count, samples
    FROM public.user_profiles up WHERE v_user IS NOT NULL AND up.id = v_user; RETURN NEXT;
  item := 'slack_identities'; action := 'delete';
  SELECT count(*), COALESCE(array_agg('Slack sign-in link, connected ' || to_char(created_at, 'DD Mon YYYY')), ARRAY[]::text[]) INTO row_count, samples
    FROM public.slack_identities WHERE v_user IS NOT NULL AND user_id = v_user; RETURN NEXT;
  item := 'user_feature_previews'; action := 'delete';
  SELECT count(*), COALESCE(array_agg('Preview turned on: ' || feature_key), ARRAY[]::text[]) INTO row_count, samples
    FROM public.user_feature_previews WHERE v_user IS NOT NULL AND user_id = v_user; RETURN NEXT;
  item := 'access_events'; action := 'delete'; samples := ARRAY[]::text[];
  SELECT count(*) INTO row_count FROM public.access_events WHERE v_user IS NOT NULL AND user_id = v_user; RETURN NEXT;
  item := 'analytics_events'; action := 'delete';
  SELECT count(*) INTO row_count FROM public.analytics_events WHERE v_user IS NOT NULL AND user_id = v_user; RETURN NEXT;

  -- Stored files deleted after the commit (a kept book's cover stays when the member keeps their public work).
  item := 'media_files'; action := 'delete';
  SELECT count(*) INTO row_count FROM public.media_assets WHERE owner_member_id = p_member_id AND storage_path IS NOT NULL;
  SELECT COALESCE(array_agg(label), ARRAY[]::text[]) INTO samples FROM (
    SELECT kind || ': ' || left(title, 60) AS label FROM public.media_assets
     WHERE owner_member_id = p_member_id AND storage_path IS NOT NULL ORDER BY created_at LIMIT 10) q; RETURN NEXT;

  item := 'feedback_screenshots'; action := 'delete';
  SELECT count(*) INTO row_count FROM public.feedback
   WHERE (member_id = p_member_id OR (v_user IS NOT NULL AND user_id = v_user)) AND screenshot_path IS NOT NULL;
  SELECT COALESCE(array_agg(label), ARRAY[]::text[]) INTO samples FROM (
    SELECT 'Screenshot with ' || feedback_type || ' feedback, ' || to_char(created_at, 'DD Mon YYYY') AS label FROM public.feedback
     WHERE (member_id = p_member_id OR (v_user IS NOT NULL AND user_id = v_user)) AND screenshot_path IS NOT NULL ORDER BY created_at LIMIT 10) q; RETURN NEXT;

  -- Free text cleared on rows that stay.
  item := 'mentorship_notes'; action := 'clear';
  SELECT count(*) INTO row_count FROM public.mentorships WHERE new_member_id = p_member_id AND outcome_note IS NOT NULL;
  SELECT COALESCE(array_agg(label), ARRAY[]::text[]) INTO samples FROM (
    SELECT 'Outcome note, mentorship started ' || to_char(started_on, 'DD Mon YYYY') AS label FROM public.mentorships
     WHERE new_member_id = p_member_id AND outcome_note IS NOT NULL ORDER BY started_on LIMIT 10) q; RETURN NEXT;

  item := 'hiatus_notes'; action := 'clear';
  SELECT count(*) INTO row_count FROM public.member_hiatus_history WHERE member_id = p_member_id AND (notes IS NOT NULL OR reason IS NOT NULL);
  SELECT COALESCE(array_agg(label), ARRAY[]::text[]) INTO samples FROM (
    SELECT 'Hiatus from ' || to_char(start_date, 'DD Mon YYYY') || ' (' ||
           concat_ws(' and ', CASE WHEN notes IS NOT NULL THEN 'note' END, CASE WHEN reason IS NOT NULL THEN 'reason' END) || ')' AS label
      FROM public.member_hiatus_history
     WHERE member_id = p_member_id AND (notes IS NOT NULL OR reason IS NOT NULL) ORDER BY start_date LIMIT 10) q; RETURN NEXT;

  item := 'enrolment_notes'; action := 'clear';
  SELECT count(*) INTO row_count FROM public.member_program_enrollments WHERE member_id = p_member_id AND notes IS NOT NULL;
  SELECT COALESCE(array_agg(label), ARRAY[]::text[]) INTO samples FROM (
    SELECT 'Enrolment note, enrolled ' || to_char(created_at, 'DD Mon YYYY') AS label FROM public.member_program_enrollments
     WHERE member_id = p_member_id AND notes IS NOT NULL ORDER BY created_at LIMIT 10) q; RETURN NEXT;

  item := 'feedback_details'; action := 'clear';
  SELECT count(*) INTO row_count FROM public.feedback
   WHERE (member_id = p_member_id OR (v_user IS NOT NULL AND user_id = v_user)) AND (user_agent IS NOT NULL OR screenshot_path IS NOT NULL);
  SELECT COALESCE(array_agg(label), ARRAY[]::text[]) INTO samples FROM (
    SELECT 'Browser details on ' || feedback_type || ' feedback, ' || to_char(created_at, 'DD Mon YYYY') AS label FROM public.feedback
     WHERE (member_id = p_member_id OR (v_user IS NOT NULL AND user_id = v_user)) AND (user_agent IS NOT NULL OR screenshot_path IS NOT NULL)
     ORDER BY created_at LIMIT 10) q; RETURN NEXT;

  -- Audit log: entries about them are deleted (grouped by kind); their name and email are replaced inside the others.
  item := 'audit_entries'; action := 'delete';
  SELECT count(*) INTO row_count FROM public.audit_log
   WHERE member_id = p_member_id OR acting_as_member_id = p_member_id OR (entity_type = 'member' AND entity_id = p_member_id);
  SELECT COALESCE(array_agg(label), ARRAY[]::text[]) INTO samples FROM (
    SELECT entity_type || ' (' || count(*) || ')' AS label FROM public.audit_log
     WHERE member_id = p_member_id OR acting_as_member_id = p_member_id OR (entity_type = 'member' AND entity_id = p_member_id)
     GROUP BY entity_type ORDER BY count(*) DESC, entity_type LIMIT 10) q; RETURN NEXT;

  FOREACH nm IN ARRAY ARRAY[m.name, m.display_name, m.email] LOOP
    IF nm IS NOT NULL AND length(nm) >= 3 THEN names := names || nm; END IF;
  END LOOP;
  item := 'audit_mentions'; action := 'replace'; row_count := 0; samples := ARRAY[]::text[];
  IF cardinality(names) > 0 THEN
    -- The audit log is scanned once: each row's changes are cast to text once and the escaped names are computed once
    -- (about 0.45s for 22k rows in production, a third of the per-row version).
    WITH n AS (
      SELECT substr(to_jsonb(v)::text, 2, length(to_jsonb(v)::text) - 2) AS esc, v AS raw FROM unnest(names) AS v
    ), hits AS (
      SELECT a.entity_type FROM public.audit_log a
       CROSS JOIN LATERAL (SELECT a.changes::text AS t) c
       WHERE a.member_id IS DISTINCT FROM p_member_id AND a.acting_as_member_id IS DISTINCT FROM p_member_id
         AND NOT COALESCE(a.entity_type = 'member' AND a.entity_id = p_member_id, false)
         AND EXISTS (SELECT 1 FROM n WHERE strpos(c.t, n.esc) > 0 OR strpos(COALESCE(a.entity_label, ''), n.raw) > 0)
    ), g AS (
      SELECT entity_type, count(*) AS c FROM hits GROUP BY entity_type ORDER BY count(*) DESC, entity_type LIMIT 10
    )
    SELECT (SELECT count(*) FROM hits), COALESCE((SELECT array_agg(entity_type || ' (' || c || ')' ORDER BY c DESC, entity_type) FROM g), ARRAY[]::text[])
      INTO row_count, samples;
  END IF;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_user_role_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_target uuid := COALESCE(NEW.user_id, OLD.user_id);
  v_role text := COALESCE(NEW.role, OLD.role);
  v_actor_rank integer;
  v_target_rank integer;
BEGIN
  IF v_actor IS NULL OR auth.role() = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = v_target) THEN
    RETURN OLD;
  END IF;

  v_actor_rank := public.top_role_rank(v_actor);
  IF v_actor_rank IS NULL OR v_actor_rank > public.staff_role_rank('assistant') THEN
    RAISE EXCEPTION 'Only admins and assistants can change roles' USING ERRCODE = '42501';
  END IF;

  IF v_actor_rank > public.staff_role_rank('admin') THEN
    v_target_rank := public.top_role_rank(v_target);
    IF v_target_rank IS NOT NULL AND v_target_rank <= v_actor_rank THEN
      RAISE EXCEPTION 'An assistant can''t change the roles of an admin or another assistant' USING ERRCODE = '42501';
    END IF;
    IF public.staff_role_rank(v_role) <= v_actor_rank THEN
      RAISE EXCEPTION 'An assistant can only give or take away the community manager and conversion specialist roles' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' AND v_role = 'admin' THEN
    IF v_target = v_actor THEN
      RAISE EXCEPTION 'You can''t remove your own admin role; ask another admin' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE role = 'admin' AND user_id <> v_target
    ) THEN
      RAISE EXCEPTION 'You can''t remove the last admin' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.top_role_rank(p_user uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $function$
  SELECT min(public.staff_role_rank(r.role)) FROM public.user_roles r WHERE r.user_id = p_user;
$function$;

-- The hook: app_role is the primary role (the highest priority held, 'member' for none, JSON null with no profile row) and app_roles
-- every staff role held, highest first, both from user_roles. A lookup error still returns the event untouched.
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  claims jsonb := event -> 'claims';
  uid uuid;
  has_profile boolean;
  user_role text;
  user_roles_list jsonb;
BEGIN
  BEGIN
    uid := (event ->> 'user_id')::uuid;
    SELECT EXISTS (SELECT 1 FROM public.user_profiles AS p WHERE p.id = uid) INTO has_profile;

    SELECT COALESCE(jsonb_agg(r.role ORDER BY public.staff_role_rank(r.role)), '[]'::jsonb) INTO user_roles_list
    FROM public.user_roles AS r
    WHERE r.user_id = uid;

    user_role := CASE WHEN has_profile THEN COALESCE(user_roles_list ->> 0, 'member') END;
  EXCEPTION WHEN OTHERS THEN
    -- A hook error blocks sign-in and token refresh for everyone. Never do that over a hint:
    -- leave the claims out and let the proxy refuse the admin area until a token carries them.
    RETURN event;
  END;

  claims := jsonb_set(claims, '{app_role}', COALESCE(to_jsonb(user_role), 'null'::jsonb));
  claims := jsonb_set(claims, '{app_roles}', user_roles_list);
  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

NOTIFY pgrst, 'reload schema';
