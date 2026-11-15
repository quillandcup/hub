-- The part of a removal that member_data_report() does not count: the sign-in side, the auth user and stored files,
-- the free text cleared on rows that stay, and the audit log. A read-only mirror of remove_member_data, so the
-- admin's dry run names everything the routine does. Each line carries its full count and up to 10 short labels
-- (never a storage path, token or note text). Keep it in step with remove_member_data. Service role only.

CREATE FUNCTION public.member_removal_extras(p_member_id text)
RETURNS TABLE (item text, action text, row_count bigint, samples text[])
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
  SELECT count(*), COALESCE(array_agg('Profile, role ' || role), ARRAY[]::text[]) INTO row_count, samples
    FROM public.user_profiles WHERE v_user IS NOT NULL AND id = v_user; RETURN NEXT;
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
    WITH hits AS (
      SELECT a.entity_type FROM public.audit_log a
       WHERE a.member_id IS DISTINCT FROM p_member_id AND a.acting_as_member_id IS DISTINCT FROM p_member_id
         AND NOT COALESCE(a.entity_type = 'member' AND a.entity_id = p_member_id, false)
         AND EXISTS (
           SELECT 1 FROM unnest(names) AS x(nm2)
            WHERE position(substr(to_jsonb(x.nm2)::text, 2, length(to_jsonb(x.nm2)::text) - 2) in a.changes::text) > 0
               OR position(x.nm2 in COALESCE(a.entity_label, '')) > 0)
    ), g AS (
      SELECT entity_type, count(*) AS c FROM hits GROUP BY entity_type ORDER BY count(*) DESC, entity_type LIMIT 10
    )
    SELECT (SELECT count(*) FROM hits), COALESCE((SELECT array_agg(entity_type || ' (' || c || ')' ORDER BY c DESC, entity_type) FROM g), ARRAY[]::text[])
      INTO row_count, samples;
  END IF;
  RETURN NEXT;
END;
$function$;

COMMENT ON FUNCTION public.member_removal_extras(text) IS
  'Dry run of what remove_member_data does outside member_data_handling: sign-in rows, auth user, stored files, cleared free text, audit log, each with a count and short labels. Read-only; keep in step with remove_member_data.';

REVOKE EXECUTE ON FUNCTION public.member_removal_extras(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_removal_extras(text) TO service_role;
