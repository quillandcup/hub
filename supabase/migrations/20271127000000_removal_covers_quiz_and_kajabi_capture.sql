-- Member removal covers the quiz data and the Kajabi capture copies (docs/product/COURSES.md, "Removal on request"; the
-- privacy promise is `rights` in src/lib/privacy-promises.ts). Before this, a removal deleted the member's attempts and their
-- folder of the quiz bucket but left everything the Kajabi capture holds about them, keyed by email or name: their past quiz
-- responses (with the files in the import folder of the bucket), their per-lesson and per-product progress, and the comments
-- captured under their name. Expand only: new objects, and CREATE OR REPLACE of the two removal functions (same signatures; the
-- result gains one key, `quiz_import_paths`).
--
--   * public.removal_tombstones: what a removal keeps so a later capture or import can't bring the data back, as one-way
--     SHA-256 fingerprints and nothing else (no name, no address): of each email address that was removed, and of each Kajabi
--     comment key the removed member wrote. Service role only. A fingerprint of an address is still personal data (anyone holding
--     the address can compute it), which is why it is kept only for this purpose and documented on the privacy page's evidence.
--   * Triggers on the four capture tables skip a row whose fingerprint is there, whoever writes it (the capture scripts, the
--     CSV upload, a re-run), so the removal holds without every writer having to know.
--   * public.member_removal_emails(): the addresses a removal acts on: the member's own and every alias (active or not), except
--     one another member also holds (never guess whose rows they are).
--   * remove_member_data / member_removal_extras: delete (and count) the member's Bronze rows by those addresses, and the
--     Bronze comments the import matched to them (the Hub comment's source_key names the capture row: exact, never by name).
--   * public.purge_removed_member_bronze(): the same deletion driven by the fingerprints alone, for a row that raced a removal;
--     safe to run any time.

set lock_timeout = '5s';

------------------------------------------------------------------------------------------------
-- Fingerprints
------------------------------------------------------------------------------------------------

CREATE FUNCTION public.removal_hash(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$ SELECT encode(sha256(convert_to(lower(btrim(p_value)), 'UTF8')), 'hex') $$;

COMMENT ON FUNCTION public.removal_hash(text) IS
  'The fingerprint of an email address or a Kajabi comment key: SHA-256 of the trimmed, lower-cased text, as hex. src/lib/data/removal-hash.ts computes the same value.';

CREATE TABLE public.removal_tombstones (
  kind text NOT NULL CHECK (kind IN ('email', 'kajabi_comment')),
  key_hash text NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, key_hash)
);

ALTER TABLE public.removal_tombstones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.removal_tombstones FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.removal_tombstones TO service_role;

COMMENT ON TABLE public.removal_tombstones IS
  'What a member removal keeps so the Kajabi capture and imports can not bring the removed data back: SHA-256 fingerprints of removed email addresses (kind email) and of Kajabi comment keys the member wrote (kind kajabi_comment). No names, no addresses. Service role only, no policies. To let a person who later asks to come back have their history captured again, delete their fingerprint: DELETE FROM public.removal_tombstones WHERE kind = ''email'' AND key_hash = public.removal_hash(''their address'').';

------------------------------------------------------------------------------------------------
-- Which addresses a removal acts on
------------------------------------------------------------------------------------------------

-- The member's own address and every alias of theirs, trimmed and lower-cased (the form the capture tables store), without the
-- placeholder form a removed member gets. With p_only_unshared (the default) an address that another member also holds, as
-- their address or their alias, is left out: it can't be told apart from theirs.
CREATE FUNCTION public.member_removal_emails(p_member_id text, p_only_unshared boolean DEFAULT true)
RETURNS SETOF text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT x.e FROM (
    SELECT lower(btrim(m.email)) AS e FROM public.members m WHERE m.id = p_member_id
    UNION
    SELECT lower(btrim(a.alias_email)) FROM public.member_email_aliases a WHERE a.member_id = p_member_id
  ) x
  WHERE x.e <> '' AND x.e NOT LIKE '%@removed.invalid'
    AND (NOT p_only_unshared OR (
      NOT EXISTS (SELECT 1 FROM public.members o WHERE o.id <> p_member_id AND lower(btrim(o.email)) = x.e)
      AND NOT EXISTS (SELECT 1 FROM public.member_email_aliases b WHERE b.member_id <> p_member_id AND lower(btrim(b.alias_email)) = x.e)
    ))
  ORDER BY x.e
$$;

REVOKE EXECUTE ON FUNCTION public.member_removal_emails(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_removal_emails(text, boolean) TO service_role;
COMMENT ON FUNCTION public.member_removal_emails(text, boolean) IS
  'The email addresses a member removal acts on in the Kajabi capture copies: their own and their aliases, without any address another member also holds. Service role only.';

------------------------------------------------------------------------------------------------
-- The capture tables skip what was removed
------------------------------------------------------------------------------------------------

CREATE FUNCTION public.skip_removed_email_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.removal_tombstones t WHERE t.kind = 'email' AND t.key_hash = public.removal_hash(NEW.email)) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION public.skip_removed_comment_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.removal_tombstones t WHERE t.kind = 'kajabi_comment' AND t.key_hash = public.removal_hash(NEW.lesson_kajabi_id || '/' || NEW.comment_key)) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.skip_removed_email_row() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.skip_removed_comment_row() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER skip_removed_email BEFORE INSERT OR UPDATE OF email ON bronze.kajabi_quiz_responses
  FOR EACH ROW EXECUTE FUNCTION public.skip_removed_email_row();
