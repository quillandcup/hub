-- pgTAP tests for deleting a course (20271123000000): only an admin; only a Hub-owned draft course that no member has access
-- to (progress, comments and chat video links on its lessons do not block, and go with it); the tree, downloads and old addresses go with it, other courses and the shared videos stay,
-- and the audit log gets one entry for the course instead of one per module and lesson. Runs in one transaction that is
-- rolled back, so it leaves the shared local DB untouched. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(23);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000e1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'delcourse-alice@example.test'),
  ('00000000-0000-4000-a000-00000000e1a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'delcourse-dana@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-00000000e1a1', 'delcourse-alice@example.test'),
  ('00000000-0000-4000-a000-00000000e1a4', 'delcourse-dana@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-a000-00000000e1a4', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.videos (id, source_kind, source_key, status) VALUES ('00000000-0000-4000-a000-00000000e1b1', 'kajabi', 'pgtap-del-video', 'ready');
INSERT INTO public.members (id, name, email, joined_at, status) VALUES ('mbr_DelCourse0001', 'Del Member', 'delcourse-member@example.test', now(), 'active');

-- The course to delete (a draft the Hub owns) with a module, a submodule, lessons, a download and the shared video; a second
-- Hub draft that must stay; and one course for each reason to refuse.
INSERT INTO public.courses (id, slug, title, source, source_key, is_draft) VALUES
  ('crs_DelCourse001', 'pgtap-del', 'Doomed', 'hub', NULL, true),
  ('crs_DelCourse002', 'pgtap-del-other', 'Other', 'hub', NULL, true),
  ('crs_DelCourse003', 'pgtap-del-kajabi', 'Imported', 'kajabi', 'pgtap-del-k', true),
  ('crs_DelCourse004', 'pgtap-del-live', 'Published', 'hub', NULL, false),
  ('crs_DelCourse005', 'pgtap-del-grant', 'Granted', 'hub', NULL, true),
  ('crs_DelCourse006', 'pgtap-del-access', 'Access', 'hub', NULL, true),
  ('crs_DelCourse007', 'pgtap-del-progress', 'Progress', 'hub', NULL, true),
  ('crs_DelCourse008', 'pgtap-del-comment', 'Comment', 'hub', NULL, true);
INSERT INTO public.course_modules (id, course_id, parent_id, title, position, publishing_option, state, source) VALUES
  ('mod_DelCourseA01', 'crs_DelCourse001', NULL, 'Module A', 1, 'draft', 'hidden', 'hub'),
  ('mod_DelCourseA11', 'crs_DelCourse001', 'mod_DelCourseA01', 'Week A1', 1, 'draft', 'hidden', 'hub'),
  ('mod_DelCourseO01', 'crs_DelCourse002', NULL, 'Other module', 1, 'draft', 'hidden', 'hub');
INSERT INTO public.course_lessons (id, course_id, module_id, title, position, publishing_option, state, video_id, source) VALUES
  ('les_DelCourseA01', 'crs_DelCourse001', 'mod_DelCourseA01', 'Lesson A', 1, 'draft', 'hidden', '00000000-0000-4000-a000-00000000e1b1', 'hub'),
  ('les_DelCourseL01', 'crs_DelCourse001', NULL, 'Loose lesson', 2, 'draft', 'hidden', NULL, 'hub'),
  ('les_DelCourseO01', 'crs_DelCourse002', 'mod_DelCourseO01', 'Other lesson', 1, 'draft', 'hidden', '00000000-0000-4000-a000-00000000e1b1', 'hub'),
  ('les_DelCourseP01', 'crs_DelCourse007', NULL, 'Progress lesson', 1, 'draft', 'hidden', NULL, 'hub'),
  ('les_DelCourseC01', 'crs_DelCourse008', NULL, 'Comment lesson', 1, 'draft', 'hidden', NULL, 'hub');
INSERT INTO public.course_lesson_files (lesson_id, source_key, filename, storage_path) VALUES
  ('les_DelCourseA01', 'pgtap-del-file', 'a.pdf', 'pgtap/del/a.pdf'),
  ('les_DelCourseO01', 'pgtap-del-file-2', 'a.pdf', 'pgtap/del/a.pdf');
INSERT INTO public.course_access_grants (member_id, course_id) VALUES ('mbr_DelCourse0001', 'crs_DelCourse005');
INSERT INTO public.course_access (member_id, course_id, starts_at, origin) VALUES ('mbr_DelCourse0001', 'crs_DelCourse006', now(), 'purchase');
-- Stray activity on two unused drafts: progress and a comment on one, a comment and a chat message sharing a lesson's video on the other.
INSERT INTO public.lesson_progress (member_id, lesson_id, completed_at) VALUES ('mbr_DelCourse0001', 'les_DelCourseP01', now());
INSERT INTO public.lesson_comments (lesson_id, member_id, body) VALUES ('les_DelCourseP01', 'mbr_DelCourse0001', 'A test comment'), ('les_DelCourseC01', 'mbr_DelCourse0001', 'A question');
INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id) VALUES ('chn_DelCourse0001', 'channel', 'public', false, 'delcourse-open', 'PGTAP_DEL_OPEN');
INSERT INTO public.chat_messages (id, channel_id, author_member_id, created_at, origin, slack_sync_status) VALUES ('msg_DelCourse0001', 'chn_DelCourse0001', 'mbr_DelCourse0001', now(), 'app', 'sent');
INSERT INTO public.chat_message_contents (message_id, body) VALUES ('msg_DelCourse0001', 'Look at this lesson');
INSERT INTO public.chat_message_videos (message_id, lesson_id) VALUES ('msg_DelCourse0001', 'les_DelCourseC01');

-- A course that was published once and renamed, so it holds an old address; then unpublished.
INSERT INTO public.courses (id, slug, title, source, source_key, is_draft) VALUES ('crs_DelCourse009', 'pgtap-del-old', 'Once live', 'hub', NULL, false);
UPDATE public.courses SET slug = 'pgtap-del-new' WHERE id = 'crs_DelCourse009';
UPDATE public.courses SET is_draft = true WHERE id = 'crs_DelCourse009';

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

SELECT is((SELECT count(*)::int FROM public.course_address_redirects WHERE course_id = 'crs_DelCourse009'), 1, 'setup: the once-published course holds an old address');

SET LOCAL ROLE authenticated;

-- Alice (a member) can delete nothing.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e1a1", "email": "delcourse-alice@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'member', to_jsonb(pg_temp.failure($$SELECT public.delete_course('crs_DelCourse001')$$));

-- Dana (an admin).
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e1a4", "email": "delcourse-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'unknown', to_jsonb(pg_temp.failure($$SELECT public.delete_course('crs_Nope00000001')$$));
INSERT INTO result SELECT 'kajabi', to_jsonb(pg_temp.failure($$SELECT public.delete_course('crs_DelCourse003')$$));
INSERT INTO result SELECT 'published', to_jsonb(pg_temp.failure($$SELECT public.delete_course('crs_DelCourse004')$$));
INSERT INTO result SELECT 'grant', to_jsonb(pg_temp.failure($$SELECT public.delete_course('crs_DelCourse005')$$));
INSERT INTO result SELECT 'access', to_jsonb(pg_temp.failure($$SELECT public.delete_course('crs_DelCourse006')$$));
SELECT public.delete_course('crs_DelCourse001');
SELECT public.delete_course('crs_DelCourse007');
SELECT public.delete_course('crs_DelCourse008');
SELECT public.delete_course('crs_DelCourse009');
INSERT INTO result SELECT 'again', to_jsonb(pg_temp.failure($$SELECT public.delete_course('crs_DelCourse001')$$));
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'member'), '"not_editable"'::jsonb, 'a member can''t delete a course');
SELECT is((SELECT value FROM result WHERE label = 'unknown'), '"not_found"'::jsonb, 'a course that isn''t there is not found');
SELECT is((SELECT value FROM result WHERE label = 'kajabi'), '"not_deletable"'::jsonb, 'a course imported from Kajabi is refused (the next import would bring it back)');
SELECT is((SELECT value FROM result WHERE label = 'published'), '"published"'::jsonb, 'a published course is refused until it is unpublished');
SELECT is((SELECT value FROM result WHERE label = 'grant'), '"has_members"'::jsonb, 'a course with a grant is refused');
SELECT is((SELECT value FROM result WHERE label = 'access'), '"has_members"'::jsonb, 'a course with access is refused');
SELECT is((SELECT value FROM result WHERE label = 'again'), '"not_found"'::jsonb, 'a deleted course is gone: a second try is not found');
SELECT is((SELECT count(*)::int FROM public.courses WHERE id IN ('crs_DelCourse003', 'crs_DelCourse004', 'crs_DelCourse005', 'crs_DelCourse006')), 4, 'every refused course is still there');

