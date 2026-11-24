-- pgTAP tests for duplicating a course (20270710000000): a new draft Hub-owned course with a copy of the tree
-- (new ids, positions kept, the same videos and images), nothing of members' progress or access, the source untouched,
-- and one audit entry for the new course instead of one per module and lesson. Runs in one transaction that is
-- rolled back, so it leaves the shared local DB untouched. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(46);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000d1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dupcourse-alice@example.test'),
  ('00000000-0000-4000-a000-00000000d1a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dupcourse-dana@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-00000000d1a1', 'dupcourse-alice@example.test'),
  ('00000000-0000-4000-a000-00000000d1a4', 'dupcourse-dana@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-a000-00000000d1a4', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;

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

-- A quiz in the submodule's lesson (as an imported one has Kajabi keys): a passing grade, hidden answers, two questions (one
-- choose-one, one choose-several) with their options, and a member's attempt with its answers.
INSERT INTO public.quizzes (id, lesson_id, passing_percent, hide_answers, revision, source_key) VALUES ('quiz_DupCourseQ01', 'les_DupCourseA11', 80, true, 4, 'pgtap-dup-quiz');
INSERT INTO public.quiz_questions (id, quiz_id, position, prompt, allows_multiple, source_key) VALUES
  ('qques_DupCourseQ01', 'quiz_DupCourseQ01', 1, 'Pick one', false, 'pgtap-dup-q1'),
  ('qques_DupCourseQ02', 'quiz_DupCourseQ01', 2, 'Pick all that apply', true, 'pgtap-dup-q2');
INSERT INTO public.quiz_questions (id, quiz_id, position, prompt, kind, graded, source_key) VALUES
  ('qques_DupCourseQ03', 'quiz_DupCourseQ01', 3, 'In your words', 'short_answer', false, 'pgtap-dup-q3');
INSERT INTO public.quiz_options (id, question_id, position, label, is_correct, source_key) VALUES
  ('qopt_DupCourseO01', 'qques_DupCourseQ01', 1, 'Wrong', false, 'pgtap-dup-o1'),
  ('qopt_DupCourseO02', 'qques_DupCourseQ01', 2, 'Right', true, 'pgtap-dup-o2'),
  ('qopt_DupCourseO03', 'qques_DupCourseQ02', 1, 'Yes A', true, 'pgtap-dup-o3'),
  ('qopt_DupCourseO04', 'qques_DupCourseQ02', 2, 'Yes B', true, 'pgtap-dup-o4');
INSERT INTO public.quiz_attempts (id, quiz_id, member_id, question_count, correct_count, score_percent, passed) VALUES ('qatt_DupCourseA01', 'quiz_DupCourseQ01', 'mbr_DupCourse0001', 2, 2, 100, true);
INSERT INTO public.quiz_attempt_answers (attempt_id, question_id, selected_option_ids, is_correct) VALUES ('qatt_DupCourseA01', 'qques_DupCourseQ01', ARRAY['qopt_DupCourseO02'], true);

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

-- Quizzes: the copy of the course holds a copy of the quiz, with the settings, questions, options and right answers.
CREATE TEMP TABLE qshape(label text, value jsonb) ON COMMIT DROP;
CREATE FUNCTION pg_temp.quiz_shape(p_lesson text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'passing', q.passing_percent, 'hide', q.hide_answers,
    'questions', (SELECT jsonb_agg(jsonb_build_array(qq.position, qq.prompt, qq.allows_multiple, qq.kind, qq.graded,
                   (SELECT jsonb_agg(jsonb_build_array(o.position, o.label, o.is_correct) ORDER BY o.position) FROM public.quiz_options o WHERE o.question_id = qq.id)) ORDER BY qq.position)
                  FROM public.quiz_questions qq WHERE qq.quiz_id = q.id))
    FROM public.quizzes q WHERE q.lesson_id = p_lesson
$$;
CREATE TEMP TABLE qlessons AS
  SELECT (SELECT l.id FROM public.course_lessons l JOIN public.course_modules m ON m.id = l.module_id JOIN public.course_modules p ON p.id = m.parent_id
           WHERE l.course_id = (SELECT id FROM copy) AND l.title = 'Lesson A1' AND p.title = 'Module A') AS copied;
GRANT SELECT ON qlessons TO authenticated;

SELECT is(pg_temp.quiz_shape('les_DupCourseA11'),
  '{"passing": 80, "hide": true, "questions": [[1, "Pick one", false, "choice", true, [[1, "Wrong", false], [2, "Right", true]]], [2, "Pick all that apply", true, "choice", true, [[1, "Yes A", true], [2, "Yes B", true]]], [3, "In your words", false, "short_answer", false, null]]}'::jsonb,
  'the original quiz is untouched (a short answer question has no options)');
SELECT is(pg_temp.quiz_shape((SELECT copied FROM qlessons)), pg_temp.quiz_shape('les_DupCourseA11'),
  'a duplicated course copies its quiz: passing grade, hide answers, questions, options in order and which are right');
