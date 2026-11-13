-- pgTAP tests for duplicating a course (20270710000000): a new draft Hub-owned course with a copy of the tree
-- (new ids, positions kept, the same videos and images), nothing of members' progress or access, the source untouched,
-- and one audit entry for the new course instead of one per module and lesson. Runs in one transaction that is
-- rolled back, so it leaves the shared local DB untouched. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(30);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000d1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dupcourse-alice@example.test'),
  ('00000000-0000-4000-a000-00000000d1a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dupcourse-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000d1a1', 'dupcourse-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000d1a4', 'dupcourse-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.programs (id, name, slug) VALUES ('prg_DupCourse001', 'Dup program', 'pgtap-dup-program');
INSERT INTO public.videos (id, source_kind, source_key, status) VALUES ('00000000-0000-4000-a000-00000000d1b1', 'kajabi', 'pgtap-dup-video', 'ready');
INSERT INTO public.members (id, name, email, joined_at, status) VALUES ('mbr_DupCourse0001', 'Dup Member', 'dupcourse-member@example.test', now(), 'active');

-- An imported, published course tied to a program and Kajabi: module A (published) with submodule A1 and a lesson in
-- each, a draft module, and a lesson in no module. Members have progress, access and a grant on it.
INSERT INTO public.courses (id, slug, title, description, source, source_key, is_draft, program_id, access_duration, launch_at, thumbnail_url, thumbnail_source) VALUES
  ('crs_DupCourse001', 'pgtap-dup', 'Imported', 'About it', 'kajabi', 'pgtap-dup-k', false, 'prg_DupCourse001', interval '90 days', '2027-01-01T00:00:00Z', 'https://example.test/t.png', 'https://example.test/t.png');
INSERT INTO public.course_modules (id, course_id, parent_id, title, position, publishing_option, state, source, source_key, poster_url) VALUES
  ('mod_DupCourseA01', 'crs_DupCourse001', NULL, 'Module A', 1, 'published', 'open', 'kajabi', 'pgtap-dup-ma', 'https://example.test/p.png'),
  ('mod_DupCourseA11', 'crs_DupCourse001', 'mod_DupCourseA01', 'Week A1', 1, 'published', 'open', 'kajabi', 'pgtap-dup-ma1', NULL),
  ('mod_DupCourseB01', 'crs_DupCourse001', NULL, 'Module B', 2, 'draft', 'hidden', 'kajabi', 'pgtap-dup-mb', NULL);
INSERT INTO public.course_lessons (id, course_id, module_id, title, position, publishing_option, state, body_html, excerpt, video_id, duration_seconds, source, source_key) VALUES
  ('les_DupCourseA01', 'crs_DupCourse001', 'mod_DupCourseA01', 'Lesson A', 1, 'published', 'open', '<p>Text</p>', 'Text', '00000000-0000-4000-a000-00000000d1b1', 120, 'kajabi', 'pgtap-dup-la'),
  ('les_DupCourseA11', 'crs_DupCourse001', 'mod_DupCourseA11', 'Lesson A1', 3, 'published', 'open', NULL, NULL, NULL, NULL, 'kajabi', 'pgtap-dup-la1'),
  ('les_DupCourseL01', 'crs_DupCourse001', NULL, 'Loose lesson', 2, 'published', 'open', NULL, NULL, NULL, NULL, 'kajabi', 'pgtap-dup-ll');
INSERT INTO public.course_lesson_files (lesson_id, source_key, filename, storage_path) VALUES ('les_DupCourseA01', 'pgtap-dup-file', 'a.pdf', 'pgtap/a.pdf');
INSERT INTO public.lesson_progress (member_id, lesson_id, completed_at) VALUES ('mbr_DupCourse0001', 'les_DupCourseA01', now());
INSERT INTO public.course_access (member_id, course_id, starts_at, origin) VALUES ('mbr_DupCourse0001', 'crs_DupCourse001', now(), 'purchase');
INSERT INTO public.course_access_grants (member_id, course_id) VALUES ('mbr_DupCourse0001', 'crs_DupCourse001');

-- A course nested one level too deep for the editor, and one that already owns the address "pgtap-dup-copy".
INSERT INTO public.courses (id, slug, title, source, source_key) VALUES
  ('crs_DupCourseDeep', 'pgtap-dup-deep', 'Deep', 'kajabi', 'pgtap-dup-deep-k'),
  ('crs_DupCourseTake', 'pgtap-dup-copy', 'Taken', 'hub', NULL);
INSERT INTO public.course_modules (id, course_id, parent_id, title, position, publishing_option, state, source, source_key) VALUES
  ('mod_DupCourseD01', 'crs_DupCourseDeep', NULL, 'D1', 1, 'published', 'open', 'kajabi', 'pgtap-dup-d1'),
  ('mod_DupCourseD02', 'crs_DupCourseDeep', 'mod_DupCourseD01', 'D2', 1, 'published', 'open', 'kajabi', 'pgtap-dup-d2'),
  ('mod_DupCourseD03', 'crs_DupCourseDeep', 'mod_DupCourseD02', 'D3', 1, 'published', 'open', 'kajabi', 'pgtap-dup-d3');

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON result TO authenticated;
CREATE FUNCTION pg_temp.failure(sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RETURN '';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.failure(text) TO authenticated;

SET LOCAL ROLE authenticated;

-- Alice (a member) can copy nothing.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000d1a1", "email": "dupcourse-alice@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'member', to_jsonb(pg_temp.failure($$SELECT public.duplicate_course('crs_DupCourse001')$$));

-- Dana (an admin).
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000d1a4", "email": "dupcourse-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'unknown', to_jsonb(pg_temp.failure($$SELECT public.duplicate_course('crs_Nope00000001')$$));
INSERT INTO result SELECT 'too_deep', to_jsonb(pg_temp.failure($$SELECT public.duplicate_course('crs_DupCourseDeep')$$));
INSERT INTO result SELECT 'first', to_jsonb(public.duplicate_course('crs_DupCourse001'));
INSERT INTO result SELECT 'second', to_jsonb(public.duplicate_course('crs_DupCourse001'));
INSERT INTO result SELECT 'of_hub', to_jsonb(public.duplicate_course('crs_DupCourseTake'));
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'member'), '"not_editable"'::jsonb, 'a member can''t copy a course');
SELECT is((SELECT value FROM result WHERE label = 'unknown'), '"not_found"'::jsonb, 'a course that isn''t there is not found');
SELECT is((SELECT value FROM result WHERE label = 'too_deep'), '"too_deep"'::jsonb, 'modules nested deeper than the editor does are refused');
SELECT is((SELECT count(*)::int FROM public.courses WHERE slug LIKE 'pgtap-dup-deep%'), 1, 'a refused course leaves no copy behind');

