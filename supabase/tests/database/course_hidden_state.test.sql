-- pgTAP tests for hidden (draft) course lessons and modules (20261129000100): the tables hold them, and
-- members never read them through row-level security while staff do. Runs in one transaction that is rolled
-- back, so it leaves the shared local DB untouched. Run with `npm run test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(9);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f0a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hidden-alice@example.test'),
  ('00000000-0000-4000-a000-00000000f0a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hidden-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f0a1', 'hidden-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f0a4', 'hidden-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000f001', 'Hidden Alice', 'hidden-alice@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000f004', 'Hidden Dana', 'hidden-dana@example.test', now(), 'active');
UPDATE public.members SET user_id = '00000000-0000-4000-a000-00000000f0a1' WHERE id = '00000000-0000-4000-a000-00000000f001';
UPDATE public.members SET user_id = '00000000-0000-4000-a000-00000000f0a4' WHERE id = '00000000-0000-4000-a000-00000000f004';

INSERT INTO public.courses (id, slug, title, source_key) VALUES
  ('00000000-0000-4000-a000-00000000f100', 'pgtap-hidden', 'PgTAP Hidden', 'pgtap-hidden');
INSERT INTO public.course_access (member_id, course_id, starts_at, ends_at, origin) VALUES
  ('00000000-0000-4000-a000-00000000f001', '00000000-0000-4000-a000-00000000f100', now() - interval '1 day', NULL, 'purchase');

-- One open module and one hidden one, with an open, a coming-soon and a hidden lesson.
INSERT INTO public.course_modules (id, course_id, title, position, state, source_key) VALUES
  ('00000000-0000-4000-a000-00000000f110', '00000000-0000-4000-a000-00000000f100', 'Open module', 1, 'open', 'hidden-m-open'),
  ('00000000-0000-4000-a000-00000000f111', '00000000-0000-4000-a000-00000000f100', 'Draft module', 2, 'hidden', 'hidden-m-draft');
INSERT INTO public.course_lessons (id, course_id, module_id, title, position, state, source_key) VALUES
  ('00000000-0000-4000-a000-00000000f200', '00000000-0000-4000-a000-00000000f100', '00000000-0000-4000-a000-00000000f110', 'Open lesson', 1, 'open', 'hidden-l-open'),
  ('00000000-0000-4000-a000-00000000f201', '00000000-0000-4000-a000-00000000f100', '00000000-0000-4000-a000-00000000f110', 'Soon lesson', 2, 'coming_soon', 'hidden-l-soon'),
  ('00000000-0000-4000-a000-00000000f202', '00000000-0000-4000-a000-00000000f100', '00000000-0000-4000-a000-00000000f110', 'Draft lesson', 3, 'hidden', 'hidden-l-draft'),
  ('00000000-0000-4000-a000-00000000f203', '00000000-0000-4000-a000-00000000f100', '00000000-0000-4000-a000-00000000f111', 'Lesson in a draft module', 1, 'hidden', 'hidden-l-in-draft');

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;
-- Alice has access to the course: she reads the open lesson only, and the modules that aren't hidden.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f0a1", "email": "hidden-alice@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'alice_lessons', to_jsonb(count(*)) FROM public.course_lessons WHERE course_id = '00000000-0000-4000-a000-00000000f100';
INSERT INTO result SELECT 'alice_hidden_lessons', to_jsonb(count(*)) FROM public.course_lessons WHERE state = 'hidden';
INSERT INTO result SELECT 'alice_modules', to_jsonb(count(*)) FROM public.course_modules WHERE course_id = '00000000-0000-4000-a000-00000000f100';
INSERT INTO result SELECT 'alice_hidden_modules', to_jsonb(count(*)) FROM public.course_modules WHERE state = 'hidden';

-- Dana is staff: she reads everything, hidden included.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f0a4", "email": "hidden-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'dana_lessons', to_jsonb(count(*)) FROM public.course_lessons WHERE course_id = '00000000-0000-4000-a000-00000000f100';
INSERT INTO result SELECT 'dana_modules', to_jsonb(count(*)) FROM public.course_modules WHERE course_id = '00000000-0000-4000-a000-00000000f100';
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'alice_lessons'), '1'::jsonb, 'a member reads only the open lesson, not the coming-soon or the draft ones');
SELECT is((SELECT value FROM result WHERE label = 'alice_hidden_lessons'), '0'::jsonb, 'a member never reads a hidden lesson');
SELECT is((SELECT value FROM result WHERE label = 'alice_modules'), '1'::jsonb, 'a member reads the modules that are not hidden');
SELECT is((SELECT value FROM result WHERE label = 'alice_hidden_modules'), '0'::jsonb, 'a member never reads a hidden module');
SELECT is((SELECT value FROM result WHERE label = 'dana_lessons'), '4'::jsonb, 'staff read every lesson, drafts included');
SELECT is((SELECT value FROM result WHERE label = 'dana_modules'), '2'::jsonb, 'staff read every module, drafts included');

-- The tables hold the state, and nothing else.
SELECT lives_ok(
  $$UPDATE public.course_lessons SET state = 'hidden' WHERE id = '00000000-0000-4000-a000-00000000f200'$$,
  'a lesson can be hidden');
SELECT throws_ok(
  $$UPDATE public.course_lessons SET state = 'draft' WHERE id = '00000000-0000-4000-a000-00000000f200'$$,
  '23514', NULL, 'only open, coming_soon and hidden are lesson states');
SELECT throws_ok(
  $$UPDATE public.course_modules SET state = 'draft' WHERE id = '00000000-0000-4000-a000-00000000f110'$$,
  '23514', NULL, 'only open, coming_soon and hidden are module states');

SELECT * FROM finish(true);
ROLLBACK;
