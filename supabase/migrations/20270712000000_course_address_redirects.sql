-- A Hub course's address (its slug) can change without breaking links people already have.
--
-- 1. `courses.first_published_at`: when the course first became available (`is_draft` went false). A course that is a
--    draft and never was published can change its address freely; one that is published, or ever was, keeps its old
--    addresses working. Kept by a trigger, so it holds however a course is published (the editor, the Kajabi publish
--    path, a script). Backfilled for what is published now, and for drafts the audit log saw published.
-- 2. `course_address_redirects`: an old address that points at its course (by id, never at another address, so a
--    second rename makes every earlier address resolve to the newest one: no chains). The same trigger that sees the
--    slug change writes the row, in the same statement and transaction as the rename, so a rename never goes without
--    its redirect. Renaming back to an address the course used before removes that redirect (it is canonical again);
--    deleting the course removes them (ON DELETE CASCADE).
-- 3. One address space: no course's slug may equal another course's redirect, and no redirect may equal another
--    course's slug, so an old address can't be claimed while it redirects. Violations are 23505 'course_address_taken'
--    (the same code the slug's own unique constraint gives, so the editor shows its "already uses that address" error).
--
-- The audit log records the intent once: the course's own update entry (slug old/new). The redirect table has no audit
-- trigger of its own, so there is no per-row noise. Only Hub-owned courses get redirects (an imported course's address
-- is Kajabi's, rebuilt by the import).
--
-- Expand only: a nullable column, a new table and triggers; nothing is dropped or renamed.

set lock_timeout = '5s';

ALTER TABLE public.courses ADD COLUMN first_published_at timestamptz;
COMMENT ON COLUMN public.courses.first_published_at IS
  'When the course first became available to members (is_draft went false); null while it never was. Set by trigger and never cleared, so unpublishing keeps it. Backfilled from created_at (or the audit log) for courses published before it existed, so for those it is approximate. A published or once-published course keeps its old addresses working (course_address_redirects).';

-- Backfill, quietly: no triggers (audit, updated_at) for a column nobody edited.
SET LOCAL session_replication_role = replica;
UPDATE public.courses c
   SET first_published_at = coalesce(
     (SELECT min(a.occurred_at) FROM public.audit_log a
       WHERE a.entity_type = 'course' AND a.entity_id = c.id AND a.changes -> 'is_draft' ->> 'new' = 'false'),
     c.created_at)
 WHERE NOT c.is_draft
    OR EXISTS (SELECT 1 FROM public.audit_log a
                WHERE a.entity_type = 'course' AND a.entity_id = c.id AND a.changes -> 'is_draft' ->> 'new' = 'false');
SET LOCAL session_replication_role = DEFAULT;

CREATE TABLE public.course_address_redirects (
  id text PRIMARY KEY DEFAULT public.new_id('cslug'),
  address text NOT NULL,
  course_id text NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT course_address_redirects_address_key UNIQUE (address)
);
CREATE INDEX course_address_redirects_course_idx ON public.course_address_redirects (course_id);

COMMENT ON TABLE public.course_address_redirects IS
  'LOCAL: an address (slug) a published or once-published Hub course used to have; /courses/<address> redirects permanently to the course''s current address. Points at the course by id, so a later rename needs no update here. Written only by the trigger on courses (same transaction as the rename); never claimable as a slug by another course while it exists. Not reprocessed. Tier 2: the id is never shown in a URL or export. [id prefix: cslug_]';

ALTER TABLE public.course_address_redirects ENABLE ROW LEVEL SECURITY;
-- Whoever can open a course page can resolve its old address; nothing here is secret. No write policy: the trigger
-- (SECURITY DEFINER) is the only writer, plus the service role.
CREATE POLICY "Signed-in users read course address redirects" ON public.course_address_redirects
  FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.course_address_redirects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.course_address_redirects TO service_role;

-- A redirect can't hold an address another course uses as its slug (the course's own slug is the one being left).
CREATE FUNCTION public.course_address_redirects_guard() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('course_address'));
  IF EXISTS (SELECT 1 FROM courses c WHERE c.slug = NEW.address AND c.id <> NEW.course_id) THEN
    RAISE EXCEPTION 'course_address_taken' USING ERRCODE = '23505', CONSTRAINT = 'course_address_redirects_address_key';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.course_address_redirects_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER course_address_redirects_guard
  BEFORE INSERT OR UPDATE OF address, course_id ON public.course_address_redirects
  FOR EACH ROW EXECUTE FUNCTION public.course_address_redirects_guard();

-- On a course: stamp the first publication, keep the address space unique, and turn a rename into a redirect.
CREATE FUNCTION public.courses_address_and_publication() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  IF NOT NEW.is_draft AND NEW.first_published_at IS NULL THEN
    NEW.first_published_at := now();
  END IF;

  IF TG_OP = 'INSERT' OR NEW.slug IS DISTINCT FROM OLD.slug THEN
    PERFORM pg_advisory_xact_lock(hashtext('course_address'));
    -- Another course's old address is not free.
    IF EXISTS (SELECT 1 FROM course_address_redirects r WHERE r.address = NEW.slug AND r.course_id <> NEW.id) THEN
      RAISE EXCEPTION 'course_address_taken' USING ERRCODE = '23505', CONSTRAINT = 'courses_slug_key';
    END IF;
    IF TG_OP = 'UPDATE' THEN
      -- Back to an address it used before: canonical again, so no redirect from it.
      DELETE FROM course_address_redirects WHERE course_id = NEW.id AND address = NEW.slug;
      -- Published now or at any point: the address it leaves keeps working.
      IF OLD.source = 'hub' AND (OLD.first_published_at IS NOT NULL OR NOT OLD.is_draft) THEN
        INSERT INTO course_address_redirects (address, course_id) VALUES (OLD.slug, NEW.id) ON CONFLICT (address) DO NOTHING;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.courses_address_and_publication() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER courses_address_and_publication
  BEFORE INSERT OR UPDATE OF slug, is_draft ON public.courses
  FOR EACH ROW EXECUTE FUNCTION public.courses_address_and_publication();

