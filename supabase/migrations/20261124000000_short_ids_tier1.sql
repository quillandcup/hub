-- Short ids, phase 1: the 17 Tier 1 tables get `<prefix>_<12 chars>` text ids (new_id,
-- 20261122000000) and every column that references them follows. See docs/SHORT_IDS_PLAN.md.
--
-- Shape: build an old-uuid -> new-id map, drop what blocks a type change (foreign keys on the
-- converted columns, all policies in public, bronze and storage), retype the columns to text and rewrite
-- the values through the map, rewrite the ids stored outside foreign keys, replace the
-- functions whose signatures carry these ids, then put everything back and verify.
-- Triggers are off for the data rewrite (session_replication_role = replica): an UPDATE of
-- every id must not write audit rows, bump updated_at or re-run sync triggers.

SET LOCAL session_replication_role = replica;

-- 1. Tables and prefixes ------------------------------------------------------------------
CREATE TEMP TABLE sid_t1 (tbl text PRIMARY KEY, prefix text NOT NULL UNIQUE) ON COMMIT DROP;
INSERT INTO sid_t1 VALUES
  ('members', 'mbr'), ('prickles', 'prkl'), ('prickle_types', 'prty'),
  ('prickle_commitments', 'cmt'), ('writing_projects', 'prj'), ('member_books', 'book'),
  ('events', 'evt'), ('programs', 'prg'), ('chat_messages', 'msg'), ('chat_channels', 'chn'),
  ('segments', 'seg'), ('badge_types', 'bdgt'), ('courses', 'crs'), ('course_modules', 'mod'),
  ('course_lessons', 'les'), ('event_photos', 'photo'), ('course_lesson_files', 'file');

-- 2. Old uuid -> new id ---------------------------------------------------------------------
CREATE TEMP TABLE sid_map (tbl text NOT NULL, old text NOT NULL, new text NOT NULL, PRIMARY KEY (tbl, old)) ON COMMIT DROP;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM sid_t1 LOOP
    EXECUTE format('INSERT INTO sid_map SELECT %L, id::text, public.new_id(%L) FROM public.%I', r.tbl, r.prefix, r.tbl);
  END LOOP;
END $$;
CREATE UNIQUE INDEX sid_map_old ON sid_map (old);
CREATE UNIQUE INDEX sid_map_new ON sid_map (new);

-- Replaces every Tier 1 uuid found inside a text value with its new id.
CREATE FUNCTION pg_temp.sid_remap(v text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE m text[]; out text := v;
BEGIN
  IF v IS NULL THEN RETURN NULL; END IF;
  FOR m IN SELECT regexp_matches(v, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'g') LOOP
    out := replace(out, m[1], coalesce((SELECT s.new FROM sid_map s WHERE s.old = m[1]), m[1]));
  END LOOP;
  RETURN out;
END $$;

-- 3. The columns that hold these ids -------------------------------------------------------
-- Every foreign key into a Tier 1 table, plus each table's own id, plus the member-id columns
-- that have no foreign key.
CREATE TEMP TABLE sid_cols (tbl text NOT NULL, col text NOT NULL, parent text NOT NULL, PRIMARY KEY (tbl, col)) ON COMMIT DROP;
INSERT INTO sid_cols
SELECT DISTINCT c.conrelid::regclass::text, a.attname, p.tbl
FROM pg_constraint c
JOIN pg_class pc ON pc.oid = c.confrelid AND pc.relnamespace = 'public'::regnamespace
JOIN sid_t1 p ON p.tbl = pc.relname
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
WHERE c.contype = 'f';
INSERT INTO sid_cols SELECT 'public.' || tbl, 'id', tbl FROM sid_t1;
INSERT INTO sid_cols VALUES
  ('public.audit_log', 'member_id', 'members'),
  ('public.audit_log', 'acting_as_member_id', 'members'),
  ('public.access_events', 'acting_as_member_id', 'members'),
  ('public.member_activities', 'acting_as_member_id', 'members');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class pc ON pc.oid = c.confrelid
             JOIN sid_t1 p ON p.tbl = pc.relname AND pc.relnamespace = 'public'::regnamespace
             WHERE c.contype = 'f' AND array_length(c.conkey, 1) <> 1) THEN
    RAISE EXCEPTION 'a composite foreign key points at a Tier 1 table; the converter handles single columns only';
  END IF;
  IF EXISTS (SELECT 1 FROM sid_cols sc JOIN pg_attribute a ON a.attrelid = sc.tbl::regclass AND a.attname = sc.col
             WHERE a.atttypid <> 'uuid'::regtype) THEN
    RAISE EXCEPTION 'a column to convert is not uuid: %',
      (SELECT string_agg(sc.tbl || '.' || sc.col, ', ') FROM sid_cols sc JOIN pg_attribute a ON a.attrelid = sc.tbl::regclass AND a.attname = sc.col WHERE a.atttypid <> 'uuid'::regtype);
  END IF;
END $$;

-- Row counts before, compared at the end.
CREATE TEMP TABLE sid_counts (tbl text PRIMARY KEY, n bigint NOT NULL) ON COMMIT DROP;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT tbl FROM sid_cols LOOP
    EXECUTE format('INSERT INTO sid_counts SELECT %L, count(*) FROM %s', r.tbl, r.tbl);
  END LOOP;
END $$;

-- 4. Save, then drop, the objects that block the type change -------------------------------
CREATE TEMP TABLE sid_fks AS
SELECT c.conrelid::regclass::text AS tbl, c.conname, pg_get_constraintdef(c.oid) AS def
FROM pg_constraint c
JOIN pg_class pc ON pc.oid = c.confrelid AND pc.relnamespace = 'public'::regnamespace
JOIN sid_t1 p ON p.tbl = pc.relname
WHERE c.contype = 'f';

-- Check constraints that read a converted column (e.g. author <> subject) fail while only one
-- side is text, so they come off too and go back after.
CREATE TEMP TABLE sid_checks AS
SELECT DISTINCT c.conrelid::regclass::text AS tbl, c.conname, pg_get_constraintdef(c.oid) AS def
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
JOIN sid_cols sc ON sc.tbl = c.conrelid::regclass::text AND sc.col = a.attname
WHERE c.contype = 'c';

CREATE TEMP TABLE sid_policies AS
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname IN ('public', 'bronze', 'storage');

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM sid_fks LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
  FOR r IN SELECT * FROM sid_checks LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
  FOR r IN SELECT * FROM sid_policies LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- 5. Retype to text and rewrite the values through the map ---------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM sid_cols ORDER BY tbl, col LOOP
    EXECUTE format('ALTER TABLE %s ALTER COLUMN %I DROP DEFAULT', r.tbl, r.col);
    EXECUTE format('ALTER TABLE %s ALTER COLUMN %I TYPE text USING %I::text', r.tbl, r.col, r.col);
    EXECUTE format('UPDATE %s t SET %I = m.new FROM sid_map m WHERE m.tbl = %L AND m.old = t.%I', r.tbl, r.col, r.parent, r.col);
  END LOOP;
END $$;

-- 6. Ids stored outside foreign keys ---------------------------------------------------------
UPDATE public.audit_log SET entity_id = pg_temp.sid_remap(entity_id) WHERE entity_id ~ '[0-9a-f]{8}-';
UPDATE public.audit_log SET changes = pg_temp.sid_remap(changes::text)::jsonb WHERE changes::text ~ '[0-9a-f]{8}-';
UPDATE public.member_activities SET related_id = pg_temp.sid_remap(related_id) WHERE related_id ~ '[0-9a-f]{8}-';
UPDATE public.member_activities SET data = pg_temp.sid_remap(data::text)::jsonb WHERE data::text ~ '[0-9a-f]{8}-';
UPDATE public.in_app_notifications SET ref = pg_temp.sid_remap(ref), url = pg_temp.sid_remap(url) WHERE ref ~ '[0-9a-f]{8}-' OR url ~ '[0-9a-f]{8}-';
UPDATE public.admin_work_queue_completions SET occurrence_key = pg_temp.sid_remap(occurrence_key) WHERE occurrence_key ~ '[0-9a-f]{8}-';
UPDATE public.chat_message_contents SET attachments = pg_temp.sid_remap(attachments::text)::jsonb, blocks = pg_temp.sid_remap(blocks::text)::jsonb WHERE attachments::text ~ '[0-9a-f]{8}-' OR blocks::text ~ '[0-9a-f]{8}-';
UPDATE bronze.slack_messages SET raw_payload = pg_temp.sid_remap(raw_payload::text)::jsonb WHERE raw_payload::text ~ '[0-9a-f]{8}-';
UPDATE public.access_events SET path = pg_temp.sid_remap(path) WHERE path ~ '[0-9a-f]{8}-';
ALTER TABLE public.ambiguous_zoom_names ALTER COLUMN candidate_member_ids TYPE text[] USING candidate_member_ids::text[];
UPDATE public.ambiguous_zoom_names a SET candidate_member_ids = ARRAY(SELECT coalesce((SELECT m.new FROM sid_map m WHERE m.old = x), x) FROM unnest(a.candidate_member_ids) WITH ORDINALITY AS u(x, n) ORDER BY n);

