-- pgTAP tests for the founding-hedgies profile features:
--   * member_notes (20260928000600): author-only, no admin access.
--   * member_ask_me_about (20260928000500): readable by every member, writable by the owner/admin.
--   * get_member_directory (20260928000700): current members' public fields only.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `npm run test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(16);

-- Alice and Bob are regular members, Carol cancelled, Dana an admin. Fixed ids nothing else uses.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000c9a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notes-alice@example.test'),
  ('00000000-0000-4000-a000-00000000c9a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notes-bob@example.test'),
  ('00000000-0000-4000-a000-00000000c9a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notes-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000c9a1', 'notes-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000c9a2', 'notes-bob@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000c9a4', 'notes-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000c901', 'Notes Alice', 'notes-alice@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000c902', 'Notes Bob', 'notes-bob@example.test', now(), 'on_hiatus'),
  ('00000000-0000-4000-a000-00000000c903', 'Notes Carol', 'notes-carol@example.test', now(), 'cancelled'),
  ('00000000-0000-4000-a000-00000000c904', 'Notes Dana', 'notes-dana@example.test', now(), 'active');

INSERT INTO public.writing_projects (member_id, title, show_on_profile, phase) VALUES
  ('00000000-0000-4000-a000-00000000c901', 'Shown WIP', true, 'drafting'),
  ('00000000-0000-4000-a000-00000000c901', 'Private WIP', false, 'drafting'),
  ('00000000-0000-4000-a000-00000000c901', 'Finished book', true, 'complete');

INSERT INTO public.member_notes (author_member_id, subject_member_id, body) VALUES
  ('00000000-0000-4000-a000-00000000c902', '00000000-0000-4000-a000-00000000c901', 'Bob''s private note about Alice');

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;

-- As Alice.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000c9a1", "email": "notes-alice@example.test", "role": "authenticated"}', true);
INSERT INTO public.member_notes (author_member_id, subject_member_id, body)
VALUES ('00000000-0000-4000-a000-00000000c901', '00000000-0000-4000-a000-00000000c902', 'Ask Bob about Paris');
INSERT INTO result SELECT 'alice_sees_notes', to_jsonb(count(*)) FROM public.member_notes
  WHERE subject_member_id IN ('00000000-0000-4000-a000-00000000c901', '00000000-0000-4000-a000-00000000c902');
INSERT INTO public.member_ask_me_about (member_id, topics)
VALUES ('00000000-0000-4000-a000-00000000c901', ARRAY['cozy mysteries', 'querying']);
INSERT INTO result SELECT 'directory', jsonb_agg(to_jsonb(d) ORDER BY d.name)
  FROM public.get_member_directory() d WHERE d.id::text LIKE '00000000-0000-4000-a000-00000000c9%';
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000c9a2", "email": "notes-bob@example.test", "role": "authenticated"}', true);

-- As Bob: sees his own note only, can read Alice's topics, can't write them.
INSERT INTO result SELECT 'bob_sees_notes', jsonb_agg(body) FROM public.member_notes;
INSERT INTO result SELECT 'bob_reads_topics', to_jsonb(topics) FROM public.member_ask_me_about
  WHERE member_id = '00000000-0000-4000-a000-00000000c901';
UPDATE public.member_ask_me_about SET topics = ARRAY['hacked']
  WHERE member_id = '00000000-0000-4000-a000-00000000c901';
DELETE FROM public.member_notes WHERE author_member_id = '00000000-0000-4000-a000-00000000c901';

-- As Dana (admin): no admin bypass on notes.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000c9a4", "email": "notes-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'admin_sees_notes', to_jsonb(count(*)) FROM public.member_notes
  WHERE author_member_id IN ('00000000-0000-4000-a000-00000000c901', '00000000-0000-4000-a000-00000000c902');

-- No user at all.
SELECT set_config('request.jwt.claims', '{"role": "authenticated"}', true);
INSERT INTO result SELECT 'anon_directory', to_jsonb(count(*)) FROM public.get_member_directory();
RESET ROLE;

SELECT throws_ok(
  $$SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000c9a2", "email": "notes-bob@example.test", "role": "authenticated"}', true);
    INSERT INTO public.member_notes (author_member_id, subject_member_id, body)
    VALUES ('00000000-0000-4000-a000-00000000c901', '00000000-0000-4000-a000-00000000c903', 'forged')$$,
  '42501', NULL, 'a member can''t write a note as someone else');
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'alice_sees_notes'), '1'::jsonb,
  'Alice sees only her own note, not Bob''s note about her');
SELECT is((SELECT value FROM result WHERE label = 'bob_sees_notes'), '["Bob''s private note about Alice"]'::jsonb,
  'Bob sees only his own note');
SELECT is((SELECT value FROM result WHERE label = 'admin_sees_notes'), '0'::jsonb,
  'admins can''t read other members'' notes');
SELECT is((SELECT count(*)::int FROM public.member_notes WHERE author_member_id = '00000000-0000-4000-a000-00000000c901'), 1,
  'Bob can''t delete Alice''s note');
SELECT is((SELECT value FROM result WHERE label = 'bob_reads_topics'), '["cozy mysteries", "querying"]'::jsonb,
  'any member can read ask-me-about topics');
SELECT is((SELECT topics FROM public.member_ask_me_about WHERE member_id = '00000000-0000-4000-a000-00000000c901'),
  ARRAY['cozy mysteries', 'querying'], 'Bob can''t overwrite Alice''s topics');

SELECT throws_ok(
  $$INSERT INTO public.member_notes (author_member_id, subject_member_id, body)
    VALUES ('00000000-0000-4000-a000-00000000c901', '00000000-0000-4000-a000-00000000c901', 'me')$$,
  '23514', NULL, 'no notes about yourself');
SELECT throws_ok(
  $$INSERT INTO public.member_ask_me_about (member_id, topics)
    VALUES ('00000000-0000-4000-a000-00000000c902', ARRAY['Plot', 'plot'])$$,
  '23514', NULL, 'duplicate topics (case-insensitive) are rejected');
SELECT throws_ok(
  $$INSERT INTO public.member_ask_me_about (member_id, topics)
    VALUES ('00000000-0000-4000-a000-00000000c902', ARRAY[' padded '])$$,
  '23514', NULL, 'untrimmed topics are rejected');

SELECT is(
  (SELECT jsonb_path_query_array(value, '$[*].name') FROM result WHERE label = 'directory'),
  '["Notes Alice", "Notes Bob", "Notes Dana"]'::jsonb, 'directory lists active and on-hiatus members, not cancelled');
SELECT is(
  (SELECT value -> 0 -> 'projects' FROM result WHERE label = 'directory'),
  '["Shown WIP"]'::jsonb, 'directory shows only opted-in, in-progress project titles');
SELECT is(
  (SELECT value -> 0 -> 'topics' FROM result WHERE label = 'directory'),
  '["cozy mysteries", "querying"]'::jsonb, 'directory includes topics');
SELECT ok(
  (SELECT NOT (value -> 0 ? 'status' OR value -> 0 ? 'email') FROM result WHERE label = 'directory'),
  'directory never returns status or email');
SELECT is((SELECT value FROM result WHERE label = 'anon_directory'), '0'::jsonb,
  'directory is empty without a signed-in user');
SELECT is(
  (SELECT has_function_privilege('anon', 'public.get_member_directory()', 'EXECUTE')), false,
  'anon can''t execute get_member_directory');

SELECT * FROM finish(true);
ROLLBACK;