-- Duplicating a course picks a free address; one an old address holds is not free (replaces the function of
-- 20270710000000, with that one change).
CREATE OR REPLACE FUNCTION public.duplicate_course(p_course_id text) RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  src courses%ROWTYPE;
  v_new text;
  v_slug text;
  v_base text;
  v_n int := 1;
  v_modules int;
  v_lessons int;
  v_files int;
  v_map jsonb;
  v_lmap jsonb;
BEGIN
  IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'not_editable';
  END IF;
  SELECT * INTO src FROM courses WHERE id = p_course_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF EXISTS (
    SELECT 1 FROM course_modules c
      JOIN course_modules p ON p.id = c.parent_id AND p.course_id = c.course_id
     WHERE c.course_id = p_course_id AND p.parent_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'too_deep';
  END IF;

  v_base := left(src.slug, 60) || '-copy';
  v_slug := v_base;
  WHILE EXISTS (SELECT 1 FROM courses WHERE slug = v_slug) OR EXISTS (SELECT 1 FROM course_address_redirects WHERE address = v_slug) LOOP
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  END LOOP;

  v_new := public.new_id('crs');
  PERFORM set_config('app.audit_skip_course', v_new, true);

  INSERT INTO courses (id, slug, title, description, source, source_key, kind, program_id, access_duration, launch_at, is_draft,
                       thumbnail_url, thumbnail_source, thumbnail_asset_id, hero_url, hero_source, hero_asset_id)
  VALUES (v_new, v_slug, left(src.title, 112) || ' (copy)', src.description, 'hub', NULL, src.kind, NULL, src.access_duration, src.launch_at, true,
          src.thumbnail_url, src.thumbnail_source, src.thumbnail_asset_id, src.hero_url, src.hero_source, src.hero_asset_id);

  SELECT coalesce(jsonb_object_agg(id, public.new_id('mod')), '{}'::jsonb) INTO v_map FROM course_modules WHERE course_id = p_course_id;

  INSERT INTO course_modules (id, course_id, parent_id, title, position, state, publishing_option, poster_url, poster_source, poster_asset_id, source)
  SELECT v_map ->> o.id, v_new, NULL, o.title, o.position, 'hidden', 'draft', o.poster_url, o.poster_source, o.poster_asset_id, 'hub'
    FROM course_modules o
   WHERE o.course_id = p_course_id AND o.parent_id IS NULL;
  INSERT INTO course_modules (id, course_id, parent_id, title, position, state, publishing_option, poster_url, poster_source, poster_asset_id, source)
  SELECT v_map ->> o.id, v_new, v_map ->> o.parent_id, o.title, o.position, 'hidden', 'draft', o.poster_url, o.poster_source, o.poster_asset_id, 'hub'
    FROM course_modules o
   WHERE o.course_id = p_course_id AND o.parent_id IS NOT NULL;

  SELECT coalesce(jsonb_object_agg(id, public.new_id('les')), '{}'::jsonb) INTO v_lmap FROM course_lessons WHERE course_id = p_course_id;
  INSERT INTO course_lessons (id, course_id, module_id, title, position, state, publishing_option, body_html, excerpt, thumbnail_url, thumbnail_source, thumbnail_asset_id, video_id, duration_seconds, source)
  SELECT v_lmap ->> l.id, v_new, v_map ->> l.module_id, l.title, l.position, 'hidden', 'draft', l.body_html, l.excerpt, l.thumbnail_url, l.thumbnail_source, l.thumbnail_asset_id, l.video_id, l.duration_seconds, 'hub'
    FROM course_lessons l
   WHERE l.course_id = p_course_id;

  INSERT INTO course_lesson_files (lesson_id, source_key, filename, content_type, size_bytes, content_hash, storage_path, position)
  SELECT v_lmap ->> f.lesson_id, 'up-' || gen_random_uuid(), f.filename, f.content_type, f.size_bytes, f.content_hash, f.storage_path, f.position
    FROM course_lesson_files f
   WHERE f.lesson_id IN (SELECT id FROM course_lessons WHERE course_id = p_course_id);
  GET DIAGNOSTICS v_files = ROW_COUNT;

  SELECT count(*) INTO v_modules FROM course_modules WHERE course_id = v_new;
  SELECT count(*) INTO v_lessons FROM course_lessons WHERE course_id = v_new;

  UPDATE audit_log
     SET changes = changes || jsonb_build_object(
           'copied_from', jsonb_build_object('old', NULL, 'new', p_course_id),
           'modules_copied', jsonb_build_object('old', NULL, 'new', v_modules),
           'lessons_copied', jsonb_build_object('old', NULL, 'new', v_lessons),
           'files_copied', jsonb_build_object('old', NULL, 'new', v_files))
   WHERE txid = txid_current() AND entity_type = 'course' AND entity_id = v_new AND action = 'insert';

  PERFORM set_config('app.audit_skip_course', '', true);
  RETURN v_new;
END $$;

NOTIFY pgrst, 'reload schema';