-- Stray activity does not block: both drafts went, with the progress, comments and chat video link on their lessons; the chat message stays.
SELECT is((SELECT count(*)::int FROM public.courses WHERE id IN ('crs_DelCourse007', 'crs_DelCourse008')), 0, 'a draft with progress and comments, and one with a comment and a chat video link, can be deleted');
SELECT is(
  (SELECT jsonb_build_object('progress', (SELECT count(*) FROM public.lesson_progress WHERE lesson_id IN ('les_DelCourseP01', 'les_DelCourseC01')),
                             'comments', (SELECT count(*) FROM public.lesson_comments WHERE lesson_id IN ('les_DelCourseP01', 'les_DelCourseC01')),
                             'links', (SELECT count(*) FROM public.chat_message_videos WHERE message_id = 'msg_DelCourse0001'))),
  '{"progress": 0, "comments": 0, "links": 0}'::jsonb, 'with that progress, those comments and the link');
SELECT is((SELECT count(*)::int FROM public.chat_messages m JOIN public.chat_message_contents c ON c.message_id = m.id WHERE m.id = 'msg_DelCourse0001'), 1, 'and the chat message itself, with its text, is kept');
SELECT is(
  (SELECT jsonb_build_object('modules', changes -> 'modules_deleted' ->> 'old', 'lessons', changes -> 'lessons_deleted' ->> 'old', 'progress', changes -> 'progress_deleted' ->> 'old', 'comments', changes -> 'comments_deleted' ->> 'old', 'links', changes -> 'chat_video_links_deleted' ->> 'old')
     FROM public.audit_log WHERE entity_type = 'course' AND entity_id = 'crs_DelCourse008' AND action = 'delete'),
  '{"modules": "0", "lessons": "1", "progress": "0", "comments": "1", "links": "1"}'::jsonb, 'the audit entry counts what was removed with the course');

