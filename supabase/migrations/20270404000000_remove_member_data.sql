-- The routine that carries out a member's removal request, following the per-table choices in
-- member_data_handling (migration 20270331000000; docs/TODO.md, "Removal on request for records with a required
-- member id"). Service role only, and meant to be run by staff after a dry run with member_data_report().
--
-- What it does, in one transaction:
--   * the member's own row becomes the "former member" placeholder (name, email, links and every id that points at
--     a person are removed or replaced), so every row marked repoint keeps its shape and simply points at it. One
--     placeholder per removed person, never a shared one: a shared one would collide on the unique constraints
--     of check-ins, lesson progress, enrolments and the like, and would merge people in distinct counts;
--   * rows marked delete go, rows marked null have the reference cleared, rows marked ask go unless the caller says
--     the member wants their public work kept (then the byline they chose is written into the book first, and
--     anything they had already deleted still goes);
--   * free text on rows that stay (a mentorship's outcome note, a hiatus or enrolment note, a feedback browser string)
--     is cleared;
--   * their sign-in side in the database goes (user_profiles, Slack identity, login history, usage events, feature
--     previews), and the references other tables hold to their auth user are cleared, so the auth user itself can be
--     deleted afterwards through the Auth API (the caller does that, and removes the storage files listed in the result);
--   * audit_log: entries about them go, and their name and email are replaced inside everyone else's entries.
--
-- It returns what it did (counts per catalog row, the auth user id and the storage paths to delete). It refuses a
-- member that was already removed. A scrub is irreversible and untraceable: a request for true deletion must be
-- decided first (docs/EVENT_LOG.md, "What a scrub does").
--
-- NOT covered, on purpose, and listed in docs/TODO.md: copies in the Bronze imports (Kajabi, Stripe, Zoom, Slack) are
-- keyed by email or external id, not by a member id. Until those are handled, the person has to be removed at the
-- source first, or the next import brings them back.

set lock_timeout = '5s';

-- The auth user can't be deleted while a NOT NULL, no-action reference still points at it. Feedback is kept (it
-- helps us), so its user reference becomes optional instead.
ALTER TABLE public.feedback ALTER COLUMN user_id DROP NOT NULL;

CREATE FUNCTION public.remove_member_data(p_member_id text, p_keep_public boolean DEFAULT false)
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
  paths text[] := ARRAY[]::text[];
  names text[] := ARRAY[]::text[];
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

  -- Files in storage that belong to rows about to go (the caller deletes them after the commit).
  paths := paths || COALESCE((SELECT array_agg(storage_path) FROM public.media_assets
    WHERE owner_member_id = p_member_id AND storage_path IS NOT NULL
      AND NOT (p_keep_public AND id IN (SELECT cover_asset_id FROM public.member_books
        WHERE member_id = p_member_id AND deleted_at IS NULL AND cover_asset_id IS NOT NULL))), ARRAY[]::text[]);
  paths := paths || COALESCE((SELECT array_agg(screenshot_path) FROM public.feedback
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

  RETURN jsonb_build_object('member_id', p_member_id, 'auth_user_id', v_user, 'storage_paths', to_jsonb(paths), 'counts', counts);
END;
$function$;

COMMENT ON FUNCTION public.remove_member_data(text, boolean) IS
  'Carries out a member removal request per member_data_handling: the member row becomes the former-member placeholder, delete/null/ask rows are handled, audit_log entries are cleared. Returns the auth user id and storage paths the caller must delete. Service role only.';

REVOKE EXECUTE ON FUNCTION public.remove_member_data(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_member_data(text, boolean) TO service_role;