-- 7. Functions ---------------------------------------------------------------------------------------
-- Generated from the current definitions: member/prickle/chat/... id arguments and results become text;
-- auth user and session ids, Vault ids and Tier 2 ids stay uuid. Signatures change, so the old ones are
-- dropped first; grants and comments are saved and replayed.
-- The functions call each other (a policy helper calls another), so body checks wait until all exist.
SET LOCAL check_function_bodies = off;
CREATE TEMP TABLE sid_fn_acl AS
SELECT p.proname, a.grantee::regrole::text AS grantee
FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (ARRAY['add_event_attendee','admin_member_engagement','admin_members_page','chat_apply_slack_read','chat_can_read_content','chat_can_see_channel','chat_claim_slack_read_pull','chat_is_channel_member','chat_mark_message_failed','chat_mark_message_sent','chat_mark_read','chat_post_message','chat_toggle_reaction','chat_unread_counts','check_prickle_commitment_slot_overlap','count_activity_feed','create_prickle_commitment','current_acting_as_member_id','current_member_id','get_activity_feed','get_hosted_prickle_attendance','get_member_directory','get_profile_writing','get_record_history','has_course_access','match_member_by_name','mentorship_counts','my_mentorships','remove_event_attendee','search_chat_messages','slack_connection_delete_secrets','slack_connection_revoke','slack_connection_save','slack_connection_tokens','slack_connection_update_tokens','sync_event_badge_awards','upsert_ambiguous_zoom_name']) AND a.privilege_type = 'EXECUTE';
CREATE TEMP TABLE sid_fn_comment AS
SELECT p.proname, obj_description(p.oid, 'pg_proc') AS comment
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (ARRAY['add_event_attendee','admin_member_engagement','admin_members_page','chat_apply_slack_read','chat_can_read_content','chat_can_see_channel','chat_claim_slack_read_pull','chat_is_channel_member','chat_mark_message_failed','chat_mark_message_sent','chat_mark_read','chat_post_message','chat_toggle_reaction','chat_unread_counts','check_prickle_commitment_slot_overlap','count_activity_feed','create_prickle_commitment','current_acting_as_member_id','current_member_id','get_activity_feed','get_hosted_prickle_attendance','get_member_directory','get_profile_writing','get_record_history','has_course_access','match_member_by_name','mentorship_counts','my_mentorships','remove_event_attendee','search_chat_messages','slack_connection_delete_secrets','slack_connection_revoke','slack_connection_save','slack_connection_tokens','slack_connection_update_tokens','sync_event_badge_awards','upsert_ambiguous_zoom_name']) AND obj_description(p.oid, 'pg_proc') IS NOT NULL;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
           WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (ARRAY['add_event_attendee','admin_member_engagement','admin_members_page','chat_apply_slack_read','chat_can_read_content','chat_can_see_channel','chat_claim_slack_read_pull','chat_is_channel_member','chat_mark_message_failed','chat_mark_message_sent','chat_mark_read','chat_post_message','chat_toggle_reaction','chat_unread_counts','check_prickle_commitment_slot_overlap','count_activity_feed','create_prickle_commitment','current_acting_as_member_id','current_member_id','get_activity_feed','get_hosted_prickle_attendance','get_member_directory','get_profile_writing','get_record_history','has_course_access','match_member_by_name','mentorship_counts','my_mentorships','remove_event_attendee','search_chat_messages','slack_connection_delete_secrets','slack_connection_revoke','slack_connection_save','slack_connection_tokens','slack_connection_update_tokens','sync_event_badge_awards','upsert_ambiguous_zoom_name']) LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.add_event_attendee(p_event_id text, p_member_id text, p_admin_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_badge_type_id text;
  v_starts_at DATE;
  v_inserted UUID;
BEGIN
  INSERT INTO event_attendees (event_id, member_id, created_by)
  VALUES (p_event_id, p_member_id, p_admin_id)
  ON CONFLICT (event_id, member_id) DO NOTHING
  RETURNING event_id INTO v_inserted;

  IF v_inserted IS NULL THEN
    RETURN; -- already an attendee, nothing more to do
  END IF;

  SELECT bt.id, e.starts_at INTO v_badge_type_id, v_starts_at
  FROM events e
  LEFT JOIN badge_types bt ON bt.event_id = e.id
  WHERE e.id = p_event_id;

  IF v_badge_type_id IS NOT NULL THEN
    INSERT INTO member_badges (member_id, badge_type_id, occurred_at, event_id, awarded_by)
    VALUES (p_member_id, v_badge_type_id, v_starts_at, p_event_id, p_admin_id);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_member_engagement(p_search text DEFAULT NULL::text, p_now timestamp with time zone DEFAULT now())
 RETURNS TABLE(id text, name text, email text, status text, user_id uuid, last_attended_at timestamp with time zone, prickles_last_30_days integer, total_prickles integer, engagement_score integer, risk_level text, engagement_tier text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH pattern AS (
    SELECT CASE
      WHEN coalesce(p_search, '') = '' THEN NULL
      ELSE '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
    END AS like_pattern
  ),
  matched AS (
    SELECT m.id, m.name, m.email, m.status, m.user_id
    FROM members m, pattern
    WHERE pattern.like_pattern IS NULL
      OR m.name ILIKE pattern.like_pattern
      OR m.email ILIKE pattern.like_pattern
      -- Zoom display-name aliases (slack aliases store opaque user ids).
      OR EXISTS (
        SELECT 1 FROM member_name_aliases a
        WHERE a.member_id = m.id AND a.source = 'zoom' AND a.alias ILIKE pattern.like_pattern
      )
  ),
  attended AS (
    SELECT ma.member_id, max(ma.occurred_at) AS last_attended_at, count(*)::integer AS total_prickles
    FROM member_activities ma
    WHERE ma.activity_type = 'prickle_attended'
    GROUP BY ma.member_id
  ),
  recent AS (
    SELECT
      ma.member_id,
      (count(*) FILTER (WHERE ma.activity_type = 'prickle_attended'))::integer AS prickles_last_30_days,
      sum(ma.engagement_value)::integer AS points
    FROM member_activities ma
    WHERE ma.occurred_at >= p_now - interval '30 days'
    GROUP BY ma.member_id
  ),
  scored AS (
    SELECT
      matched.*,
      attended.last_attended_at,
      coalesce(recent.prickles_last_30_days, 0) AS prickles_last_30_days,
      coalesce(attended.total_prickles, 0) AS total_prickles,
      least(100, coalesce(recent.points, 0)) AS engagement_score
    FROM matched
    LEFT JOIN attended ON attended.member_id = matched.id
    LEFT JOIN recent ON recent.member_id = matched.id
  )
  SELECT
    s.id, s.name, s.email, s.status, s.user_id,
    s.last_attended_at, s.prickles_last_30_days, s.total_prickles, s.engagement_score,
    CASE
      WHEN s.last_attended_at IS NULL THEN 'high'
      WHEN p_now - s.last_attended_at > interval '30 days' THEN 'high'
      WHEN p_now - s.last_attended_at >= interval '15 days' THEN 'medium'
      ELSE 'low'
    END AS risk_level,
    CASE
      WHEN s.engagement_score >= 50 THEN 'highly_engaged'
      WHEN s.engagement_score >= 10 THEN 'active'
      ELSE 'at_risk'
    END AS engagement_tier
  FROM scored s;
$function$;

CREATE OR REPLACE FUNCTION public.admin_member_matches_filter(p_filter text, p_status text, p_user_id uuid, p_risk_level text, p_engagement_tier text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE p_filter
    WHEN 'all' THEN true
    WHEN 'active' THEN p_status = 'active'
    WHEN 'on_hiatus' THEN p_status = 'on_hiatus'
    WHEN 'lead' THEN p_status = 'lead'
    WHEN 'cancelled' THEN p_status = 'cancelled'
    WHEN 'unregistered' THEN p_status = 'active' AND p_user_id IS NULL
    -- At-risk only means something for members who are still around.
    WHEN 'at_risk' THEN p_risk_level = 'high' AND p_status IN ('active', 'on_hiatus')
    WHEN 'highly_engaged' THEN p_engagement_tier = 'highly_engaged'
    ELSE true
  END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_members_page(p_filter text DEFAULT 'active'::text, p_search text DEFAULT NULL::text, p_sort text DEFAULT 'name'::text, p_direction text DEFAULT 'asc'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_now timestamp with time zone DEFAULT now())
 RETURNS TABLE(id text, name text, email text, status text, user_id uuid, last_attended_at timestamp with time zone, prickles_last_30_days integer, total_prickles integer, engagement_score integer, risk_level text, engagement_tier text, total_count bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  sort_expr text;
  dir text := CASE WHEN lower(p_direction) = 'desc' THEN 'DESC' ELSE 'ASC' END;
  nulls_clause text := CASE WHEN lower(p_direction) = 'desc' THEN 'NULLS FIRST' ELSE 'NULLS LAST' END;
BEGIN
  sort_expr := CASE p_sort
    WHEN 'name' THEN 'lower(e.name)'
    WHEN 'email' THEN 'lower(e.email)'
    WHEN 'status' THEN 'e.status'
    -- Never attended = oldest possible date.
    WHEN 'last_attended_at' THEN 'coalesce(e.last_attended_at, ''-infinity''::timestamptz)'
    WHEN 'prickles_last_30_days' THEN 'e.prickles_last_30_days'
    WHEN 'total_prickles' THEN 'e.total_prickles'
    WHEN 'engagement_score' THEN 'e.engagement_score'
    WHEN 'risk_level' THEN 'CASE e.risk_level WHEN ''low'' THEN 0 WHEN ''medium'' THEN 1 ELSE 2 END'
    ELSE 'lower(e.name)'
  END;

  RETURN QUERY EXECUTE format(
    'SELECT e.id, e.name, e.email, e.status, e.user_id, e.last_attended_at, e.prickles_last_30_days,
            e.total_prickles, e.engagement_score, e.risk_level, e.engagement_tier, count(*) OVER () AS total_count
     FROM public.admin_member_engagement($1, $2) e
     WHERE public.admin_member_matches_filter($3, e.status, e.user_id, e.risk_level, e.engagement_tier)
     ORDER BY %s %s %s, lower(e.name) ASC, e.id ASC
     LIMIT $4 OFFSET $5',
    sort_expr, dir, nulls_clause
  )
  USING p_search, p_now, p_filter, greatest(1, least(p_limit, 500)), greatest(0, p_offset);
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_apply_slack_read(p_member text, p_channel_id text, p_slack_ts text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE chat_channel_members cm
  SET last_read_at = GREATEST(COALESCE(cm.last_read_at, '-infinity'::timestamptz), LEAST(read_through.at, now()))
  FROM (
    SELECT max(m.created_at) AS at
    FROM chat_messages m
    WHERE m.channel_id = p_channel_id
      AND m.deleted_at IS NULL
      AND m.slack_ts ~ '^[0-9]+\.[0-9]+$'
      AND p_slack_ts ~ '^[0-9]+\.[0-9]+$'
      AND CASE WHEN m.slack_ts ~ '^[0-9]+\.[0-9]+$' THEN m.slack_ts::numeric END <= CASE WHEN p_slack_ts ~ '^[0-9]+\.[0-9]+$' THEN p_slack_ts::numeric END
  ) read_through
  WHERE cm.channel_id = p_channel_id
    AND cm.member_id = p_member
    AND cm.left_at IS NULL
    AND read_through.at IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.chat_can_read_content(p_channel_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM chat_channels c
    WHERE c.id = p_channel_id
      AND (
        chat_is_channel_member(c.id)
        OR (c.visibility = 'public' AND (SELECT current_member_id()) IS NOT NULL)
        OR (NOT c.restricted AND (SELECT is_admin()))
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.chat_can_see_channel(p_channel_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (SELECT is_admin())
      OR EXISTS (
        SELECT 1 FROM chat_channels c
        WHERE c.id = p_channel_id
          AND (
            (c.visibility = 'public' AND (SELECT current_member_id()) IS NOT NULL)
            OR chat_is_channel_member(c.id)
          )
      );
$function$;

CREATE OR REPLACE FUNCTION public.chat_claim_slack_read_pull(p_member text, p_min_seconds integer)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH claimed AS (
    UPDATE member_slack_connections
    SET read_pulled_at = now()
    WHERE member_id = p_member
      AND revoked_at IS NULL
      AND (read_pulled_at IS NULL OR read_pulled_at < now() - make_interval(secs => p_min_seconds))
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$function$;

CREATE OR REPLACE FUNCTION public.chat_is_channel_member(p_channel_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM chat_channel_members cm
    WHERE cm.channel_id = p_channel_id
      AND cm.member_id = (SELECT current_member_id())
      AND cm.left_at IS NULL
  );
$function$;

CREATE OR REPLACE FUNCTION public.chat_mark_message_failed(p_message_id text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE chat_messages SET slack_sync_status = 'failed'
  WHERE id = p_message_id AND origin = 'app' AND slack_sync_status = 'pending';
$function$;

CREATE OR REPLACE FUNCTION public.chat_mark_message_sent(p_message_id text, p_slack_ts text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_msg chat_messages%ROWTYPE;
  v_copy text;
  v_root text;
BEGIN
  SELECT * INTO v_msg FROM chat_messages WHERE id = p_message_id AND origin = 'app' FOR UPDATE;
  IF NOT FOUND OR v_msg.slack_sync_status = 'sent' THEN
    RETURN;
  END IF;

  SELECT id INTO v_copy FROM chat_messages
  WHERE channel_id = v_msg.channel_id AND slack_ts = p_slack_ts AND id <> p_message_id;
  IF v_copy IS NOT NULL THEN
    UPDATE chat_messages SET thread_root_id = p_message_id WHERE thread_root_id = v_copy;
    UPDATE chat_messages SET reply_count = (SELECT reply_count FROM chat_messages WHERE id = v_copy)
      WHERE id = p_message_id AND v_msg.thread_root_id IS NULL;
    DELETE FROM chat_messages WHERE id = v_copy;
  END IF;

  UPDATE chat_messages SET slack_ts = p_slack_ts, slack_sync_status = 'sent' WHERE id = p_message_id;

  v_root := v_msg.thread_root_id;
  IF v_root IS NOT NULL AND v_copy IS NOT NULL THEN
    UPDATE chat_messages root
    SET reply_count = s.n, last_reply_at = s.last_at
    FROM (
      SELECT count(*) FILTER (WHERE t.deleted_at IS NULL) AS n,
             max(t.created_at) FILTER (WHERE t.deleted_at IS NULL) AS last_at
      FROM chat_messages t WHERE t.thread_root_id = v_root
    ) s
    WHERE root.id = v_root;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_mark_read(p_channel_id text, p_through timestamp with time zone DEFAULT now())
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE chat_channel_members
  SET last_read_at = GREATEST(COALESCE(last_read_at, '-infinity'::timestamptz), LEAST(p_through, now()))
  WHERE channel_id = p_channel_id
    AND member_id = (SELECT current_member_id())
    AND left_at IS NULL;
$function$;

CREATE OR REPLACE FUNCTION public.chat_post_message(p_channel_id text, p_body text, p_thread_root_id text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member text := (SELECT current_member_id());
  v_channel chat_channels%ROWTYPE;
  -- btrim alone trims only spaces, so a message ending in a newline would keep it.
  v_body TEXT := btrim(COALESCE(p_body, ''), E' \t\r\n');
  v_root chat_messages%ROWTYPE;
  v_id text;
BEGIN
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'chat_post: no_member';
  END IF;

  SELECT * INTO v_channel FROM chat_channels WHERE id = p_channel_id;
  IF NOT FOUND OR NOT chat_is_channel_member(p_channel_id) THEN
    RAISE EXCEPTION 'chat_post: not_in_channel';
  END IF;
  IF v_channel.bridge_mode <> 'bridged' OR v_channel.bridge_disabled OR v_channel.bridge_status <> 'ok'
     OR v_channel.slack_channel_id IS NULL THEN
    RAISE EXCEPTION 'chat_post: not_bridged';
  END IF;
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'chat_post: archived';
  END IF;
  IF v_body = '' THEN
    RAISE EXCEPTION 'chat_post: empty';
  END IF;
  IF char_length(v_body) > 4000 THEN
    RAISE EXCEPTION 'chat_post: too_long';
  END IF;

  IF p_thread_root_id IS NOT NULL THEN
    SELECT * INTO v_root FROM chat_messages WHERE id = p_thread_root_id AND channel_id = p_channel_id;
    -- One level of threading, like Slack; and the root has to exist in Slack to be replied to.
    IF NOT FOUND OR v_root.thread_root_id IS NOT NULL OR v_root.deleted_at IS NOT NULL OR v_root.slack_ts IS NULL THEN
      RAISE EXCEPTION 'chat_post: bad_thread';
    END IF;
  END IF;

  INSERT INTO chat_messages (channel_id, author_member_id, thread_root_id, origin, created_at, slack_sync_status, posted_via)
  VALUES (p_channel_id, v_member, p_thread_root_id, 'app', now(), 'pending', 'bot')
  RETURNING id INTO v_id;

  INSERT INTO chat_message_contents (message_id, body) VALUES (v_id, v_body);

  IF p_thread_root_id IS NOT NULL THEN
    UPDATE chat_messages SET reply_count = reply_count + 1, last_reply_at = now() WHERE id = p_thread_root_id;
  END IF;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_toggle_reaction(p_message_id text, p_emoji text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member text := (SELECT current_member_id());
  v_channel chat_channels%ROWTYPE;
  v_message chat_messages%ROWTYPE;
  v_existing chat_reactions%ROWTYPE;
  v_has_hub_row BOOLEAN;
  v_has_live_slack BOOLEAN;
BEGIN
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'chat_react: no_member';
  END IF;
  -- A Slack shortcode: lower-case letters, digits and _ + -, with an optional skin tone.
  IF p_emoji IS NULL OR p_emoji !~ '^[a-z0-9_+-]{1,64}(::skin-tone-[2-6])?$' THEN
    RAISE EXCEPTION 'chat_react: bad_emoji';
  END IF;

  SELECT * INTO v_message FROM chat_messages WHERE id = p_message_id;
  IF NOT FOUND OR v_message.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'chat_react: no_message';
  END IF;
  SELECT * INTO v_channel FROM chat_channels WHERE id = v_message.channel_id;
  -- The member's own conversations and public channels (an admin's wider read access doesn't count).
  IF NOT (v_channel.visibility = 'public' OR chat_is_channel_member(v_channel.id)) THEN
    RAISE EXCEPTION 'chat_react: no_message';
  END IF;
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'chat_react: archived';
  END IF;

  SELECT * INTO v_existing FROM chat_reactions
  WHERE message_id = p_message_id AND emoji = p_emoji AND member_id = v_member AND slack_user_id IS NULL
  FOR UPDATE;
  -- FOUND is overwritten by the next statement, so keep this answer.
  v_has_hub_row := FOUND;

  -- A reaction the member made in Slack is theirs too.
  SELECT EXISTS (
    SELECT 1 FROM chat_reactions
    WHERE message_id = p_message_id AND emoji = p_emoji AND member_id = v_member
      AND slack_user_id IS NOT NULL AND deleted_at IS NULL
  ) INTO v_has_live_slack;

  IF v_has_live_slack OR (v_has_hub_row AND v_existing.deleted_at IS NULL) THEN
    UPDATE chat_reactions SET deleted_at = now()
    WHERE message_id = p_message_id AND emoji = p_emoji AND member_id = v_member AND deleted_at IS NULL;
    RETURN false;
  END IF;

  IF NOT v_has_hub_row THEN
    INSERT INTO chat_reactions (message_id, member_id, emoji, created_at, synced_to_slack)
    VALUES (p_message_id, v_member, p_emoji, now(), false);
    RETURN true;
  END IF;
  UPDATE chat_reactions SET deleted_at = NULL, created_at = now(), synced_to_slack = false WHERE id = v_existing.id;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_unread_counts()
 RETURNS TABLE(channel_id text, unread integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT counted.channel_id, counted.unread
  FROM (
    SELECT cm.channel_id,
      (
        SELECT count(*)::int FROM (
          SELECT 1 FROM chat_messages m
          WHERE m.channel_id = cm.channel_id
            AND m.thread_root_id IS NULL
            AND m.deleted_at IS NULL
            AND m.created_at > COALESCE(cm.last_read_at, cm.joined_at)
            AND m.author_member_id IS DISTINCT FROM cm.member_id
          LIMIT 100
        ) capped
      ) AS unread
    FROM chat_channel_members cm
    JOIN chat_channels c ON c.id = cm.channel_id AND c.archived_at IS NULL
    WHERE cm.member_id = (SELECT current_member_id()) AND cm.left_at IS NULL
  ) counted
  WHERE counted.unread > 0;
$function$;

CREATE OR REPLACE FUNCTION public.check_prickle_commitment_slot_overlap(p_commitment_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_member_id text;
  v_conflict text;
BEGIN
  SELECT member_id INTO v_member_id FROM prickle_commitments WHERE id = p_commitment_id AND status = 'active';
  IF v_member_id IS NULL THEN
    RETURN; -- cancelled/completed commitments never conflict
  END IF;

  -- Serialize concurrent writes for the same member, so two overlapping inserts can't both pass.
  PERFORM pg_advisory_xact_lock(hashtextextended('prickle_commitments:' || v_member_id::text, 0));

  SELECT other.id INTO v_conflict
  FROM prickle_commitments mine
  JOIN prickle_commitment_slots ms ON ms.commitment_id = mine.id
  JOIN prickle_commitment_slots os
    ON os.type_id = ms.type_id
   AND os.day_of_week = ms.day_of_week
   AND os.start_time_local = ms.start_time_local
   AND os.timezone = ms.timezone
  JOIN prickle_commitments other ON other.id = os.commitment_id
  WHERE mine.id = p_commitment_id
    AND other.id <> mine.id
    AND other.member_id = mine.member_id
    AND other.status = 'active'
    AND other.start_date <= mine.end_date
    AND mine.start_date <= other.end_date
  LIMIT 1;

  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'Already committed to this slot for overlapping weeks (commitment %)', v_conflict
      USING ERRCODE = 'unique_violation';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.count_activity_feed(p_audit_only boolean DEFAULT false, p_kinds text[] DEFAULT NULL::text[], p_actor_user_id uuid DEFAULT NULL::uuid, p_member_id text DEFAULT NULL::text, p_sudo_only boolean DEFAULT false, p_from timestamp with time zone DEFAULT (now() - '30 days'::interval), p_to timestamp with time zone DEFAULT (now() + '00:01:00'::interval), p_session_gap_minutes integer DEFAULT 30, p_entity_types text[] DEFAULT NULL::text[], p_hide_system boolean DEFAULT false, p_hide_slack boolean DEFAULT false)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT CASE WHEN NOT is_admin() THEN 0 ELSE (
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
$function$;

CREATE OR REPLACE FUNCTION public.create_prickle_commitment(p_member_id text, p_start_date date, p_weeks smallint, p_slots jsonb, p_created_by uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id text;
BEGIN
  IF p_slots IS NULL OR jsonb_typeof(p_slots) <> 'array' OR jsonb_array_length(p_slots) = 0 THEN
    RAISE EXCEPTION 'A commitment needs at least one slot' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO prickle_commitments (member_id, start_date, weeks, status, created_by)
  VALUES (p_member_id, p_start_date, p_weeks, 'active', p_created_by)
  RETURNING id INTO v_id;

  INSERT INTO prickle_commitment_slots (commitment_id, type_id, day_of_week, start_time_local, timezone)
  SELECT v_id, (s ->> 'type_id'), (s ->> 'day_of_week')::smallint, (s ->> 'start_time_local')::time, s ->> 'timezone'
  FROM jsonb_array_elements(p_slots) AS s;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.current_acting_as_member_id()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       OR parts[2] !~ '^mbr_[1-9A-HJ-NP-Za-km-z]{12}$' THEN
        RETURN NULL;
    END IF;
    IF NOT is_admin() THEN
        RETURN NULL;
    END IF;
    RETURN parts[2];
END;
$function$;

CREATE OR REPLACE FUNCTION public.current_member_id()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id FROM members
  WHERE user_id = (SELECT auth.uid())
     OR email = (SELECT auth.jwt() ->> 'email')
  ORDER BY (user_id IS NOT DISTINCT FROM (SELECT auth.uid())) DESC, id
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.find_pending_invite(p_email text)
 RETURNS TABLE(user_id uuid, invited_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT u.id, u.invited_at
  FROM auth.users u
  WHERE lower(u.email) = lower(trim(p_email))
    AND u.invited_at IS NOT NULL
    AND u.email_confirmed_at IS NULL
    AND u.deleted_at IS NULL
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_access_sessions(target_user_id uuid, session_gap_minutes integer DEFAULT 30, event_limit integer DEFAULT 2000)
 RETURNS TABLE(session_start timestamp with time zone, session_end timestamp with time zone, event_count integer, pages jsonb, auth_session_id uuid, session_active boolean, auth_session_created_at timestamp with time zone, user_agent text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    WITH recent_events AS (
        SELECT path, is_page, session_id, user_agent, created_at
        FROM access_events
        WHERE user_id = target_user_id
        ORDER BY created_at DESC
        LIMIT event_limit
    ),
    gapped AS (
        SELECT
            path,
            is_page,
            session_id,
            user_agent,
            created_at,
            created_at - LAG(created_at) OVER (ORDER BY created_at) AS gap
        FROM recent_events
    ),
    grouped AS (
        SELECT
            path,
            is_page,
            session_id,
            user_agent,
            created_at,
            COUNT(*) FILTER (
                WHERE gap IS NULL OR gap > make_interval(mins => session_gap_minutes)
            ) OVER (ORDER BY created_at) AS session_num
        FROM gapped
    ),
    session_groups AS (
        SELECT
            MIN(created_at) AS session_start,
            MAX(created_at) AS session_end,
            COUNT(*)::integer AS event_count,
            jsonb_agg(path ORDER BY created_at) FILTER (WHERE is_page) AS pages,
            -- Most recent non-null session_id seen in this group — a group
            -- can span a token refresh (same session_id) but should never
            -- span two different real logins given the 30-min gap already
            -- splits those into separate groups.
            (array_agg(session_id ORDER BY created_at DESC) FILTER (WHERE session_id IS NOT NULL))[1] AS auth_session_id,
            -- Most recent user agent in the visit. Rows from before this
            -- column existed have none, so older visits return NULL.
            (array_agg(user_agent ORDER BY created_at DESC) FILTER (WHERE user_agent IS NOT NULL))[1] AS user_agent
        FROM grouped
        GROUP BY session_num
    )
    SELECT
        sg.session_start,
        sg.session_end,
        sg.event_count,
        sg.pages,
        sg.auth_session_id,
        (s.id IS NOT NULL) AS session_active,
        s.created_at AS auth_session_created_at,
        sg.user_agent
    FROM session_groups sg
    LEFT JOIN auth.sessions s ON s.id = sg.auth_session_id
    ORDER BY sg.session_start DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_activity_feed(p_audit_only boolean DEFAULT false, p_kinds text[] DEFAULT NULL::text[], p_actor_user_id uuid DEFAULT NULL::uuid, p_member_id text DEFAULT NULL::text, p_sudo_only boolean DEFAULT false, p_from timestamp with time zone DEFAULT (now() - '30 days'::interval), p_to timestamp with time zone DEFAULT (now() + '00:01:00'::interval), p_offset integer DEFAULT 0, p_limit integer DEFAULT 50, p_session_gap_minutes integer DEFAULT 30, p_entity_types text[] DEFAULT NULL::text[], p_hide_system boolean DEFAULT false, p_hide_slack boolean DEFAULT false)
 RETURNS TABLE(event_id text, kind text, occurred_at timestamp with time zone, is_audit boolean, actor_user_id uuid, actor_kind text, actor_label text, member_id text, member_name text, acting_as_member_id text, acting_as_member_name text, event_type text, entity_type text, entity_id text, title text, description text, source text, data jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.get_hosted_prickle_attendance(p_host_id text, p_started_before timestamp with time zone DEFAULT now())
 RETURNS TABLE(prickle_id text, start_time timestamp with time zone, end_time timestamp with time zone, type_name text, host_earliest_join timestamp with time zone, attendee_count integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT
        p.id,
        p.start_time,
        p.end_time,
        pt.name,
        MIN(pa.join_time) FILTER (WHERE pa.member_id = p_host_id),
        COUNT(DISTINCT pa.member_id)::INTEGER
    FROM prickles p
    LEFT JOIN prickle_types pt ON pt.id = p.type_id
    LEFT JOIN prickle_attendance pa ON pa.prickle_id = p.id
    WHERE p.host = p_host_id
      AND p.start_time <= p_started_before
    GROUP BY p.id, p.start_time, p.end_time, pt.name
    -- Deterministic order so callers can page with .range() past PostgREST's max-rows cap.
    ORDER BY p.start_time, p.id;
$function$;

CREATE OR REPLACE FUNCTION public.get_member_directory()
 RETURNS TABLE(id text, name text, display_name text, photo_url text, bio text, first_joined_at date, projects text[], topics text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    d.id, d.name, d.display_name, d.photo_url, d.bio, d.first_joined_at,
    COALESCE((
      SELECT array_agg(p.title ORDER BY p.created_at)
      FROM public.writing_projects p
      WHERE p.member_id = d.id
        AND p.show_on_profile
        AND p.archived_at IS NULL
        AND p.phase NOT IN ('complete', 'abandoned')
    ), '{}'::TEXT[]) AS projects,
    COALESCE(a.topics, '{}'::TEXT[]) AS topics
  FROM public.members m
  JOIN public.member_directory d ON d.id = m.id
  LEFT JOIN public.member_ask_me_about a ON a.member_id = m.id
  WHERE m.status IN ('active', 'on_hiatus')
    AND (SELECT auth.uid()) IS NOT NULL
  ORDER BY d.id;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_sessions()
 RETURNS TABLE(id uuid, created_at timestamp with time zone, updated_at timestamp with time zone, refreshed_at timestamp with time zone, not_after timestamp with time zone, user_agent text, ip text, is_current boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
    SELECT
        s.id,
        s.created_at,
        s.updated_at,
        s.refreshed_at,
        s.not_after,
        s.user_agent,
        host(s.ip) AS ip,
        s.id = (auth.jwt() ->> 'session_id')::uuid AS is_current
    FROM auth.sessions s
    WHERE s.user_id = auth.uid()
    ORDER BY COALESCE(s.refreshed_at, s.updated_at, s.created_at) DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_profile_writing(p_member_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH shown_projects AS (
    SELECT p.id, p.title
    FROM public.writing_projects p
    WHERE p.member_id = p_member_id AND p.show_on_profile AND p.archived_at IS NULL
  ),
  shown_goals AS (
    SELECT g.id, g.project_id, p.title AS project_title, g.goal_type, g.measure, g.target_amount,
           g.start_date, g.end_date, g.habit_period, g.habit_threshold, g.title, g.description
    FROM public.writing_goals g
    JOIN public.writing_projects p ON p.id = g.project_id AND p.archived_at IS NULL
    WHERE g.member_id = p_member_id AND g.show_on_profile AND g.archived_at IS NULL
  ),
  measured_projects AS (
    SELECT id FROM shown_projects
    UNION
    SELECT project_id FROM shown_goals
  )
  SELECT CASE WHEN auth.uid() IS NULL THEN NULL ELSE jsonb_build_object(
    'projects', COALESCE((SELECT jsonb_agg(to_jsonb(sp)) FROM shown_projects sp), '[]'::jsonb),
    'goals', COALESCE((SELECT jsonb_agg(to_jsonb(sg)) FROM shown_goals sg), '[]'::jsonb),
    'entries', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'project_id', e.project_id, 'entry_date', e.entry_date, 'measure', e.measure,
        'mode', e.mode, 'amount', e.amount, 'created_at', e.created_at))
      FROM public.writing_progress_entries e
      WHERE e.member_id = p_member_id AND e.project_id IN (SELECT id FROM measured_projects)
    ), '[]'::jsonb),
    'starting_balances', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('project_id', b.project_id, 'measure', b.measure, 'amount', b.amount))
      FROM public.writing_project_starting_balances b
      WHERE b.member_id = p_member_id AND b.project_id IN (SELECT id FROM shown_projects)
    ), '[]'::jsonb)
  ) END;
$function$;

CREATE OR REPLACE FUNCTION public.get_recent_login_sessions(from_date timestamp with time zone, to_date timestamp with time zone)
 RETURNS TABLE(session_id uuid, user_id uuid, email text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT s.id, s.user_id, u.email, s.created_at
    FROM auth.sessions s
    JOIN auth.users u ON u.id = s.user_id
    WHERE s.created_at >= from_date AND s.created_at < to_date;
$function$;

CREATE OR REPLACE FUNCTION public.get_record_history(p_entity_types text[], p_entity_id text DEFAULT NULL::text, p_limit integer DEFAULT 200, p_parent_column text DEFAULT NULL::text, p_member_rows boolean DEFAULT false)
 RETURNS TABLE(event_id text, kind text, occurred_at timestamp with time zone, is_audit boolean, actor_user_id uuid, actor_kind text, actor_label text, member_id text, member_name text, acting_as_member_id text, acting_as_member_name text, event_type text, entity_type text, entity_id text, title text, description text, source text, data jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT
        'audit:' || a.id,
        'audit'::text,
        a.occurred_at,
        (a.actor_kind <> 'member' OR a.acting_as_member_id IS NOT NULL),
        a.changed_by,
        a.actor_kind,
        COALESCE(am.name, up.email, CASE WHEN a.actor_kind = 'member' THEN mem.name END),
        a.member_id,
        mem.name,
        a.acting_as_member_id,
        aam.name,
        a.action,
        a.entity_type,
        a.entity_id,
        a.comment,
        a.entity_label,
        'audit_log'::text,
        a.changes
    FROM audit_log a
    LEFT JOIN user_profiles up ON up.id = a.changed_by
    LEFT JOIN members am ON am.user_id = a.changed_by
    LEFT JOIN members mem ON mem.id = a.member_id
    LEFT JOIN members aam ON aam.id = a.acting_as_member_id
    WHERE (a.entity_type = ANY (p_entity_types) OR (p_member_rows AND p_entity_id IS NOT NULL))
      AND (
          p_entity_id IS NULL
          OR (a.entity_type = ANY (p_entity_types) AND a.entity_id = p_entity_id)
          -- a child record (an event's attendee, a badge's level) names its parent in a column of its delta
          OR (p_parent_column IS NOT NULL AND a.entity_type = ANY (p_entity_types)
              AND (a.changes -> p_parent_column ->> 'new' = p_entity_id OR a.changes -> p_parent_column ->> 'old' = p_entity_id))
          -- an enrollment names its cohort, not the program: reach the program through the cohort
          OR (p_parent_column = 'program_id' AND a.entity_type = 'program_enrollment' AND a.entity_type = ANY (p_entity_types)
              AND (a.changes -> 'cohort_id' ->> 'new' IN (SELECT c.id::text FROM program_cohorts c WHERE c.program_id::text = p_entity_id)
                   OR a.changes -> 'cohort_id' ->> 'old' IN (SELECT c.id::text FROM program_cohorts c WHERE c.program_id::text = p_entity_id)))
          -- everything about a member: rows whose subject is them (their record, aliases, hiatus, overrides...)
          OR (p_member_rows AND a.member_id::text = p_entity_id)
      )
      AND is_admin()
    ORDER BY a.occurred_at DESC, a.id DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 500);
$function$;

CREATE OR REPLACE FUNCTION public.has_course_access(p_course_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.course_access ca
    WHERE ca.course_id = p_course_id
      AND ca.member_id = public.current_member_id()
      AND ca.starts_at <= now()
      AND (ca.ends_at IS NULL OR ca.ends_at > now())
  );
$function$;

CREATE OR REPLACE FUNCTION public.match_member_by_name(zoom_name text, zoom_email text DEFAULT NULL::text)
 RETURNS TABLE(member_id text, confidence text, match_type text)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    normalized_zoom_name TEXT;
BEGIN
    -- 1. Email match (highest confidence)
    IF zoom_email IS NOT NULL THEN
        RETURN QUERY
        SELECT m.id, 'high'::TEXT, 'email'::TEXT
        FROM members m
        WHERE m.email = LOWER(zoom_email)
        LIMIT 1;

        IF FOUND THEN
            RETURN;
        END IF;
    END IF;

    -- 2. Exact alias match (active only)
    RETURN QUERY
    SELECT a.member_id, 'high'::TEXT, 'alias'::TEXT
    FROM member_name_aliases a
    WHERE a.alias = zoom_name AND a.active
    LIMIT 1;

    IF FOUND THEN
        RETURN;
    END IF;

    -- Normalize the zoom name for remaining matches
    normalized_zoom_name := normalize_name(zoom_name);

    -- 3. Normalized name match
    RETURN QUERY
    SELECT m.id, 'high'::TEXT, 'normalized'::TEXT
    FROM members m
    WHERE normalize_name(m.name) = normalized_zoom_name
    LIMIT 1;

    IF FOUND THEN
        RETURN;
    END IF;

    -- 4. Fuzzy match using trigram similarity
    RETURN QUERY
    SELECT
        m.id,
        CASE
            WHEN similarity(normalize_name(m.name), normalized_zoom_name) >= 0.6 THEN 'medium'::TEXT
            ELSE 'low'::TEXT
        END as confidence,
        'fuzzy'::TEXT as match_type
    FROM members m
    WHERE similarity(normalize_name(m.name), normalized_zoom_name) >= 0.4
    ORDER BY similarity(normalize_name(m.name), normalized_zoom_name) DESC
    LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mentorship_counts()
 RETURNS TABLE(member_id text, mentored_count integer, first_started_on date, last_started_on date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT m.mentor_member_id, count(*)::integer, min(m.started_on), max(m.started_on)
    FROM mentorships m
   WHERE m.status = 'matched' AND m.started_on <= current_date
   GROUP BY m.mentor_member_id;
$function$;

CREATE OR REPLACE FUNCTION public.my_mentorships(p_member_id text)
 RETURNS TABLE(mentorship_id uuid, viewer_role text, other_member_id text, other_name text, other_display_name text, other_photo_url text, started_on date, trial_ends_on date, kind text, outcome_note text, other_status text, other_first_joined_at date, other_most_recent_joined_at date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    m.id,
    CASE WHEN m.mentor_member_id = p_member_id THEN 'big_sister' ELSE 'new_member' END,
    o.id, o.name, o.display_name, o.photo_url,
    m.started_on, m.trial_ends_on, m.kind,
    CASE WHEN m.mentor_member_id = p_member_id THEN m.outcome_note END,
    CASE WHEN m.mentor_member_id = p_member_id THEN o.status END,
    CASE WHEN m.mentor_member_id = p_member_id THEN o.first_joined_at END,
    CASE WHEN m.mentor_member_id = p_member_id THEN o.most_recent_joined_at END
  FROM mentorships m
  JOIN members o ON o.id = CASE WHEN m.mentor_member_id = p_member_id THEN m.new_member_id ELSE m.mentor_member_id END
  WHERE m.status = 'matched'
    AND (m.mentor_member_id = p_member_id OR m.new_member_id = p_member_id)
    AND (p_member_id = current_member_id() OR is_admin())
  ORDER BY m.started_on DESC;
$function$;

CREATE OR REPLACE FUNCTION public.remove_event_attendee(p_event_id text, p_member_id text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  DELETE FROM event_attendees WHERE event_id = p_event_id AND member_id = p_member_id;
  DELETE FROM member_badges WHERE event_id = p_event_id AND member_id = p_member_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_my_session(target_session_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    deleted_count integer;
BEGIN
    DELETE FROM auth.sessions
    WHERE id = target_session_id
      AND user_id = auth.uid();

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count > 0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_user_sessions(target_user_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    DELETE FROM auth.sessions WHERE user_id = target_user_id;
$function$;

CREATE OR REPLACE FUNCTION public.search_chat_messages(p_query text, p_channel_ids text[], p_author_member_ids text[] DEFAULT NULL::text[], p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_has_files boolean DEFAULT NULL::boolean, p_in_thread boolean DEFAULT NULL::boolean, p_has_link boolean DEFAULT NULL::boolean, p_has_reaction boolean DEFAULT NULL::boolean, p_limit integer DEFAULT 21, p_offset integer DEFAULT 0)
 RETURNS TABLE(message_id text, rank real)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH q AS (SELECT CASE WHEN btrim(COALESCE(p_query, '')) = '' THEN NULL ELSE to_tsquery('english', p_query) END AS tsq)
  SELECT m.id, CASE WHEN q.tsq IS NULL THEN 0::real ELSE ts_rank(c.search_vector, q.tsq) END
  FROM q
  JOIN public.chat_message_contents c ON q.tsq IS NULL OR c.search_vector @@ q.tsq
  JOIN public.chat_messages m ON m.id = c.message_id
  WHERE m.deleted_at IS NULL
    AND m.channel_id = ANY (p_channel_ids)
    AND (p_author_member_ids IS NULL OR m.author_member_id = ANY (p_author_member_ids))
    AND (p_from IS NULL OR m.created_at >= p_from)
    AND (p_to IS NULL OR m.created_at < p_to)
    AND (p_has_files IS NULL OR m.has_files = p_has_files)
    AND (p_in_thread IS NULL OR (m.thread_root_id IS NOT NULL) = p_in_thread)
    AND (p_has_link IS NULL OR c.body ~ '<https?://')
    AND (p_has_reaction IS NULL OR EXISTS (
      SELECT 1 FROM public.chat_reactions r WHERE r.message_id = m.id AND r.deleted_at IS NULL
    ))
  ORDER BY 2 DESC, m.created_at DESC, m.id
  LIMIT LEAST(GREATEST(p_limit, 1), 101)
  OFFSET GREATEST(p_offset, 0);
$function$;

CREATE OR REPLACE FUNCTION public.set_mentorship_note(p_mentorship_id uuid, p_note text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  updated INTEGER;
BEGIN
  IF p_note IS NOT NULL AND char_length(p_note) > 1000 THEN
    RAISE EXCEPTION 'note too long' USING ERRCODE = '22001';
  END IF;
  UPDATE mentorships
     SET outcome_note = NULLIF(btrim(p_note), '')
   WHERE id = p_mentorship_id
     AND status = 'matched'
     AND (mentor_member_id = current_member_id() OR is_admin());
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.slack_connection_delete_secrets(p_member text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  DELETE FROM vault.secrets
  WHERE id IN (
    SELECT unnest(ARRAY[access_secret_id, refresh_secret_id])
    FROM public.member_slack_connections WHERE member_id = p_member
  );
$function$;

CREATE OR REPLACE FUNCTION public.slack_connection_revoke(p_member text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.slack_connection_delete_secrets(p_member);
  UPDATE public.member_slack_connections
  SET revoked_at = now(), access_secret_id = NULL, refresh_secret_id = NULL, expires_at = NULL
  WHERE member_id = p_member AND revoked_at IS NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.slack_connection_save(p_member text, p_slack_user_id text, p_team_id text, p_scopes text[], p_access_token text, p_refresh_token text, p_expires_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_access UUID;
  v_refresh UUID;
BEGIN
  PERFORM public.slack_connection_delete_secrets(p_member);
  v_access := vault.create_secret(p_access_token, NULL, 'Slack user token for member ' || p_member);
  IF p_refresh_token IS NOT NULL THEN
    v_refresh := vault.create_secret(p_refresh_token, NULL, 'Slack refresh token for member ' || p_member);
  END IF;

  INSERT INTO public.member_slack_connections AS c
    (member_id, slack_user_id, team_id, scopes, access_secret_id, refresh_secret_id, expires_at, connected_at, revoked_at)
  VALUES (p_member, p_slack_user_id, p_team_id, COALESCE(p_scopes, '{}'), v_access, v_refresh, p_expires_at, now(), NULL)
  ON CONFLICT (member_id) DO UPDATE SET
    slack_user_id     = EXCLUDED.slack_user_id,
    team_id           = EXCLUDED.team_id,
    scopes            = EXCLUDED.scopes,
    access_secret_id  = EXCLUDED.access_secret_id,
    refresh_secret_id = EXCLUDED.refresh_secret_id,
    expires_at        = EXCLUDED.expires_at,
    connected_at      = now(),
    revoked_at        = NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.slack_connection_tokens(p_member text)
 RETURNS TABLE(slack_user_id text, access_token text, refresh_token text, expires_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT c.slack_user_id, a.decrypted_secret, r.decrypted_secret, c.expires_at
  FROM public.member_slack_connections c
  JOIN vault.decrypted_secrets a ON a.id = c.access_secret_id
  LEFT JOIN vault.decrypted_secrets r ON r.id = c.refresh_secret_id
  WHERE c.member_id = p_member AND c.revoked_at IS NULL;
$function$;

CREATE OR REPLACE FUNCTION public.slack_connection_update_tokens(p_member text, p_access_token text, p_refresh_token text, p_expires_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.member_slack_connections%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.member_slack_connections WHERE member_id = p_member AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  PERFORM vault.update_secret(c.access_secret_id, p_access_token);
  IF p_refresh_token IS NOT NULL THEN
    IF c.refresh_secret_id IS NULL THEN
      UPDATE public.member_slack_connections
      SET refresh_secret_id = vault.create_secret(p_refresh_token, NULL, 'Slack refresh token for member ' || p_member)
      WHERE member_id = p_member;
    ELSE
      PERFORM vault.update_secret(c.refresh_secret_id, p_refresh_token);
    END IF;
  END IF;
  UPDATE public.member_slack_connections SET expires_at = p_expires_at WHERE member_id = p_member;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_event_badge_awards(p_event_id text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_badge_type_id text;
  v_starts_at DATE;
BEGIN
  SELECT bt.id, e.starts_at INTO v_badge_type_id, v_starts_at
  FROM events e
  JOIN badge_types bt ON bt.event_id = e.id
  WHERE e.id = p_event_id;

  IF v_badge_type_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO member_badges (member_id, badge_type_id, occurred_at, event_id)
  SELECT ea.member_id, v_badge_type_id, v_starts_at, p_event_id
  FROM event_attendees ea
  WHERE ea.event_id = p_event_id
    AND NOT EXISTS (
      SELECT 1 FROM member_badges mb WHERE mb.event_id = p_event_id AND mb.member_id = ea.member_id
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_ambiguous_zoom_name(p_zoom_name text, p_zoom_email text, p_candidate_member_ids text[], p_occurrence_increment integer DEFAULT 1)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_id UUID;
BEGIN
  -- Insert or update the record
  INSERT INTO public.ambiguous_zoom_names (
    zoom_name,
    zoom_email,
    candidate_member_ids,
    first_seen_at,
    last_seen_at,
    occurrence_count,
    status
  ) VALUES (
    p_zoom_name,
    p_zoom_email,
    p_candidate_member_ids,
    now(),
    now(),
    p_occurrence_increment,
    'unresolved'
  )
  ON CONFLICT (zoom_name, zoom_email)
  DO UPDATE SET
    last_seen_at = now(),
    occurrence_count = ambiguous_zoom_names.occurrence_count + p_occurrence_increment,
    candidate_member_ids = p_candidate_member_ids, -- Update in case membership changed
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.audit_entity_label(entity text, subject jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    SELECT left(COALESCE(
        CASE entity
            WHEN 'member_badge' THEN (SELECT b.name FROM badge_types b WHERE b.id = (subject ->> 'badge_type_id'))
            WHEN 'event_attendee' THEN (SELECT e.title FROM events e WHERE e.id = (subject ->> 'event_id'))
            WHEN 'event_photo' THEN (SELECT e.title FROM events e WHERE e.id = (subject ->> 'event_id'))
            WHEN 'segment_member' THEN (SELECT s.name FROM segments s WHERE s.id = (subject ->> 'segment_id'))
            WHEN 'feature_flag' THEN subject ->> 'feature_key'
            WHEN 'user_feature_preview' THEN subject ->> 'feature_key'
            WHEN 'feature_flag_segment' THEN
                concat_ws(' · ', subject ->> 'feature_key', (SELECT s.name FROM segments s WHERE s.id = (subject ->> 'segment_id')))
            WHEN 'program_cohort' THEN
                concat_ws(' · ', (SELECT p.name FROM programs p WHERE p.id = (subject ->> 'program_id')), subject ->> 'name')
            WHEN 'program_enrollment' THEN
                (SELECT concat_ws(' · ', p.name, c.name) FROM program_cohorts c JOIN programs p ON p.id = c.program_id
                  WHERE c.id = (subject ->> 'cohort_id')::uuid)
            WHEN 'prickle_schedule' THEN
                concat_ws(' · ', (SELECT t.name FROM prickle_types t WHERE t.id = (subject ->> 'type_id')), subject ->> 'month')
            WHEN 'prickle_host_vibe' THEN (SELECT t.name FROM prickle_types t WHERE t.id = (subject ->> 'type_id'))
            WHEN 'user_profile' THEN subject ->> 'email'
            WHEN 'member_email_alias' THEN subject ->> 'alias_email'
            WHEN 'member_status_override' THEN subject ->> 'override_type'
            WHEN 'ignored_slack_user' THEN subject ->> 'user_id'
        END,
        NULLIF(subject ->> 'title', ''), NULLIF(subject ->> 'name', ''),
        NULLIF(subject ->> 'alias', ''), NULLIF(subject ->> 'award_name', '')), 120);
$function$;

CREATE OR REPLACE FUNCTION public.audit_row_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    mid       text;
    label     text;
    eid       text;
    prev      record;
    merged    jsonb;
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
    label := audit_entity_label(TG_ARGV[0], subject);

    IF TG_ARGV[0] = 'member' THEN
        mid := (subject ->> 'id');
    ELSIF subject ? 'member_id' THEN
        mid := (subject ->> 'member_id');
    ELSIF subject ? 'spinner_member_id' THEN
        mid := (subject ->> 'spinner_member_id');
    END IF;

    kind := CASE
        WHEN uid IS NULL THEN 'system'
        WHEN EXISTS (
            SELECT 1 FROM user_profiles WHERE id = uid AND role IN ('admin', 'assistant')
        ) THEN 'staff'
        ELSE 'member'
    END;

    eid := array_to_string(pk_parts, ':');

    -- Record a transaction's net effect on a row, not every step. A pipeline that writes a row
    -- more than once in one transaction (reprocess_members_atomic sets the Kajabi-derived status,
    -- then re-applies lifetime/hiatus/cohort overrides) would otherwise log a flip and its
    -- restore, which is churn: fold this change into that transaction's earlier row for the
    -- record, and drop the row entirely if it all nets out to nothing.
    IF TG_OP = 'UPDATE' THEN
        SELECT id, action, changes INTO prev FROM audit_log
         WHERE txid = txid_current() AND entity_type = TG_ARGV[0] AND entity_id = eid
           AND action IN ('insert', 'update') AND changed_by IS NOT DISTINCT FROM uid
           AND acting_as_member_id IS NOT DISTINCT FROM current_acting_as_member_id()
         ORDER BY id DESC LIMIT 1;
        IF FOUND THEN
            merged := prev.changes;
            FOR col IN SELECT jsonb_object_keys(delta) LOOP
                IF merged ? col THEN
                    merged := jsonb_set(merged, ARRAY[col, 'new'], delta -> col -> 'new');
                    -- A redacted column reads "[redacted]" on both sides whatever happened to it, so
                    -- it can't be shown to have reverted; keep it rather than hide a real change.
                    IF prev.action = 'update' AND (merged -> col -> 'old') = (merged -> col -> 'new')
                       AND (merged -> col -> 'old') <> '"[redacted]"'::jsonb THEN
                        merged := merged - col;
                    END IF;
                ELSIF prev.action = 'insert' THEN
                    merged := merged || jsonb_build_object(col, jsonb_build_object('old', NULL, 'new', delta -> col -> 'new'));
                ELSE
                    merged := merged || jsonb_build_object(col, delta -> col);
                END IF;
            END LOOP;
            IF prev.action = 'update' AND merged = '{}'::jsonb THEN
                DELETE FROM audit_log WHERE id = prev.id;
            ELSE
                UPDATE audit_log SET changes = merged, entity_label = COALESCE(label, entity_label) WHERE id = prev.id;
            END IF;
            RETURN NEW;
        END IF;
    END IF;

    INSERT INTO audit_log (changed_by, actor_kind, acting_as_member_id, entity_type, entity_id, action, changes, member_id, entity_label)
    VALUES (uid, kind, current_acting_as_member_id(), TG_ARGV[0], eid, lower(TG_OP), delta, mid, label);

    RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  claims jsonb := event -> 'claims';
  user_role text;
BEGIN
  BEGIN
    SELECT p.role INTO user_role
    FROM public.user_profiles AS p
    WHERE p.id = (event ->> 'user_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    -- A hook error blocks sign-in and token refresh for everyone. Never do that over a hint:
    -- leave the claim out and let the proxy fall back to its DB read.
    RETURN event;
  END;

  -- No row → JSON null (to_jsonb(NULL) is SQL NULL, which jsonb_set would turn into a NULL event).
  claims := jsonb_set(claims, '{app_role}', COALESCE(to_jsonb(user_role), 'null'::jsonb));
  RETURN jsonb_set(event, '{claims}', claims);
END;
$function$;

CREATE OR REPLACE FUNCTION public.project_slack_chat_channels(user_member_map jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  channel_count INTEGER;
  member_count INTEGER;
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

  RETURN jsonb_build_object('channels', channel_count, 'members', member_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.project_slack_chat_message(p_channel_id text, p_message_ts text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_channel text;
  v_message text;
  v_in_bronze BOOLEAN := true;
  v_thread_ts TEXT;
  v_root text;
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

  -- Bronze doesn't have it. The chat may still know it (a message posted from the Hub through the
  -- bot isn't kept in Bronze): then its reactions are still worth projecting. Otherwise nothing to do.
  IF v_message IS NULL THEN
    v_in_bronze := false;
    SELECT id INTO v_message FROM chat_messages WHERE channel_id = v_channel AND slack_ts = p_message_ts;
    IF v_message IS NULL THEN
      RETURN jsonb_build_object('projected', false);
    END IF;
  END IF;

  IF v_in_bronze THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.project_slack_chat_messages(from_date timestamp with time zone, to_date timestamp with time zone, user_member_map jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
                AND EXISTS (SELECT 1 FROM members mm WHERE mm.id = (user_member_map->>m.user_id))
           THEN (user_member_map->>m.user_id) END,
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
                AND EXISTS (SELECT 1 FROM members mm WHERE mm.id = (user_member_map->>r.user_id))
           THEN (user_member_map->>r.user_id) END,
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
$function$;

CREATE OR REPLACE FUNCTION public.reprocess_members_atomic(new_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Step 1: Clean up stale duplicates created by previous email-change bug.
  -- Scenario: member X has (kajabi_id=ABC, email=old@x.com) and a stale dup Y
  -- has (kajabi_id=ABC, email=new@x.com) inserted by the old broken UPSERT.
  --
  -- For each such pair, we:
  --   a) Reassign Y's prickle_attendance and email aliases to X
  --   b) Delete Y so the UPDATE in Step 2 can safely set X's email to new@x.com.

  -- Step 1a: Reassign attendance from stale duplicates to the canonical member
  -- (the one whose email does NOT match the incoming data = still has old email)
  UPDATE prickle_attendance pa
  SET member_id = original.id
  FROM members stale
  JOIN members original
    ON original.kajabi_id = stale.kajabi_id
    AND original.id != stale.id
    AND original.email != stale.email  -- original still has old email
  JOIN jsonb_array_elements(new_data) nd ON TRUE
  WHERE pa.member_id = stale.id
    AND nd.value->>'kajabi_id' IS NOT NULL
    AND stale.kajabi_id = nd.value->>'kajabi_id'
    AND stale.email = nd.value->>'email';   -- stale has the NEW (incoming) email

  -- Step 1a': Same for email aliases.
  UPDATE member_email_aliases mea
  SET member_id = original.id
  FROM members stale
  JOIN members original
    ON original.kajabi_id = stale.kajabi_id
    AND original.id != stale.id
    AND original.email != stale.email
  JOIN jsonb_array_elements(new_data) nd ON TRUE
  WHERE mea.member_id = stale.id
    AND nd.value->>'kajabi_id' IS NOT NULL
    AND stale.kajabi_id = nd.value->>'kajabi_id'
    AND stale.email = nd.value->>'email';

  -- Step 1b: Now safe to delete the stale duplicate (no attendance left on it)
  DELETE FROM members m
  WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements(new_data) nd
    WHERE nd.value->>'kajabi_id' IS NOT NULL
      AND m.kajabi_id = nd.value->>'kajabi_id'
      AND m.email = nd.value->>'email'
  )
  AND EXISTS (
    SELECT 1 FROM members m2
    WHERE m2.kajabi_id = m.kajabi_id
      AND m2.id != m.id
  );

  -- Step 2-pre: Auto-alias the old email when a kajabi_id-matched member's
  -- email changes. Must run BEFORE Step 2 so m.email still holds the old
  -- value. If the old email was already an alias of someone else, it now
  -- belongs to this member (it was this member's own email).
  INSERT INTO member_email_aliases (member_id, canonical_email, alias_email, source)
  SELECT DISTINCT ON (lower(m.email))
    m.id,
    m.email,
    lower(m.email),
    'auto_detected'
  FROM members m
  JOIN jsonb_array_elements(new_data) nd(value)
    ON m.kajabi_id = nd.value->>'kajabi_id'
    AND nd.value->>'kajabi_id' IS NOT NULL
    AND lower(m.email) != lower(nd.value->>'email')
  ORDER BY lower(m.email), m.id
  ON CONFLICT (alias_email) DO UPDATE
    SET member_id = EXCLUDED.member_id;

  -- Step 2: Update existing members matched by kajabi_id (handles email changes).
  UPDATE members m
  SET
    email = nd.value->>'email',
    name = nd.value->>'name',
    joined_at = (nd.value->>'joined_at')::date,
    first_joined_at = (nd.value->>'first_joined_at')::date,
    most_recent_joined_at = (nd.value->>'most_recent_joined_at')::date,
    total_active_months = COALESCE((nd.value->>'total_active_months')::integer, 0),
    status = nd.value->>'status',
    is_trial = COALESCE((nd.value->>'is_trial')::boolean, false),
    has_trialed = COALESCE((nd.value->>'has_trialed')::boolean, false),
    plan = nd.value->>'plan',
    source = nd.value->>'source',
    staff_role = nd.value->>'staff_role',
    user_id = COALESCE((nd.value->>'user_id')::uuid, m.user_id),
    kajabi_id = nd.value->>'kajabi_id',
    stripe_customer_id = nd.value->>'stripe_customer_id',
    photo_url = nd.value->>'photo_url',
    bio = nd.value->>'bio',
    instagram_url = nd.value->>'instagram_url',
    facebook_url = nd.value->>'facebook_url',
    twitter_url = nd.value->>'twitter_url',
    kajabi_tags = ARRAY(SELECT jsonb_array_elements_text(COALESCE(nd.value->'kajabi_tags', '[]'::jsonb))),
    updated_at = NOW()
  FROM jsonb_array_elements(new_data) nd(value)
  WHERE m.kajabi_id = nd.value->>'kajabi_id'
    AND nd.value->>'kajabi_id' IS NOT NULL;

  -- Step 3: UPSERT remaining entries by email.
  -- Covers: staff members (kajabi_id IS NULL) and brand-new Kajabi contacts
  -- not yet present in the members table.
  INSERT INTO members (
    email, name, joined_at, first_joined_at, most_recent_joined_at, total_active_months,
    status, is_trial, has_trialed, plan, source, staff_role, user_id,
    kajabi_id, stripe_customer_id,
    photo_url, bio, instagram_url, facebook_url, twitter_url, kajabi_tags
  )
  SELECT
    value->>'email',
    value->>'name',
    (value->>'joined_at')::date,
    (value->>'first_joined_at')::date,
    (value->>'most_recent_joined_at')::date,
    COALESCE((value->>'total_active_months')::integer, 0),
    value->>'status',
    COALESCE((value->>'is_trial')::boolean, false),
    COALESCE((value->>'has_trialed')::boolean, false),
    value->>'plan',
    value->>'source',
    value->>'staff_role',
    (value->>'user_id')::uuid,
    value->>'kajabi_id',
    value->>'stripe_customer_id',
    value->>'photo_url',
    value->>'bio',
    value->>'instagram_url',
    value->>'facebook_url',
    value->>'twitter_url',
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(value->'kajabi_tags', '[]'::jsonb)))
  FROM jsonb_array_elements(new_data)
  WHERE value->>'kajabi_id' IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM members WHERE kajabi_id = value->>'kajabi_id'
     )
  ON CONFLICT (email) DO UPDATE SET
    name = EXCLUDED.name,
    joined_at = EXCLUDED.joined_at,
    first_joined_at = EXCLUDED.first_joined_at,
    most_recent_joined_at = EXCLUDED.most_recent_joined_at,
    total_active_months = EXCLUDED.total_active_months,
    status = EXCLUDED.status,
    is_trial = EXCLUDED.is_trial,
    has_trialed = EXCLUDED.has_trialed,
    plan = EXCLUDED.plan,
    source = EXCLUDED.source,
    staff_role = EXCLUDED.staff_role,
    user_id = COALESCE(EXCLUDED.user_id, members.user_id),
    kajabi_id = EXCLUDED.kajabi_id,
    stripe_customer_id = EXCLUDED.stripe_customer_id,
    photo_url = EXCLUDED.photo_url,
    bio = EXCLUDED.bio,
    instagram_url = EXCLUDED.instagram_url,
    facebook_url = EXCLUDED.facebook_url,
    twitter_url = EXCLUDED.twitter_url,
    kajabi_tags = EXCLUDED.kajabi_tags,
    updated_at = NOW();

  -- Step 4: Apply active gift/direct_stripe overrides — this is what makes
  -- them stick instead of being reverted by the Kajabi-derived status above
  -- on every run. 'special' is informational only (nothing branches on it
  -- for status purposes today). starts_at/expires_at are DATE (see this
  -- migration), so compared against current_date like hiatus/program cohorts.
  WITH active_override AS (
    SELECT DISTINCT ON (member_id) member_id, override_type
    FROM member_status_overrides
    WHERE override_type IN ('gift', 'direct_stripe')
      AND current_date BETWEEN starts_at AND COALESCE(expires_at, 'infinity'::date)
    ORDER BY member_id, starts_at DESC
  )
  UPDATE members m
  SET status = 'active', updated_at = NOW()
  FROM active_override ao
  WHERE ao.member_id = m.id
    AND m.status IS DISTINCT FROM 'active';

  -- Step 4a: A currently-active program-cohort enrollment (member_program_enrollments
  -- + program_cohorts — see 20260903000000) forces status='active', the same
  -- way a 'gift'/'direct_stripe' override does. Placed before 4b (hiatus) so
  -- hiatus still wins via ordering, same as Step 4.
  UPDATE members m
  SET status = 'active', updated_at = NOW()
  WHERE m.status IS DISTINCT FROM 'active'
    AND EXISTS (
      SELECT 1 FROM member_program_enrollments mpe
      JOIN program_cohorts pc ON pc.id = mpe.cohort_id
      WHERE mpe.member_id = m.id
        AND now()::date BETWEEN pc.starts_at AND pc.expires_at
    );

  -- Step 4b: An active hiatus (member_hiatus_history) always forces
  -- on_hiatus, overriding whatever Step 4 (or 4a above) just set — hiatus is
  -- the more restrictive state, and running after them makes it win without
  -- needing a cross-table tie-break.
  UPDATE members m
  SET status = 'on_hiatus', updated_at = NOW()
  FROM member_hiatus_history hh
  WHERE hh.member_id = m.id
    AND current_date BETWEEN hh.start_date AND COALESCE(hh.end_date, 'infinity'::date)
    AND m.status IS DISTINCT FROM 'on_hiatus';

  -- Step 4c: A member whose program-cohort enrollment(s) have all lapsed
  -- (cohort expires_at in the past, none currently active) and who is still
  -- Kajabi-derived 'lead' becomes 'cancelled' rather than reverting to
  -- 'lead' — they had a real, bounded enrollment window and left, they
  -- were never "just a lead" who never subscribed. Analogous to old Step 4b
  -- for '180_program' overrides.
  UPDATE members m
  SET status = 'cancelled', updated_at = NOW()
  WHERE m.status = 'lead'
    AND EXISTS (
      SELECT 1 FROM member_program_enrollments mpe
      JOIN program_cohorts pc ON pc.id = mpe.cohort_id
      WHERE mpe.member_id = m.id
        AND pc.expires_at < now()::date
    )
    AND NOT EXISTS (
      SELECT 1 FROM member_program_enrollments mpe
      JOIN program_cohorts pc ON pc.id = mpe.cohort_id
      WHERE mpe.member_id = m.id
        AND now()::date BETWEEN pc.starts_at AND pc.expires_at
    );

  -- Step 4d: total_active_months is computed upstream (route.ts) purely from
  -- real Kajabi/Stripe subscription stints, which a one-time program-cohort
  -- purchase never produces — without this, a member Step 4a/4c just
  -- touched would show 0 active months forever. Derive it from elapsed time
  -- since each enrollment's cohort starts_at (capped at expires_at, so the
  -- count freezes at lapse rather than growing after the fact), same
  -- days/30 floored convention as computeMemberTenure
  -- (lib/member-tenure.ts). Takes the longest single enrollment window
  -- (not summed) — same semantics as the old single-override backfill.
  -- GREATEST guards against ever lowering a value a real stint already
  -- produced.
  UPDATE members m
  SET
    total_active_months = GREATEST(
      m.total_active_months,
      (
        -- pc.starts_at/expires_at are DATE, so this subtraction is already
        -- an integer day count (no EXTRACT(EPOCH ...) needed/valid here).
        SELECT MAX(FLOOR((LEAST(now()::date, pc.expires_at) - pc.starts_at) / 30.0))::integer
        FROM member_program_enrollments mpe
        JOIN program_cohorts pc ON pc.id = mpe.cohort_id
        WHERE mpe.member_id = m.id
          AND now()::date >= pc.starts_at
      )
    ),
    updated_at = NOW()
  WHERE EXISTS (
    SELECT 1 FROM member_program_enrollments mpe
    JOIN program_cohorts pc ON pc.id = mpe.cohort_id
    WHERE mpe.member_id = m.id
      AND now()::date >= pc.starts_at
  );

  -- Note: We do NOT delete members that aren't in new_data.
  -- This preserves historical data for members who left or were removed.
END;
$function$;

CREATE OR REPLACE FUNCTION public.reprocess_prickle_attendance_atomic(from_date timestamp with time zone, to_date timestamp with time zone, new_pup_data jsonb, new_attendance_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM prickle_attendance
  WHERE join_time < to_date
    AND leave_time > from_date;

  DELETE FROM prickles
  WHERE source = 'zoom'
    AND start_time < to_date
    AND end_time > from_date
    AND (
      new_pup_data IS NULL
      OR new_pup_data = 'null'::jsonb
      OR jsonb_array_length(new_pup_data) = 0
      OR zoom_meeting_uuid IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(new_pup_data) nd
        WHERE nd.value->>'zoom_meeting_uuid' = prickles.zoom_meeting_uuid
          AND (nd.value->>'start_time')::timestamptz = prickles.start_time
          AND (nd.value->>'end_time')::timestamptz   = prickles.end_time
      )
    );

  WITH upserted_pups AS (
    INSERT INTO prickles (type_id, host, start_time, end_time, source, zoom_meeting_uuid)
    SELECT
      (value->>'type_id'),
      (value->>'host'),
      (value->>'start_time')::timestamptz,
      (value->>'end_time')::timestamptz,
      value->>'source',
      value->>'zoom_meeting_uuid'
    FROM jsonb_array_elements(new_pup_data)
    WHERE new_pup_data != 'null'::jsonb AND jsonb_array_length(new_pup_data) > 0
    ON CONFLICT (zoom_meeting_uuid, start_time, end_time) WHERE zoom_meeting_uuid IS NOT NULL DO UPDATE SET
      type_id = EXCLUDED.type_id,
      host    = EXCLUDED.host,
      source  = EXCLUDED.source
    RETURNING id, zoom_meeting_uuid, start_time, end_time
  ),
  prickle_id_map AS (
    SELECT
      value->>'client_prickle_id' AS client_prickle_id,
      upserted_pups.id AS prickle_id
    FROM jsonb_array_elements(new_pup_data)
    JOIN upserted_pups
      ON upserted_pups.zoom_meeting_uuid = value->>'zoom_meeting_uuid'
     AND upserted_pups.start_time = (value->>'start_time')::timestamptz
     AND upserted_pups.end_time   = (value->>'end_time')::timestamptz
    WHERE new_pup_data != 'null'::jsonb AND jsonb_array_length(new_pup_data) > 0
  )
  INSERT INTO prickle_attendance (member_id, prickle_id, join_time, leave_time, confidence_score)
  SELECT
    (attendance.value->>'member_id'),
    COALESCE(
      (attendance.value->>'prickle_id'),
      prickle_id_map.prickle_id
    ),
    (attendance.value->>'join_time')::timestamptz,
    (attendance.value->>'leave_time')::timestamptz,
    attendance.value->>'confidence_score'
  FROM jsonb_array_elements(new_attendance_data) AS attendance
  LEFT JOIN prickle_id_map
    ON prickle_id_map.client_prickle_id = attendance.value->>'client_prickle_id'
  WHERE new_attendance_data != 'null'::jsonb AND jsonb_array_length(new_attendance_data) > 0;

  -- Mirror into member_activities, same window as the deletes/inserts above.
  DELETE FROM member_activities
  WHERE source = 'prickle_attendance'
    AND occurred_at >= from_date
    AND occurred_at < to_date;

  INSERT INTO member_activities (member_id, activity_type, activity_category, title, actor_kind, related_id, engagement_value, duration_minutes, occurred_at, source)
  SELECT
    pa.member_id,
    'prickle_attended',
    'event',
    'Attended ' || COALESCE(pt.name, 'a Prickle'),
    'member',
    pa.prickle_id::text,
    10,
    (SUM(EXTRACT(EPOCH FROM (pa.leave_time - pa.join_time))) / 60)::int,
    MIN(pa.join_time),
    'prickle_attendance'
  FROM prickle_attendance pa
  JOIN prickles p ON p.id = pa.prickle_id
  LEFT JOIN prickle_types pt ON pt.id = p.type_id
  WHERE pa.join_time < to_date AND pa.leave_time > from_date
  GROUP BY pa.member_id, pa.prickle_id, pt.name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reprocess_prickles_atomic(from_date timestamp with time zone, to_date timestamp with time zone, new_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM prickles
  WHERE source = 'calendar'
    AND start_time < to_date
    AND end_time > from_date
    AND (
      calendar_event_id IS NULL
      OR calendar_event_id NOT IN (
        SELECT (value->>'calendar_event_id')::uuid
        FROM jsonb_array_elements(new_data)
        WHERE value->>'calendar_event_id' IS NOT NULL
      )
    );

  INSERT INTO prickles (calendar_event_id, type_id, title, description, host, start_time, end_time, source)
  SELECT
    (value->>'calendar_event_id')::uuid,
    (value->>'type_id'),
    value->>'title',
    value->>'description',
    (value->>'host'),
    (value->>'start_time')::timestamptz,
    (value->>'end_time')::timestamptz,
    value->>'source'
  FROM jsonb_array_elements(new_data)
  ON CONFLICT (calendar_event_id) WHERE calendar_event_id IS NOT NULL DO UPDATE SET
    type_id     = EXCLUDED.type_id,
    title       = EXCLUDED.title,
    description = EXCLUDED.description,
    host        = EXCLUDED.host,
    start_time  = EXCLUDED.start_time,
    end_time    = EXCLUDED.end_time,
    source      = EXCLUDED.source;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reprocess_slack_activities_atomic(from_date timestamp with time zone, to_date timestamp with time zone, user_member_map jsonb, skip_empty_check boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
      -- The name Slack gave the channel: the webhook never stores one on the message, only the importer does.
      COALESCE(NULLIF(m.channel_name, ''), c.name) AS channel_label,
      -- Who wrote it: the Hub author of a message posted from the Hub, else the Slack user's member.
      COALESCE(hub.author_member_id, (user_member_map->>m.user_id)) AS author_member_id,
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
    LEFT JOIN LATERAL (
      SELECT cm.author_member_id
      FROM chat_channels cc
      JOIN chat_messages cm ON cm.channel_id = cc.id AND cm.slack_ts = m.message_ts AND cm.origin = 'app'
      WHERE cc.slack_channel_id = m.channel_id AND cm.author_member_id IS NOT NULL
    ) hub ON true
    WHERE m.occurred_at >= from_date
      AND m.occurred_at <= to_date
      AND m.deleted_at IS NULL
      AND (hub.author_member_id IS NOT NULL OR user_member_map ? m.user_id)
  ),
  inserted AS (
    INSERT INTO member_activities (
      member_id, activity_type, activity_category, title, description, data,
      related_id, engagement_value, occurred_at, source
    )
    SELECT
      m.author_member_id,
      CASE WHEN COALESCE(m.thread_ts, '') <> '' AND m.thread_ts <> m.message_ts
           THEN 'slack_thread_reply' ELSE 'slack_message' END,
      'communication',
      CASE m.conversation_type
        WHEN 'mpim' THEN 'Sent a group message'
        WHEN 'im' THEN 'Sent a direct message'
        ELSE 'Posted in #' || COALESCE(m.channel_label, '')
      END,
      CASE WHEN m.conversation_type IN ('mpim', 'im') OR m.restricted THEN NULL
           ELSE NULLIF(left(m.text, 200), '') END,
      jsonb_build_object(
        'channel_id', m.channel_id,
        'channel_name', CASE WHEN m.conversation_type IN ('mpim', 'im') THEN NULL ELSE m.channel_label END,
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
      (user_member_map->>r.user_id),
      'slack_reaction',
      'communication',
      'Reacted :' || r.reaction || ':',
      NULL,
      jsonb_build_object(
        'channel_id', r.channel_id,
        'channel_name', CASE WHEN c.is_mpim THEN NULL ELSE COALESCE(NULLIF(r.channel_name, ''), c.name) END,
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
$function$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT p.oid::regprocedure AS sig, p.proname FROM pg_proc p
           WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (ARRAY['add_event_attendee','admin_member_engagement','admin_members_page','chat_apply_slack_read','chat_can_read_content','chat_can_see_channel','chat_claim_slack_read_pull','chat_is_channel_member','chat_mark_message_failed','chat_mark_message_sent','chat_mark_read','chat_post_message','chat_toggle_reaction','chat_unread_counts','check_prickle_commitment_slot_overlap','count_activity_feed','create_prickle_commitment','current_acting_as_member_id','current_member_id','get_activity_feed','get_hosted_prickle_attendance','get_member_directory','get_profile_writing','get_record_history','has_course_access','match_member_by_name','mentorship_counts','my_mentorships','remove_event_attendee','search_chat_messages','slack_connection_delete_secrets','slack_connection_revoke','slack_connection_save','slack_connection_tokens','slack_connection_update_tokens','sync_event_badge_awards','upsert_ambiguous_zoom_name']) LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || r.sig || ' FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || r.sig || ' TO ' || (SELECT string_agg(CASE WHEN grantee = '-' THEN 'PUBLIC' ELSE grantee END, ', ') FROM sid_fn_acl WHERE proname = r.proname);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS sig, c.comment FROM pg_proc p JOIN sid_fn_comment c ON c.proname = p.proname
           WHERE p.pronamespace = 'public'::regnamespace LOOP
    EXECUTE format('COMMENT ON FUNCTION %s IS %L', r.sig, r.comment);
  END LOOP;
END $$;

-- 8. Put back what was dropped -----------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM sid_policies LOOP
    EXECUTE format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s',
      r.policyname, r.schemaname, r.tablename, r.permissive, r.cmd,
      (SELECT string_agg(CASE WHEN x = 'public' THEN 'public' ELSE quote_ident(x) END, ', ') FROM unnest(r.roles) x),
      CASE WHEN r.qual IS NULL THEN '' ELSE ' USING (' || r.qual || ')' END,
      CASE WHEN r.with_check IS NULL THEN '' ELSE ' WITH CHECK (' || r.with_check || ')' END);
  END LOOP;
  FOR r IN SELECT * FROM sid_checks LOOP
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', r.tbl, r.conname, r.def);
  END LOOP;
  FOR r IN SELECT * FROM sid_fks LOOP
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', r.tbl, r.conname, r.def);
  END LOOP;
  FOR r IN SELECT * FROM sid_t1 LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id SET DEFAULT public.new_id(%L)', r.tbl, r.prefix);
    EXECUTE format('COMMENT ON TABLE public.%I IS %L', r.tbl,
      coalesce(obj_description(format('public.%I', r.tbl)::regclass, 'pg_class') || ' ', '') || '[id prefix: ' || r.prefix || '_]');
  END LOOP;
END $$;

-- 9. Verify (any failure rolls the whole migration back) --------------------------------------
DO $$
DECLARE r record; n bigint;
BEGIN
  FOR r IN SELECT * FROM sid_counts LOOP
    EXECUTE format('SELECT count(*) FROM %s', r.tbl) INTO n;
    IF n <> r.n THEN RAISE EXCEPTION 'row count changed in %: % -> %', r.tbl, r.n, n; END IF;
  END LOOP;
  FOR r IN SELECT * FROM sid_cols LOOP
    EXECUTE format('SELECT count(*) FROM %s t WHERE t.%I IS NOT NULL AND t.%I !~ %L', r.tbl, r.col, r.col,
      '^' || (SELECT prefix FROM sid_t1 WHERE tbl = r.parent) || '_[1-9A-HJ-NP-Za-km-z]{12}$') INTO n;
    IF n > 0 THEN RAISE EXCEPTION '% rows of % have a % that is not a % id', n, r.tbl, r.col, r.parent; END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname IN ('public', 'bronze', 'storage')) <> (SELECT count(*) FROM sid_policies) THEN
    RAISE EXCEPTION 'policy count changed';
  END IF;
END $$;
