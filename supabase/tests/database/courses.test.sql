-- pgTAP tests for the course tables (20261111000100, 20261112000300): who can read course content, access rows,
-- videos, and the member-owned progress and watch segments.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `npm run test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(16);

-- Alice has current access, Bob's access ended, Cara has none, Dana is an admin.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000c0a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'course-alice@example.test'),
  ('00000000-0000-4000-a000-00000000c0a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'course-bob@example.test'),
  ('00000000-0000-4000-a000-00000000c0a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'course-cara@example.test'),
  ('00000000-0000-4000-a000-00000000c0a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'course-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000c0a1', 'course-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000c0a2', 'course-bob@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000c0a3', 'course-cara@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000c0a4', 'course-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000c001', 'Course Alice', 'course-alice@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000c002', 'Course Bob', 'course-bob@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000c003', 'Course Cara', 'course-cara@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000c004', 'Course Dana', 'course-dana@example.test', now(), 'active');

INSERT INTO public.courses (id, slug, title, source_key) VALUES
  ('00000000-0000-4000-a000-00000000c100', 'pgtap-course', 'PgTAP Course', 'pgtap-course');
INSERT INTO public.course_lessons (id, course_id, title, source_key) VALUES
  ('00000000-0000-4000-a000-00000000c200', '00000000-0000-4000-a000-00000000c100', 'Lesson', 'pgtap-lesson');
INSERT INTO public.course_lessons (id, course_id, title, state, body_html, source_key) VALUES
  ('00000000-0000-4000-a000-00000000c201', '00000000-0000-4000-a000-00000000c100', 'Coming soon lesson', 'coming_soon', '<p>not yet</p>', 'pgtap-lesson-soon');
INSERT INTO public.videos (id, source_kind, source_key) VALUES
  ('00000000-0000-4000-a000-00000000c300', 'upload', 'pgtap-video');
INSERT INTO public.course_access (member_id, course_id, starts_at, ends_at, origin) VALUES
  ('00000000-0000-4000-a000-00000000c001', '00000000-0000-4000-a000-00000000c100', now() - interval '1 day', NULL, 'purchase'),
  ('00000000-0000-4000-a000-00000000c002', '00000000-0000-4000-a000-00000000c100', now() - interval '2 years', now() - interval '1 year', 'purchase');

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;

-- Alice: opens the course, sees her access row, can't see videos, saves progress and a watch
-- segment, but can't write them for Bob or change a segment.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000c0a1", "email": "course-alice@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'alice_lessons', to_jsonb(count(*)) FROM public.course_lessons;
INSERT INTO result SELECT 'alice_soon_lessons', to_jsonb(count(*)) FROM public.course_lessons WHERE state = 'coming_soon';
INSERT INTO result SELECT 'alice_access_rows', to_jsonb(count(*)) FROM public.course_access;
INSERT INTO result SELECT 'alice_videos', to_jsonb(count(*)) FROM public.videos;
INSERT INTO public.lesson_progress (member_id, lesson_id, last_position_seconds)
VALUES ('00000000-0000-4000-a000-00000000c001', '00000000-0000-4000-a000-00000000c200', 12);
INSERT INTO public.video_watch_segments (member_id, video_id, session_id, start_seconds, end_seconds)
VALUES ('00000000-0000-4000-a000-00000000c001', '00000000-0000-4000-a000-00000000c300', gen_random_uuid(), 0, 5);
INSERT INTO result SELECT 'alice_segments', to_jsonb(count(*)) FROM public.video_watch_segments;

-- Bob (access ended) and Cara (never had it) get no lessons.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000c0a2", "email": "course-bob@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'bob_lessons', to_jsonb(count(*)) FROM public.course_lessons;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000c0a3", "email": "course-cara@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'cara_lessons', to_jsonb(count(*)) FROM public.course_lessons;
INSERT INTO result SELECT 'cara_progress', to_jsonb(count(*)) FROM public.lesson_progress;

-- Dana (admin): sees the content, videos and Alice's progress.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000c0a4", "email": "course-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'admin_lessons', to_jsonb(count(*)) FROM public.course_lessons;
INSERT INTO result SELECT 'admin_videos', to_jsonb(count(*)) FROM public.videos WHERE id = '00000000-0000-4000-a000-00000000c300';
INSERT INTO result SELECT 'admin_progress', to_jsonb(count(*)) FROM public.lesson_progress;
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'alice_lessons'), '1'::jsonb, 'a member with current access reads the lessons');
SELECT is((SELECT value FROM result WHERE label = 'alice_access_rows'), '1'::jsonb, 'a member sees only their own access row');
SELECT is((SELECT value FROM result WHERE label = 'alice_videos'), '0'::jsonb, 'members never read the videos table');
SELECT is((SELECT value FROM result WHERE label = 'alice_segments'), '1'::jsonb, 'a member adds and reads their own watch segment');
SELECT ok(NOT has_table_privilege('authenticated', 'public.video_watch_segments', 'UPDATE'), 'watch segments are append-only for members');
SELECT is((SELECT value FROM result WHERE label = 'bob_lessons'), '0'::jsonb, 'ended access opens no lessons');
SELECT is((SELECT value FROM result WHERE label = 'cara_lessons'), '0'::jsonb, 'no access opens no lessons');
SELECT is((SELECT value FROM result WHERE label = 'cara_progress'), '0'::jsonb, 'a member does not see another member''s progress');
SELECT is((SELECT value FROM result WHERE label = 'admin_lessons'), '2'::jsonb, 'admins read every lesson, coming soon ones included');
SELECT is((SELECT value FROM result WHERE label = 'alice_soon_lessons'), '0'::jsonb, 'members cannot read a lesson that is still coming soon');
SELECT is((SELECT value FROM result WHERE label = 'admin_videos'), '1'::jsonb, 'admins read videos');
SELECT is((SELECT value FROM result WHERE label = 'admin_progress'), '1'::jsonb, 'admins read members'' progress');

-- A resent watch segment (same member and client id) is refused by the unique index, which the
-- route turns into a no-op; rows without a client id never collide.
INSERT INTO public.video_watch_segments (member_id, video_id, session_id, start_seconds, end_seconds, client_segment_id)
VALUES ('00000000-0000-4000-a000-00000000c001', '00000000-0000-4000-a000-00000000c300', gen_random_uuid(), 0, 5, '00000000-0000-4000-a000-00000000d001');
SELECT throws_ok(
  $$INSERT INTO public.video_watch_segments (member_id, video_id, session_id, start_seconds, end_seconds, client_segment_id)
    VALUES ('00000000-0000-4000-a000-00000000c001', '00000000-0000-4000-a000-00000000c300', gen_random_uuid(), 0, 5, '00000000-0000-4000-a000-00000000d001')$$,
  '23505', NULL, 'the same client segment id twice for one member is refused');
SELECT lives_ok(
  $$INSERT INTO public.video_watch_segments (member_id, video_id, session_id, start_seconds, end_seconds, client_segment_id)
    VALUES ('00000000-0000-4000-a000-00000000c001', '00000000-0000-4000-a000-00000000c300', gen_random_uuid(), 0, 5, NULL),
           ('00000000-0000-4000-a000-00000000c001', '00000000-0000-4000-a000-00000000c300', gen_random_uuid(), 0, 5, NULL)$$,
  'rows without a client id never collide');
SELECT lives_ok(
  $$INSERT INTO public.video_watch_segments (member_id, video_id, session_id, start_seconds, end_seconds, client_segment_id)
    VALUES ('00000000-0000-4000-a000-00000000c002', '00000000-0000-4000-a000-00000000c300', gen_random_uuid(), 0, 5, '00000000-0000-4000-a000-00000000d001')$$,
  'the same client id for a different member is a different segment');

SELECT * FROM finish(true);
ROLLBACK;