CREATE TEMP TABLE copy AS SELECT (value #>> '{}') AS id FROM result WHERE label = 'first';
CREATE TEMP TABLE copy2 AS SELECT (value #>> '{}') AS id FROM result WHERE label = 'second';
GRANT SELECT ON copy, copy2 TO authenticated;

SELECT matches((SELECT id FROM copy), '^crs_[1-9A-HJ-NP-Za-km-z]{12}$', 'the copy has a new prefixed id');
SELECT is((SELECT jsonb_build_object('source', source, 'key', source_key, 'draft', is_draft, 'slug', slug, 'title', title, 'description', description, 'program', program_id, 'duration', access_duration::text, 'launch', launch_at, 'thumb', thumbnail_url)
             FROM public.courses WHERE id = (SELECT id FROM copy)),
  jsonb_build_object('source', 'hub', 'key', NULL, 'draft', true, 'slug', 'pgtap-dup-copy-2', 'title', 'Imported (copy)', 'description', 'About it', 'program', NULL, 'duration', '90 days', 'launch', '2027-01-01T00:00:00+00:00', 'thumb', 'https://example.test/t.png'),
  'it is a draft Hub-owned course with no Kajabi key and no program, with a free address, a copy title and the same settings and picture');
SELECT is((SELECT slug FROM public.courses WHERE id = (SELECT id FROM copy2)), 'pgtap-dup-copy-3', 'a taken address moves on to the next number');
SELECT is((SELECT slug FROM public.courses WHERE id = (SELECT value #>> '{}' FROM result WHERE label = 'of_hub')), 'pgtap-dup-copy-copy', 'a Hub-owned course can be copied too');

SELECT is((SELECT count(*)::int FROM public.course_modules WHERE course_id = (SELECT id FROM copy)), 3, 'every module is copied');
SELECT is((SELECT count(*)::int FROM public.course_lessons WHERE course_id = (SELECT id FROM copy)), 3, 'every lesson is copied, also the one in no module');
SELECT is((SELECT count(*)::int FROM public.course_modules WHERE course_id = (SELECT id FROM copy) AND (source <> 'hub' OR source_key IS NOT NULL OR publishing_option <> 'draft' OR state <> 'hidden')), 0, 'modules are Hub-owned drafts with no key');
SELECT is((SELECT count(*)::int FROM public.course_lessons WHERE course_id = (SELECT id FROM copy) AND (source <> 'hub' OR source_key IS NOT NULL OR publishing_option <> 'draft' OR state <> 'hidden')), 0, 'lessons are Hub-owned drafts with no key');
SELECT is((SELECT count(*)::int FROM public.course_modules WHERE course_id = (SELECT id FROM copy) AND id LIKE 'mod\_DupCourse%'), 0, 'the modules have new ids');

-- The tree keeps its shape: titles, positions, the submodule under its parent, lessons in their modules.
SELECT is(
  (SELECT jsonb_agg(jsonb_build_array(m.title, m.position, p.title) ORDER BY m.title) FROM public.course_modules m LEFT JOIN public.course_modules p ON p.id = m.parent_id WHERE m.course_id = (SELECT id FROM copy)),
  '[["Module A", 1, null], ["Module B", 2, null], ["Week A1", 1, "Module A"]]'::jsonb,
  'modules keep their positions and the submodule sits under its copied parent');
SELECT is(
  (SELECT jsonb_agg(jsonb_build_array(l.title, l.position, m.title) ORDER BY l.title) FROM public.course_lessons l LEFT JOIN public.course_modules m ON m.id = l.module_id WHERE l.course_id = (SELECT id FROM copy)),
  '[["Lesson A", 1, "Module A"], ["Lesson A1", 3, "Week A1"], ["Loose lesson", 2, null]]'::jsonb,
  'lessons keep their positions and sit in their copied modules');
SELECT is(
  (SELECT jsonb_build_object('video', video_id, 'body', body_html, 'excerpt', excerpt, 'duration', duration_seconds) FROM public.course_lessons WHERE course_id = (SELECT id FROM copy) AND title = 'Lesson A'),
  '{"video": "00000000-0000-4000-a000-00000000d1b1", "body": "<p>Text</p>", "excerpt": "Text", "duration": 120}'::jsonb,
  'a lesson keeps its text and links to the same video (no new video)');
SELECT is((SELECT poster_url FROM public.course_modules WHERE course_id = (SELECT id FROM copy) AND title = 'Module A'), 'https://example.test/p.png', 'a module keeps its poster');
SELECT is((SELECT count(*)::int FROM public.videos WHERE source_key = 'pgtap-dup-video'), 1, 'no video row is made');

SELECT is(
  (SELECT jsonb_build_object('progress', (SELECT count(*) FROM public.lesson_progress WHERE lesson_id IN (SELECT id FROM public.course_lessons WHERE course_id = (SELECT id FROM copy))),
          'access', (SELECT count(*) FROM public.course_access WHERE course_id = (SELECT id FROM copy)),
          'grants', (SELECT count(*) FROM public.course_access_grants WHERE course_id = (SELECT id FROM copy)),
          'files', (SELECT count(*) FROM public.course_lesson_files WHERE lesson_id IN (SELECT id FROM public.course_lessons WHERE course_id = (SELECT id FROM copy))))),
  '{"progress": 0, "access": 0, "grants": 0, "files": 1}'::jsonb,
  'members'' progress, access and grants are not copied (the one download is, see below)');
SELECT is(
  (SELECT jsonb_build_object('name', f.filename, 'path', f.storage_path, 'own_key', f.source_key LIKE 'up-%' AND f.source_key <> 'pgtap-dup-file', 'lesson', l.title)
     FROM public.course_lesson_files f JOIN public.course_lessons l ON l.id = f.lesson_id WHERE l.course_id = (SELECT id FROM copy)),
  '{"name": "a.pdf", "path": "pgtap/a.pdf", "own_key": true, "lesson": "Lesson A"}'::jsonb,
  'a download is copied onto the copied lesson: its own key, the same stored object');
SELECT is((SELECT count(*)::int FROM public.course_lesson_files WHERE lesson_id = 'les_DupCourseA01' AND source_key = 'pgtap-dup-file'), 1, 'and the original keeps its download');

SELECT is(
  (SELECT jsonb_build_object('source', source, 'key', source_key, 'draft', is_draft, 'program', program_id, 'modules', (SELECT count(*) FROM public.course_modules WHERE course_id = 'crs_DupCourse001' AND source = 'kajabi'),
          'lessons', (SELECT count(*) FROM public.course_lessons WHERE course_id = 'crs_DupCourse001' AND source = 'kajabi'),
          'access', (SELECT count(*) FROM public.course_access WHERE course_id = 'crs_DupCourse001'),
          'progress', (SELECT count(*) FROM public.lesson_progress WHERE lesson_id = 'les_DupCourseA01'))
     FROM public.courses WHERE id = 'crs_DupCourse001'),
  '{"source": "kajabi", "key": "pgtap-dup-k", "draft": false, "program": "prg_DupCourse001", "modules": 3, "lessons": 3, "access": 1, "progress": 1}'::jsonb,
  'the original is untouched: still Kajabi''s, published, with its program, tree, access and progress');

SELECT is(
  (SELECT jsonb_build_object('who', changed_by, 'kind', actor_kind, 'label', entity_label, 'from', changes -> 'copied_from' ->> 'new', 'modules', changes -> 'modules_copied' ->> 'new', 'lessons', changes -> 'lessons_copied' ->> 'new', 'files', changes -> 'files_copied' ->> 'new')
     FROM public.audit_log WHERE entity_type = 'course' AND entity_id = (SELECT id FROM copy)),
  jsonb_build_object('who', '00000000-0000-4000-a000-00000000d1a4', 'kind', 'staff', 'label', 'Imported (copy)', 'from', 'crs_DupCourse001', 'modules', '3', 'lessons', '3', 'files', '1'),
  'the new course has one audit entry, as the admin, saying where it came from and what it holds');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type IN ('course_module', 'course_lesson') AND entity_id IN
     (SELECT id FROM public.course_modules WHERE course_id IN (SELECT id FROM copy UNION SELECT id FROM copy2)
      UNION SELECT id FROM public.course_lessons WHERE course_id IN (SELECT id FROM copy UNION SELECT id FROM copy2))),
  0, 'and none for the modules and lessons in it');

-- Adding a module to the copy afterwards is audited as usual: the quiet applies to the copy only.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000d1a4", "email": "dupcourse-dana@example.test", "role": "authenticated"}', true);
INSERT INTO public.course_modules (course_id, title, position, source) SELECT id, 'Added later', 9, 'hub' FROM copy;
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'course_module' AND action = 'insert' AND changes -> 'title' ->> 'new' = 'Added later'), 1, 'a module added to the copy later gets its own entry');

-- Duplicating one lesson, or one module, brings the downloads along too.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000d1a4", "email": "dupcourse-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'lesson_copy', to_jsonb(public.duplicate_course_lesson((SELECT id FROM public.course_lessons WHERE course_id = (SELECT id FROM copy) AND title = 'Lesson A')));
INSERT INTO result SELECT 'module_copy', to_jsonb(public.duplicate_course_module((SELECT id FROM public.course_modules WHERE course_id = (SELECT id FROM copy) AND title = 'Module A')));
INSERT INTO result SELECT 'member_helper', to_jsonb(pg_temp.failure($$SELECT public.copy_course_lesson_files('les_DupCourseA01', 'les_DupCourseA01')$$));
RESET ROLE;
SELECT is(
  (SELECT jsonb_agg(f.storage_path || ' ' || f.filename ORDER BY l.title) FROM public.course_lesson_files f JOIN public.course_lessons l ON l.id = f.lesson_id
    WHERE l.id = (SELECT value #>> '{}' FROM result WHERE label = 'lesson_copy')),
  '["pgtap/a.pdf a.pdf"]'::jsonb, 'a duplicated lesson has the download');
SELECT is(
  (SELECT count(*)::int FROM public.course_lesson_files f JOIN public.course_lessons l ON l.id = f.lesson_id JOIN public.course_modules m ON m.id = l.module_id
    WHERE m.id = (SELECT value #>> '{}' FROM result WHERE label = 'module_copy')),
  2, 'a duplicated module has the downloads of its lessons (the lesson, and the lesson''s earlier copy in the same module)');
SELECT is((SELECT count(DISTINCT source_key)::int FROM public.course_lesson_files WHERE storage_path = 'pgtap/a.pdf'), 6, 'every copy has a key of its own');
SELECT is((SELECT count(*)::int FROM public.course_lesson_files WHERE storage_path = 'pgtap/a.pdf'), 6, 'and all of them point at the one stored object');
SELECT is((SELECT value FROM result WHERE label = 'member_helper'), '"not_editable"'::jsonb, 'the helper refuses a target that is not a Hub-owned lesson');

SELECT * FROM finish(true);
ROLLBACK;