SELECT is((SELECT count(*)::int FROM public.quizzes WHERE lesson_id IN (SELECT id FROM public.course_lessons WHERE course_id = (SELECT id FROM copy2))), 1, 'exactly the one quiz is copied');
SELECT is(
  (SELECT jsonb_build_object('quiz', (SELECT count(*) FROM public.quizzes q WHERE q.lesson_id = (SELECT copied FROM qlessons) AND (q.id = 'quiz_DupCourseQ01' OR q.source_key IS NOT NULL OR q.revision <> 0)),
          'questions', (SELECT count(*) FROM public.quiz_questions qq JOIN public.quizzes q ON q.id = qq.quiz_id WHERE q.lesson_id = (SELECT copied FROM qlessons) AND (qq.id LIKE 'qques\_DupCourse%' OR qq.source_key IS NOT NULL)),
          'options', (SELECT count(*) FROM public.quiz_options o JOIN public.quiz_questions qq ON qq.id = o.question_id JOIN public.quizzes q ON q.id = qq.quiz_id WHERE q.lesson_id = (SELECT copied FROM qlessons) AND (o.id LIKE 'qopt\_DupCourse%' OR o.source_key IS NOT NULL)))),
  '{"quiz": 0, "questions": 0, "options": 0}'::jsonb, 'the copied quiz, questions and options have new ids and no Kajabi keys');
SELECT is(
  (SELECT jsonb_build_object('attempts', (SELECT count(*) FROM public.quiz_attempts a JOIN public.quizzes q ON q.id = a.quiz_id WHERE q.lesson_id = (SELECT copied FROM qlessons)),
          'answers', (SELECT count(*) FROM public.quiz_attempt_answers x JOIN public.quiz_questions qq ON qq.id = x.question_id JOIN public.quizzes q ON q.id = qq.quiz_id WHERE q.lesson_id = (SELECT copied FROM qlessons)))),
  '{"attempts": 0, "answers": 0}'::jsonb, 'no attempts or answers are copied');
SELECT is((SELECT count(*)::int FROM public.quiz_attempts WHERE quiz_id = 'quiz_DupCourseQ01') + (SELECT count(*)::int FROM public.quiz_attempt_answers WHERE attempt_id = 'qatt_DupCourseA01'), 2, 'the original keeps its attempt and its answer');
SELECT is((SELECT count(*)::int FROM public.quiz_questions WHERE quiz_id = 'quiz_DupCourseQ01') + (SELECT count(*)::int FROM public.quiz_options WHERE question_id IN ('qques_DupCourseQ01', 'qques_DupCourseQ02')), 7, 'and its questions and options');
SELECT is((SELECT changes -> 'quizzes_copied' ->> 'new' FROM public.audit_log WHERE entity_type = 'course' AND entity_id = (SELECT id FROM copy)), '1', 'the course''s audit entry counts the quizzes copied');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'quiz' AND entity_id IN (SELECT id FROM public.quizzes WHERE lesson_id IN (SELECT id FROM public.course_lessons WHERE course_id = (SELECT id FROM copy2) UNION SELECT copied FROM qlessons))), 0, 'and there is no entry per copied quiz');

-- One lesson, and one module.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000d1a4", "email": "dupcourse-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'quiz_lesson_copy', to_jsonb(public.duplicate_course_lesson((SELECT copied FROM qlessons)));
RESET ROLE;
SELECT is(pg_temp.quiz_shape((SELECT value #>> '{}' FROM result WHERE label = 'quiz_lesson_copy')), pg_temp.quiz_shape('les_DupCourseA11'),
  'duplicating a quiz lesson copies the quiz with its questions, options and right answers');
SELECT is((SELECT jsonb_build_object('draft', publishing_option, 'state', state, 'source', source) FROM public.course_lessons WHERE id = (SELECT value #>> '{}' FROM result WHERE label = 'quiz_lesson_copy')),
  '{"draft": "draft", "state": "hidden", "source": "hub"}'::jsonb, 'the copied quiz lesson is a Hub-owned draft');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'quiz' AND action = 'insert' AND entity_id = (SELECT id FROM public.quizzes WHERE lesson_id = (SELECT value #>> '{}' FROM result WHERE label = 'quiz_lesson_copy'))), 1, 'a quiz copied with one lesson gets its own audit entry, as the admin');
SELECT is((SELECT count(*)::int FROM public.quiz_attempts a JOIN public.quizzes q ON q.id = a.quiz_id WHERE q.lesson_id = (SELECT value #>> '{}' FROM result WHERE label = 'quiz_lesson_copy')), 0, 'and has no attempts');
SELECT is((SELECT count(*)::int FROM public.quizzes WHERE lesson_id = 'les_DupCourseA01'), 0, 'a lesson without a quiz gets none');

-- The module copy made earlier held the submodule with the quiz lesson.
SELECT is(
  (SELECT pg_temp.quiz_shape(l.id) FROM public.course_lessons l JOIN public.course_modules m ON m.id = l.module_id
    WHERE l.title = 'Lesson A1' AND m.parent_id = (SELECT value #>> '{}' FROM result WHERE label = 'module_copy')),
  pg_temp.quiz_shape('les_DupCourseA11'), 'duplicating a module copies the quizzes of its submodules'' lessons');
SELECT is(
  (SELECT count(*)::int FROM public.quiz_attempts a JOIN public.quizzes q ON q.id = a.quiz_id JOIN public.course_lessons l ON l.id = q.lesson_id JOIN public.course_modules m ON m.id = l.module_id
    WHERE m.parent_id = (SELECT value #>> '{}' FROM result WHERE label = 'module_copy')), 0, 'and no attempts');
SELECT * FROM finish(true);
ROLLBACK;