CREATE TRIGGER skip_removed_email BEFORE INSERT OR UPDATE OF email ON bronze.kajabi_lesson_progress
  FOR EACH ROW EXECUTE FUNCTION public.skip_removed_email_row();
CREATE TRIGGER skip_removed_email BEFORE INSERT OR UPDATE OF email ON bronze.kajabi_product_progress
  FOR EACH ROW EXECUTE FUNCTION public.skip_removed_email_row();
CREATE TRIGGER skip_removed_comment BEFORE INSERT ON bronze.kajabi_lesson_comments
  FOR EACH ROW EXECUTE FUNCTION public.skip_removed_comment_row();

------------------------------------------------------------------------------------------------
-- The dry run, and the removal
------------------------------------------------------------------------------------------------


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
  emails text[];
  comment_keys text[];
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

  -- What they wrote in course quizzes (the attempts themselves are counted by the catalog's quiz_attempts line), and the Kajabi
  -- capture copies keyed by their email addresses. Counts only, never a word of it. Keep in step with remove_member_data.
  emails := ARRAY(SELECT public.member_removal_emails(p_member_id));
  comment_keys := ARRAY(SELECT l.source_key FROM public.lesson_comments l WHERE l.member_id = p_member_id AND l.source = 'kajabi');

  item := 'quiz_answers'; action := 'delete'; samples := ARRAY[]::text[];
  SELECT count(*) INTO row_count FROM public.quiz_attempt_answers qa JOIN public.quiz_attempts qt ON qt.id = qa.attempt_id WHERE qt.member_id = p_member_id; RETURN NEXT;
  item := 'quiz_answer_files'; action := 'delete';
  SELECT count(*) INTO row_count FROM public.quiz_attempt_answers qa JOIN public.quiz_attempts qt ON qt.id = qa.attempt_id
   WHERE qt.member_id = p_member_id AND qa.file_path IS NOT NULL; RETURN NEXT;
  item := 'kajabi_quiz_responses'; action := 'delete';
  SELECT count(*) INTO row_count FROM bronze.kajabi_quiz_responses WHERE email = ANY (emails); RETURN NEXT;
  item := 'kajabi_quiz_response_files'; action := 'delete';
  SELECT count(*) INTO row_count FROM bronze.kajabi_quiz_responses r, LATERAL jsonb_array_elements(r.answers) ans
   WHERE r.email = ANY (emails) AND ans #>> '{file,storage_path}' IS NOT NULL; RETURN NEXT;
  item := 'kajabi_lesson_progress'; action := 'delete';
  SELECT count(*) INTO row_count FROM bronze.kajabi_lesson_progress WHERE email = ANY (emails); RETURN NEXT;
  item := 'kajabi_product_progress'; action := 'delete';
  SELECT count(*) INTO row_count FROM bronze.kajabi_product_progress WHERE email = ANY (emails); RETURN NEXT;
  -- Comments are captured with only the name Kajabi shows. The ones the import matched to them are theirs for certain (the Hub
  -- comment names its capture row); a row that merely carries the same name could be anyone, so it is counted and kept.
  item := 'kajabi_lesson_comments'; action := 'delete';
  SELECT count(*) INTO row_count FROM bronze.kajabi_lesson_comments c
   WHERE (c.lesson_kajabi_id || '/' || c.comment_key) = ANY (comment_keys); RETURN NEXT;
  item := 'kajabi_comments_same_name'; action := 'keep';
  SELECT count(*) INTO row_count FROM bronze.kajabi_lesson_comments c
   WHERE NOT ((c.lesson_kajabi_id || '/' || c.comment_key) = ANY (comment_keys))
     AND regexp_replace(lower(btrim(c.author_name)), '\s+', ' ', 'g')
       = ANY (ARRAY[regexp_replace(lower(btrim(m.name)), '\s+', ' ', 'g'), regexp_replace(lower(btrim(COALESCE(m.display_name, m.name))), '\s+', ' ', 'g')]); RETURN NEXT;
  -- An address another member also holds is not theirs alone: its rows stay.
  item := 'shared_emails'; action := 'keep';
  SELECT count(*) INTO row_count FROM public.member_removal_emails(p_member_id, false) e WHERE NOT (e = ANY (emails)); RETURN NEXT;
  -- What is kept so a later import can't bring it back: a one-way fingerprint of each address and comment key.
  item := 'removal_fingerprints'; action := 'keep';
  row_count := cardinality(emails) + cardinality(comment_keys); RETURN NEXT;

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

CREATE OR REPLACE FUNCTION public.remove_member_data(p_member_id text, p_keep_public boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  m public.members%ROWTYPE;
  h record;
  fk record;
  v_user uuid;
  n bigint;
  counts jsonb := '{}'::jsonb;
  media_paths text[] := ARRAY[]::text[];
  feedback_paths text[] := ARRAY[]::text[];
  names text[] := ARRAY[]::text[];
  emails text[];
  comment_keys text[];
  quiz_import_paths text[] := ARRAY[]::text[];
  nm text;
  esc text;
  todo text[];
  still text[];
  progressed boolean;
  entry text;
  t text;
  c text;
  a text;
BEGIN
  SELECT * INTO m FROM public.members WHERE id = p_member_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no member %', p_member_id;
  END IF;
  IF m.email LIKE '%@removed.invalid' THEN
    RAISE EXCEPTION 'member % was already removed', p_member_id;
  END IF;
  v_user := m.user_id;

  -- Everything that says who they were, to replace inside other records later.
  FOREACH nm IN ARRAY ARRAY[m.name, m.display_name, m.email] LOOP
    IF nm IS NOT NULL AND length(nm) >= 3 THEN names := names || nm; END IF;
  END LOOP;

  -- The Kajabi capture copies of their course data (Bronze), keyed by their email addresses (their own and every alias, taken
  -- before the catalog pass deletes the aliases) and, for comments, by the key of each comment the import matched to them.
  -- A fingerprint of each is kept first, so a later capture can't bring it back (the triggers on those tables). An address
  -- another member also holds is left alone, never guessed. Their files in the import folder of the bucket are listed here and
  -- deleted by the caller after the commit.
  emails := ARRAY(SELECT public.member_removal_emails(p_member_id));
  comment_keys := ARRAY(SELECT l.source_key FROM public.lesson_comments l WHERE l.member_id = p_member_id AND l.source = 'kajabi');
  INSERT INTO public.removal_tombstones (kind, key_hash)
    SELECT 'email', public.removal_hash(e) FROM unnest(emails) e
    UNION SELECT 'kajabi_comment', public.removal_hash(k) FROM unnest(comment_keys) k
    ON CONFLICT DO NOTHING;
  quiz_import_paths := COALESCE((SELECT array_agg(DISTINCT ans #>> '{file,storage_path}') FROM bronze.kajabi_quiz_responses r, LATERAL jsonb_array_elements(r.answers) ans
    WHERE r.email = ANY (emails) AND ans #>> '{file,storage_path}' IS NOT NULL), ARRAY[]::text[]);
  DELETE FROM bronze.kajabi_quiz_responses WHERE email = ANY (emails);
  GET DIAGNOSTICS n = ROW_COUNT;
  counts := counts || jsonb_build_object('bronze.kajabi_quiz_responses', n);
  DELETE FROM bronze.kajabi_lesson_progress WHERE email = ANY (emails);
  GET DIAGNOSTICS n = ROW_COUNT;
  counts := counts || jsonb_build_object('bronze.kajabi_lesson_progress', n);
  DELETE FROM bronze.kajabi_product_progress WHERE email = ANY (emails);
  GET DIAGNOSTICS n = ROW_COUNT;
  counts := counts || jsonb_build_object('bronze.kajabi_product_progress', n);
  DELETE FROM bronze.kajabi_lesson_comments bc
   WHERE (bc.lesson_kajabi_id || '/' || bc.comment_key) = ANY (comment_keys);
  GET DIAGNOSTICS n = ROW_COUNT;
  counts := counts || jsonb_build_object('bronze.kajabi_lesson_comments', n);

  -- Files in storage that belong to rows about to go (the caller deletes them after the commit).
  media_paths := COALESCE((SELECT array_agg(storage_path) FROM public.media_assets
    WHERE owner_member_id = p_member_id AND storage_path IS NOT NULL
      AND NOT (p_keep_public AND id IN (SELECT cover_asset_id FROM public.member_books
        WHERE member_id = p_member_id AND deleted_at IS NULL AND cover_asset_id IS NOT NULL))), ARRAY[]::text[]);
  feedback_paths := COALESCE((SELECT array_agg(screenshot_path) FROM public.feedback
    WHERE (member_id = p_member_id OR (v_user IS NOT NULL AND user_id = v_user)) AND screenshot_path IS NOT NULL), ARRAY[]::text[]);

  -- Public work they chose to keep is signed with the byline they use, since their name is about to go.
  IF p_keep_public THEN
    UPDATE public.member_books
       SET pen_name = COALESCE(NULLIF(pen_name, ''), NULLIF(m.display_name, ''), m.name)
     WHERE member_id = p_member_id AND deleted_at IS NULL;
  END IF;

  -- Free text on the rows that stay.
  UPDATE public.mentorships SET outcome_note = NULL WHERE new_member_id = p_member_id AND outcome_note IS NOT NULL;
  UPDATE public.member_hiatus_history SET notes = NULL, reason = NULL WHERE member_id = p_member_id;
  UPDATE public.member_program_enrollments SET notes = NULL WHERE member_id = p_member_id;
  UPDATE public.feedback SET user_agent = NULL, screenshot_path = NULL, user_id = NULL
   WHERE member_id = p_member_id OR (v_user IS NOT NULL AND user_id = v_user);

  -- The catalog's choices. Deletes are retried until none is blocked by a row that points at another one that is
  -- also going (a book by its awards, a project by its books), in whatever order the catalog lists them.
  todo := ARRAY[]::text[];
  FOR h IN SELECT * FROM public.member_data_handling ORDER BY table_name, column_name LOOP
    IF h.action = 'null' THEN
      EXECUTE format('UPDATE public.%I SET %I = NULL WHERE %I = $1', h.table_name, h.column_name, h.column_name) USING p_member_id;
      GET DIAGNOSTICS n = ROW_COUNT;
      counts := counts || jsonb_build_object(h.table_name || '.' || h.column_name, n);
    ELSIF h.action IN ('delete', 'ask') THEN
      todo := todo || (h.table_name || '.' || h.column_name || '.' || h.action);
    END IF;
  END LOOP;

  LOOP
    still := ARRAY[]::text[];
    progressed := false;
    FOREACH entry IN ARRAY todo LOOP
      t := split_part(entry, '.', 1); c := split_part(entry, '.', 2); a := split_part(entry, '.', 3);
      BEGIN
        IF a = 'ask' AND p_keep_public THEN
          EXECUTE format('DELETE FROM public.%I WHERE %I = $1 AND deleted_at IS NOT NULL', t, c) USING p_member_id;
        ELSE
          EXECUTE format('DELETE FROM public.%I WHERE %I = $1', t, c) USING p_member_id;
        END IF;
        GET DIAGNOSTICS n = ROW_COUNT;
        counts := counts || jsonb_build_object(t || '.' || c, n);
        progressed := true;
      EXCEPTION WHEN foreign_key_violation THEN
        still := still || entry;
      END;
    END LOOP;
    EXIT WHEN cardinality(still) = 0;
    IF NOT progressed THEN
      RAISE EXCEPTION 'could not remove % for member %: rows still point at them', still, p_member_id;
    END IF;
    todo := still;
  END LOOP;

  -- Their sign-in side in the database.
  IF v_user IS NOT NULL THEN
    DELETE FROM public.slack_identities WHERE user_id = v_user;
    DELETE FROM public.user_feature_previews WHERE user_id = v_user;
    DELETE FROM public.access_events WHERE user_id = v_user;
    DELETE FROM public.analytics_events WHERE user_id = v_user;
    DELETE FROM public.user_profiles WHERE id = v_user;
    -- Rows others own that name this user as who made or changed them: clear it, so deleting the user isn't blocked.
    FOR fk IN
      SELECT c2.conrelid::regclass::text AS tbl, a2.attname AS col
        FROM pg_constraint c2
        JOIN pg_attribute a2 ON a2.attrelid = c2.conrelid AND a2.attnum = c2.conkey[1]
       WHERE c2.contype = 'f' AND c2.confrelid = 'auth.users'::regclass AND c2.confdeltype = 'a'
         AND NOT a2.attnotnull AND c2.connamespace = 'public'::regnamespace
    LOOP
      EXECUTE format('UPDATE %s SET %I = NULL WHERE %I = $1', fk.tbl, fk.col, fk.col) USING v_user;
    END LOOP;
    UPDATE public.audit_log SET changed_by = NULL WHERE changed_by = v_user;
  END IF;

  -- The member row becomes the placeholder.
  UPDATE public.members SET
    name = 'Former member', display_name = NULL,
    email = 'removed-' || p_member_id || '@removed.invalid',
    bio = NULL, birthday_day = NULL, birthday_month = NULL,
    facebook_url = NULL, instagram_url = NULL, twitter_url = NULL, photo_url = NULL,
    kajabi_id = NULL, stripe_customer_id = NULL, kajabi_tags = '{}', plan = NULL, raw_payload = NULL,
    staff_role = NULL, user_id = NULL, status = 'cancelled', is_trial = false
  WHERE id = p_member_id;

  -- audit_log: entries about them go; their name and email are replaced inside everyone else's.
  DELETE FROM public.audit_log
   WHERE member_id = p_member_id OR acting_as_member_id = p_member_id OR (entity_type = 'member' AND entity_id = p_member_id);
  FOREACH nm IN ARRAY names LOOP
    esc := substr(to_jsonb(nm)::text, 2, length(to_jsonb(nm)::text) - 2);
    UPDATE public.audit_log
       SET changes = replace(changes::text, esc, 'Former member')::jsonb,
           entity_label = replace(entity_label, nm, 'Former member')
     WHERE position(esc in changes::text) > 0 OR position(nm in COALESCE(entity_label, '')) > 0;
  END LOOP;

  RETURN jsonb_build_object('member_id', p_member_id, 'auth_user_id', v_user, 'media_paths', to_jsonb(media_paths), 'feedback_paths', to_jsonb(feedback_paths), 'quiz_import_paths', to_jsonb(quiz_import_paths), 'counts', counts);
END;
$function$;

------------------------------------------------------------------------------------------------
-- The sweep: the same deletion, driven by the fingerprints alone
------------------------------------------------------------------------------------------------

-- Deletes whatever the capture tables hold for a fingerprinted address or comment key: a row that was written between the
-- removal reading them and its commit, or by a writer without the triggers. Returns the counts and the files to delete from
-- the bucket (the caller does that), and changes nothing when there is nothing to do, so it can be run again at any time.
CREATE FUNCTION public.purge_removed_member_bronze()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  n bigint;
  counts jsonb := '{}'::jsonb;
  paths text[];
BEGIN
  paths := COALESCE((SELECT array_agg(DISTINCT ans #>> '{file,storage_path}')
    FROM bronze.kajabi_quiz_responses r
    JOIN public.removal_tombstones t ON t.kind = 'email' AND t.key_hash = public.removal_hash(r.email),
    LATERAL jsonb_array_elements(r.answers) ans
    WHERE ans #>> '{file,storage_path}' IS NOT NULL), ARRAY[]::text[]);

  DELETE FROM bronze.kajabi_quiz_responses r USING public.removal_tombstones t
   WHERE t.kind = 'email' AND t.key_hash = public.removal_hash(r.email);
  GET DIAGNOSTICS n = ROW_COUNT;
  counts := counts || jsonb_build_object('bronze.kajabi_quiz_responses', n);
  DELETE FROM bronze.kajabi_lesson_progress r USING public.removal_tombstones t
   WHERE t.kind = 'email' AND t.key_hash = public.removal_hash(r.email);
  GET DIAGNOSTICS n = ROW_COUNT;
  counts := counts || jsonb_build_object('bronze.kajabi_lesson_progress', n);
  DELETE FROM bronze.kajabi_product_progress r USING public.removal_tombstones t
   WHERE t.kind = 'email' AND t.key_hash = public.removal_hash(r.email);
  GET DIAGNOSTICS n = ROW_COUNT;
  counts := counts || jsonb_build_object('bronze.kajabi_product_progress', n);
  DELETE FROM bronze.kajabi_lesson_comments c USING public.removal_tombstones t
   WHERE t.kind = 'kajabi_comment' AND t.key_hash = public.removal_hash(c.lesson_kajabi_id || '/' || c.comment_key);
  GET DIAGNOSTICS n = ROW_COUNT;
  counts := counts || jsonb_build_object('bronze.kajabi_lesson_comments', n);

  RETURN jsonb_build_object('quiz_import_paths', to_jsonb(paths), 'counts', counts);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.purge_removed_member_bronze() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_removed_member_bronze() TO service_role;
COMMENT ON FUNCTION public.purge_removed_member_bronze() IS
  'Deletes the Kajabi capture rows (quiz responses, lesson and product progress, comments) whose fingerprint a removal kept, and returns the counts and the import files to delete from the bucket. Safe to run any time. Service role only.';

NOTIFY pgrst, 'reload schema';