SELECT is((SELECT count(*)::int FROM public.courses WHERE id IN ('crs_DelCourse001', 'crs_DelCourse009')), 0, 'the deleted courses are gone');
SELECT is(
  (SELECT jsonb_build_object('modules', (SELECT count(*) FROM public.course_modules WHERE course_id = 'crs_DelCourse001'),
                             'lessons', (SELECT count(*) FROM public.course_lessons WHERE course_id = 'crs_DelCourse001'),
                             'files', (SELECT count(*) FROM public.course_lesson_files WHERE lesson_id = 'les_DelCourseA01'))),
  '{"modules": 0, "lessons": 0, "files": 0}'::jsonb, 'with their modules, submodules, lessons and download rows');
SELECT is((SELECT count(*)::int FROM public.course_address_redirects WHERE course_id = 'crs_DelCourse009'), 0, 'and the old address they held');
SELECT is(
  (SELECT jsonb_build_object('course', (SELECT count(*) FROM public.courses WHERE id = 'crs_DelCourse002'),
                             'modules', (SELECT count(*) FROM public.course_modules WHERE course_id = 'crs_DelCourse002'),
                             'lessons', (SELECT count(*) FROM public.course_lessons WHERE course_id = 'crs_DelCourse002'),
                             'files', (SELECT count(*) FROM public.course_lesson_files WHERE lesson_id = 'les_DelCourseO01'))),
  '{"course": 1, "modules": 1, "lessons": 1, "files": 1}'::jsonb, 'another course, its tree and its download are untouched (the stored file is shared and stays)');
SELECT is((SELECT count(*)::int FROM public.videos WHERE id = '00000000-0000-4000-a000-00000000e1b1'), 1, 'the shared video stays');

SELECT is(
  (SELECT jsonb_build_object('who', changed_by, 'kind', actor_kind, 'label', entity_label, 'title', changes -> 'title' ->> 'old', 'modules', changes -> 'modules_deleted' ->> 'old', 'lessons', changes -> 'lessons_deleted' ->> 'old')
     FROM public.audit_log WHERE entity_type = 'course' AND entity_id = 'crs_DelCourse001' AND action = 'delete'),
  jsonb_build_object('who', '00000000-0000-4000-a000-00000000e1a4', 'kind', 'staff', 'label', 'Doomed', 'title', 'Doomed', 'modules', '2', 'lessons', '2'),
  'the course has one delete entry, as the admin, saying what it was and how many modules and lessons went with it');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE action = 'delete' AND entity_type IN ('course_module', 'course_lesson') AND entity_id IN ('mod_DelCourseA01', 'mod_DelCourseA11', 'les_DelCourseA01', 'les_DelCourseL01')),
  0, 'and none for the modules and lessons that went with it');

-- Deleting a lesson on its own is audited as usual: the quiet applies to a course delete only.
DELETE FROM public.course_lessons WHERE id = 'les_DelCourseO01';
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE action = 'delete' AND entity_type = 'course_lesson' AND entity_id = 'les_DelCourseO01'), 1, 'a lesson deleted on its own still gets its entry');
SELECT is((SELECT coalesce(current_setting('app.audit_skip_course', true), '')), '', 'the audit setting is cleared again');

-- The grants: a signed-out caller can't run it.
SELECT is(has_function_privilege('anon', 'public.delete_course(text)', 'EXECUTE'), false, 'anon can''t execute it');

SELECT * FROM finish(true);
ROLLBACK;
