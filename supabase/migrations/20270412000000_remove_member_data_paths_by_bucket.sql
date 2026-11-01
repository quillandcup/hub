-- remove_member_data returns the files to delete in two lists, by bucket (the media library and the feedback
-- screenshots), instead of one: the caller deleting them (lib/member-removal.ts) would otherwise have to guess the
-- bucket of each path. Same signature and behavior otherwise (CREATE OR REPLACE), so the grants and comment stay.

set lock_timeout = '5s';

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

  RETURN jsonb_build_object('member_id', p_member_id, 'auth_user_id', v_user, 'media_paths', to_jsonb(media_paths), 'feedback_paths', to_jsonb(feedback_paths), 'counts', counts);
END;
$function$;
