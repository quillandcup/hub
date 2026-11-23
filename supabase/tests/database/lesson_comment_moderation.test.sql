-- pgTAP tests for 20270803000000_lesson_comment_moderation.sql (lesson comments, phase 2):
--   * reports: a member with access reports someone else's live comment once; never their own, never as someone else,
--     never in sudo, never without access, never a held or hidden one; only admins read them; no anon access
--   * a held comment is its author's and staff's alone; a member can't release, hide or mark anything handled
--   * moderate_lesson_comment(): admins (and the service role) only; hide, unhide, delete, approve, handle and dismiss
--     change the comment, settle its reports and write ONE audit entry as the admin, with no comment text, and nothing
--     is written when nothing changes
--   * grants: nothing for anon, no update or delete for signed-in users
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(44);

-- Alice wrote the comments; Bob and Eve have access; Carol has none; Dana is an admin.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-0000000c02a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lm-alice@example.test'),
  ('00000000-0000-4000-a000-0000000c02a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lm-bob@example.test'),
  ('00000000-0000-4000-a000-0000000c02a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lm-carol@example.test'),
  ('00000000-0000-4000-a000-0000000c02a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lm-dana@example.test'),
  ('00000000-0000-4000-a000-0000000c02a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lm-eve@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-0000000c02a1', 'lm-alice@example.test'),
  ('00000000-0000-4000-a000-0000000c02a2', 'lm-bob@example.test'),
  ('00000000-0000-4000-a000-0000000c02a3', 'lm-carol@example.test'),
  ('00000000-0000-4000-a000-0000000c02a4', 'lm-dana@example.test'),
  ('00000000-0000-4000-a000-0000000c02a5', 'lm-eve@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-a000-0000000c02a4', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_AAAAAAAAMmA1', 'Moderation Alice', 'lm-alice@example.test', now(), 'active', '00000000-0000-4000-a000-0000000c02a1'),
  ('mbr_AAAAAAAAMmA2', 'Moderation Bob', 'lm-bob@example.test', now(), 'active', '00000000-0000-4000-a000-0000000c02a2'),
  ('mbr_AAAAAAAAMmA3', 'Moderation Carol', 'lm-carol@example.test', now(), 'active', '00000000-0000-4000-a000-0000000c02a3'),
  ('mbr_AAAAAAAAMmA4', 'Moderation Dana', 'lm-dana@example.test', now(), 'active', '00000000-0000-4000-a000-0000000c02a4'),
  ('mbr_AAAAAAAAMmA5', 'Moderation Eve', 'lm-eve@example.test', now(), 'active', '00000000-0000-4000-a000-0000000c02a5');

INSERT INTO public.courses (id, slug, title, source_key) VALUES ('crs_AAAAAAAAMmC1', 'pgtap-moderation', 'PgTAP Moderation', 'pgtap-moderation');
INSERT INTO public.course_access (member_id, course_id, starts_at, ends_at, origin) VALUES
  ('mbr_AAAAAAAAMmA1', 'crs_AAAAAAAAMmC1', now() - interval '1 day', NULL, 'purchase'),
  ('mbr_AAAAAAAAMmA2', 'crs_AAAAAAAAMmC1', now() - interval '1 day', NULL, 'purchase'),
  ('mbr_AAAAAAAAMmA5', 'crs_AAAAAAAAMmC1', now() - interval '1 day', NULL, 'purchase');
INSERT INTO public.course_lessons (id, course_id, title, position, state, source_key) VALUES
  ('les_AAAAAAAAMmL1', 'crs_AAAAAAAAMmC1', 'Open lesson', 1, 'open', 'lm-open');

-- 01 live (Alice), 02 live (Bob), 03 held (Alice), 04 hidden (Alice), 05 to delete, 06 a question to mark handled, 07 to dismiss.
INSERT INTO public.lesson_comments (id, lesson_id, member_id, body) VALUES
  ('cmnt_AAAAAAAAMm01', 'les_AAAAAAAAMmL1', 'mbr_AAAAAAAAMmA1', 'secret-body-one: a live question'),
  ('cmnt_AAAAAAAAMm02', 'les_AAAAAAAAMmL1', 'mbr_AAAAAAAAMmA2', 'Bob wrote this'),
  ('cmnt_AAAAAAAAMm05', 'les_AAAAAAAAMmL1', 'mbr_AAAAAAAAMmA1', 'secret-body-five: to be deleted'),
  ('cmnt_AAAAAAAAMm06', 'les_AAAAAAAAMmL1', 'mbr_AAAAAAAAMmA1', 'secret-body-six: needs no answer'),
  ('cmnt_AAAAAAAAMm07', 'les_AAAAAAAAMmL1', 'mbr_AAAAAAAAMmA1', 'secret-body-seven: fine really');
INSERT INTO public.lesson_comments (id, lesson_id, member_id, body, held_at, held_reason) VALUES
  ('cmnt_AAAAAAAAMm03', 'les_AAAAAAAAMmL1', 'mbr_AAAAAAAAMmA1', 'secret-body-three: a b c', now(), 'links');
INSERT INTO public.lesson_comments (id, lesson_id, member_id, body, hidden_at) VALUES
  ('cmnt_AAAAAAAAMm04', 'les_AAAAAAAAMmL1', 'mbr_AAAAAAAAMmA1', 'secret-body-four: hidden', now());

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated, anon, service_role;

-- Runs one statement as the current role and records how many rows it touched, or the error code.
CREATE FUNCTION pg_temp.try(p_label text, p_stmt text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE n int;
BEGIN
  EXECUTE p_stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO result VALUES (p_label, to_jsonb(n));
EXCEPTION WHEN others THEN
  INSERT INTO result VALUES (p_label, to_jsonb(SQLSTATE));
END
$f$;
GRANT EXECUTE ON FUNCTION pg_temp.try(text, text) TO authenticated, anon, service_role;

-- Runs a statement that returns one text value (the function's answer) and records it, or the error code.
CREATE FUNCTION pg_temp.val(p_label text, p_stmt text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v text;
BEGIN
  EXECUTE p_stmt INTO v;
  INSERT INTO result VALUES (p_label, to_jsonb(v));
EXCEPTION WHEN others THEN
  INSERT INTO result VALUES (p_label, to_jsonb(SQLSTATE));
END
$f$;
GRANT EXECUTE ON FUNCTION pg_temp.val(text, text) TO authenticated, anon, service_role;

SET LOCAL ROLE authenticated;

-- Bob: access, reads and reports.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000c02a2", "email": "lm-bob@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'bob_sees', to_jsonb(count(*)) FROM public.lesson_comments;
INSERT INTO result SELECT 'bob_sees_held_or_hidden', to_jsonb(count(*)) FROM public.lesson_comments WHERE id IN ('cmnt_AAAAAAAAMm03', 'cmnt_AAAAAAAAMm04');
SELECT pg_temp.try('bob_reports', $$INSERT INTO public.lesson_comment_reports (comment_id, reporter_id, reason) VALUES ('cmnt_AAAAAAAAMm01', 'mbr_AAAAAAAAMmA2', 'Looks like spam')$$);
SELECT pg_temp.try('bob_reports_again', $$INSERT INTO public.lesson_comment_reports (comment_id, reporter_id, reason) VALUES ('cmnt_AAAAAAAAMm01', 'mbr_AAAAAAAAMmA2', 'Still spam')$$);
SELECT pg_temp.try('bob_reports_seven', $$INSERT INTO public.lesson_comment_reports (comment_id, reporter_id, reason) VALUES ('cmnt_AAAAAAAAMm07', 'mbr_AAAAAAAAMmA2', 'Off topic')$$);
SELECT pg_temp.try('bob_reports_own', $$INSERT INTO public.lesson_comment_reports (comment_id, reporter_id, reason) VALUES ('cmnt_AAAAAAAAMm02', 'mbr_AAAAAAAAMmA2', 'Myself')$$);
SELECT pg_temp.try('bob_reports_held', $$INSERT INTO public.lesson_comment_reports (comment_id, reporter_id, reason) VALUES ('cmnt_AAAAAAAAMm03', 'mbr_AAAAAAAAMmA2', 'Held one')$$);
SELECT pg_temp.try('bob_reports_hidden', $$INSERT INTO public.lesson_comment_reports (comment_id, reporter_id, reason) VALUES ('cmnt_AAAAAAAAMm04', 'mbr_AAAAAAAAMmA2', 'Hidden one')$$);
SELECT pg_temp.try('bob_reports_as_eve', $$INSERT INTO public.lesson_comment_reports (comment_id, reporter_id, reason) VALUES ('cmnt_AAAAAAAAMm05', 'mbr_AAAAAAAAMmA5', 'As Eve')$$);
SELECT pg_temp.try('bob_reports_empty', $$INSERT INTO public.lesson_comment_reports (comment_id, reporter_id, reason) VALUES ('cmnt_AAAAAAAAMm05', 'mbr_AAAAAAAAMmA2', '')$$);
SELECT pg_temp.try('bob_reports_too_long', format($$INSERT INTO public.lesson_comment_reports (comment_id, reporter_id, reason) VALUES ('cmnt_AAAAAAAAMm05', 'mbr_AAAAAAAAMmA2', %L)$$, repeat('x', 501)));
SELECT pg_temp.try('bob_reports_resolved', $$INSERT INTO public.lesson_comment_reports (comment_id, reporter_id, reason, resolved_at) VALUES ('cmnt_AAAAAAAAMm05', 'mbr_AAAAAAAAMmA2', 'Pre-resolved', now())$$);
INSERT INTO result SELECT 'bob_reads_reports', to_jsonb(count(*)) FROM public.lesson_comment_reports;
SELECT pg_temp.try('bob_updates_report', $$UPDATE public.lesson_comment_reports SET resolved_at = now()$$);
SELECT pg_temp.val('bob_moderates', $$SELECT public.moderate_lesson_comment('cmnt_AAAAAAAAMm02', 'hide')$$);

-- Eve: a second reporter of the same comment.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000c02a5", "email": "lm-eve@example.test", "role": "authenticated"}', true);
SELECT pg_temp.try('eve_reports', $$INSERT INTO public.lesson_comment_reports (comment_id, reporter_id, reason) VALUES ('cmnt_AAAAAAAAMm01', 'mbr_AAAAAAAAMmA5', 'Not kind')$$);

-- Carol: no access.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000c02a3", "email": "lm-carol@example.test", "role": "authenticated"}', true);
SELECT pg_temp.try('carol_reports', $$INSERT INTO public.lesson_comment_reports (comment_id, reporter_id, reason) VALUES ('cmnt_AAAAAAAAMm01', 'mbr_AAAAAAAAMmA3', 'Let me in')$$);

-- Alice: the author. Never told who reported; her own held and hidden comments stay hers to read; staff's columns are not hers.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000c02a1", "email": "lm-alice@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'alice_reads_reports', to_jsonb(count(*)) FROM public.lesson_comment_reports;
INSERT INTO result SELECT 'alice_sees_own_held_and_hidden', to_jsonb(count(*)) FROM public.lesson_comments WHERE id IN ('cmnt_AAAAAAAAMm03', 'cmnt_AAAAAAAAMm04');
SELECT pg_temp.try('alice_releases_held', $$UPDATE public.lesson_comments SET held_at = NULL WHERE id = 'cmnt_AAAAAAAAMm03'$$);
SELECT pg_temp.try('alice_unhides', $$UPDATE public.lesson_comments SET hidden_at = NULL WHERE id = 'cmnt_AAAAAAAAMm04'$$);
SELECT pg_temp.try('alice_marks_handled', $$UPDATE public.lesson_comments SET handled_at = now() WHERE id = 'cmnt_AAAAAAAAMm06'$$);
SELECT pg_temp.try('alice_posts_held', $$INSERT INTO public.lesson_comments (lesson_id, member_id, body, held_at) VALUES ('les_AAAAAAAAMmL1', 'mbr_AAAAAAAAMmA1', 'Straight past review', now())$$);
SELECT pg_temp.try('alice_posts_handled', $$INSERT INTO public.lesson_comments (lesson_id, member_id, body, handled_at) VALUES ('les_AAAAAAAAMmL1', 'mbr_AAAAAAAAMmA1', 'Already handled', now())$$);
SELECT pg_temp.val('alice_moderates', $$SELECT public.moderate_lesson_comment('cmnt_AAAAAAAAMm01', 'hide')$$);

-- Sudo: Dana previewing as Bob can't report.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000c02a4", "email": "lm-dana@example.test", "role": "authenticated"}', true);
SELECT set_config('request.headers', '{"x-acting-as": "00000000-0000-4000-a000-0000000c02a4:mbr_AAAAAAAAMmA2"}', true);
SELECT pg_temp.try('sudo_reports', $$INSERT INTO public.lesson_comment_reports (comment_id, reporter_id, reason) VALUES ('cmnt_AAAAAAAAMm05', 'mbr_AAAAAAAAMmA2', 'While previewing')$$);
SELECT set_config('request.headers', '{}', true);

-- Dana: reads every report and moderates.
INSERT INTO result SELECT 'dana_reads_reports', to_jsonb(count(*)) FROM public.lesson_comment_reports;
SELECT pg_temp.val('dana_hides', $$SELECT public.moderate_lesson_comment('cmnt_AAAAAAAAMm01', 'hide')$$);
SELECT pg_temp.val('dana_hides_again', $$SELECT public.moderate_lesson_comment('cmnt_AAAAAAAAMm01', 'hide')$$);
SELECT pg_temp.val('dana_unhides', $$SELECT public.moderate_lesson_comment('cmnt_AAAAAAAAMm01', 'unhide')$$);
SELECT pg_temp.val('dana_unhides_again', $$SELECT public.moderate_lesson_comment('cmnt_AAAAAAAAMm01', 'unhide')$$);
SELECT pg_temp.val('dana_deletes', $$SELECT public.moderate_lesson_comment('cmnt_AAAAAAAAMm05', 'delete')$$);
SELECT pg_temp.val('dana_deletes_again', $$SELECT public.moderate_lesson_comment('cmnt_AAAAAAAAMm05', 'delete')$$);
SELECT pg_temp.val('dana_approves', $$SELECT public.moderate_lesson_comment('cmnt_AAAAAAAAMm03', 'approve')$$);
SELECT pg_temp.val('dana_approves_again', $$SELECT public.moderate_lesson_comment('cmnt_AAAAAAAAMm03', 'approve')$$);
SELECT pg_temp.val('dana_handles', $$SELECT public.moderate_lesson_comment('cmnt_AAAAAAAAMm06', 'handle')$$);
SELECT pg_temp.val('dana_handles_again', $$SELECT public.moderate_lesson_comment('cmnt_AAAAAAAAMm06', 'handle')$$);
SELECT pg_temp.val('dana_dismisses', $$SELECT public.moderate_lesson_comment('cmnt_AAAAAAAAMm07', 'dismiss')$$);
SELECT pg_temp.val('dana_dismisses_again', $$SELECT public.moderate_lesson_comment('cmnt_AAAAAAAAMm07', 'dismiss')$$);
SELECT pg_temp.val('dana_missing', $$SELECT public.moderate_lesson_comment('cmnt_AAAAAAAAMmZZ', 'hide')$$);
SELECT pg_temp.val('dana_bad_action', $$SELECT public.moderate_lesson_comment('cmnt_AAAAAAAAMm02', 'burn')$$);

-- A report that was settled can be made again (one *open* report per reporter).
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000c02a2", "email": "lm-bob@example.test", "role": "authenticated"}', true);
SELECT pg_temp.try('bob_reports_seven_again', $$INSERT INTO public.lesson_comment_reports (comment_id, reporter_id, reason) VALUES ('cmnt_AAAAAAAAMm07', 'mbr_AAAAAAAAMmA2', 'Settled, but still off topic')$$);

-- Signed out.
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role": "anon"}', true);
SELECT pg_temp.try('anon_reads_reports', 'SELECT * FROM public.lesson_comment_reports');
SELECT pg_temp.try('anon_reports', $$INSERT INTO public.lesson_comment_reports (comment_id, reporter_id, reason) VALUES ('cmnt_AAAAAAAAMm02', 'mbr_AAAAAAAAMmA2', 'Anon')$$);
SELECT pg_temp.val('anon_moderates', $$SELECT public.moderate_lesson_comment('cmnt_AAAAAAAAMm02', 'hide')$$);
RESET ROLE;

-- The server (service role): allowed, and the entry says it was the system, not a person.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role": "service_role"}', true);
SELECT pg_temp.val('service_hides', $$SELECT public.moderate_lesson_comment('cmnt_AAAAAAAAMm02', 'hide')$$);
RESET ROLE;

-- Reports.
SELECT is((SELECT value FROM result WHERE label = 'bob_sees'), '5'::jsonb, 'a member with access reads the live comments, not the held or hidden ones of others');
SELECT is((SELECT value FROM result WHERE label = 'bob_sees_held_or_hidden'), '0'::jsonb, 'a held or hidden comment of someone else is not readable by members');
SELECT is((SELECT value FROM result WHERE label = 'bob_reports'), '1'::jsonb, 'a member with access reports someone else''s live comment');
SELECT is((SELECT value FROM result WHERE label = 'bob_reports_again'), '"23505"'::jsonb, 'one open report per reporter and comment');
SELECT is((SELECT value FROM result WHERE label = 'eve_reports'), '1'::jsonb, 'another member can add theirs');
SELECT is((SELECT value FROM result WHERE label = 'bob_reports_own'), '"42501"'::jsonb, 'nobody reports their own comment');
SELECT is((SELECT value FROM result WHERE label = 'bob_reports_held'), '"42501"'::jsonb, 'nor a held one, which is not theirs to read');
SELECT is((SELECT value FROM result WHERE label = 'bob_reports_hidden'), '"42501"'::jsonb, 'nor a hidden one');
SELECT is((SELECT value FROM result WHERE label = 'bob_reports_as_eve'), '"42501"'::jsonb, 'nor as another member');
SELECT is((SELECT value FROM result WHERE label = 'bob_reports_empty'), '"23514"'::jsonb, 'a report needs a reason');
SELECT is((SELECT value FROM result WHERE label = 'bob_reports_too_long'), '"23514"'::jsonb, 'of at most 500 characters');
SELECT is((SELECT value FROM result WHERE label = 'bob_reports_resolved'), '"42501"'::jsonb, 'a new report can''t arrive already resolved');
SELECT is((SELECT value FROM result WHERE label = 'carol_reports'), '"42501"'::jsonb, 'a member with no access can''t report');
SELECT is((SELECT value FROM result WHERE label = 'sudo_reports'), '"42501"'::jsonb, 'sudo is read-only: an admin previewing as a member can''t report');
SELECT is((SELECT value FROM result WHERE label = 'bob_reads_reports'), '0'::jsonb, 'a reporter can''t read reports, not even their own');
SELECT is((SELECT value FROM result WHERE label = 'alice_reads_reports'), '0'::jsonb, 'the author is never told who reported');
SELECT is((SELECT value FROM result WHERE label = 'dana_reads_reports'), '3'::jsonb, 'an admin reads every report');
SELECT is((SELECT value FROM result WHERE label = 'bob_updates_report'), '"42501"'::jsonb, 'a member can''t change a report');
SELECT is((SELECT value FROM result WHERE label = 'anon_reads_reports'), '"42501"'::jsonb, 'signed-out visitors have no access to reports');
SELECT is((SELECT value FROM result WHERE label = 'anon_reports'), '"42501"'::jsonb, 'nor can they report');
SELECT is((SELECT value FROM result WHERE label = 'bob_reports_seven_again'), '1'::jsonb, 'a settled report can be made again');

-- Held and hidden belong to staff.
SELECT is((SELECT value FROM result WHERE label = 'alice_sees_own_held_and_hidden'), '2'::jsonb, 'an author still reads their own held and hidden comments');
SELECT is((SELECT value FROM result WHERE label = 'alice_releases_held'), '"42501"'::jsonb, 'but can''t release a held comment');
SELECT is((SELECT value FROM result WHERE label = 'alice_unhides'), '"42501"'::jsonb, 'nor show a hidden one');
SELECT is((SELECT value FROM result WHERE label = 'alice_marks_handled'), '"42501"'::jsonb, 'nor mark a question handled');
SELECT is((SELECT value FROM result WHERE label = 'alice_posts_held'), '"42501"'::jsonb, 'a signed-in client can''t post straight into held (the server does that)');
SELECT is((SELECT value FROM result WHERE label = 'alice_posts_handled'), '"42501"'::jsonb, 'or already handled');

-- The moderation function.
SELECT ok(
  (SELECT value = '"42501"'::jsonb FROM result WHERE label = 'bob_moderates')
  AND (SELECT value = '"42501"'::jsonb FROM result WHERE label = 'alice_moderates')
  AND (SELECT value = '"42501"'::jsonb FROM result WHERE label = 'anon_moderates')
  AND NOT has_function_privilege('anon', 'public.moderate_lesson_comment(text,text)', 'EXECUTE'),
  'a member, the comment''s author and a signed-out visitor are all refused, and anon has no execute');
SELECT ok(
  (SELECT value = '"done"'::jsonb FROM result WHERE label = 'dana_hides')
  AND (SELECT value = '"no_change"'::jsonb FROM result WHERE label = 'dana_hides_again')
  AND (SELECT value = '"done"'::jsonb FROM result WHERE label = 'dana_unhides')
  AND (SELECT value = '"no_change"'::jsonb FROM result WHERE label = 'dana_unhides_again'),
  'an admin hides and shows a comment, and an action that changes nothing says so');
SELECT ok(
  (SELECT value = '"done"'::jsonb FROM result WHERE label = 'dana_deletes')
  AND (SELECT value = '"no_change"'::jsonb FROM result WHERE label = 'dana_deletes_again')
  AND (SELECT deleted_at IS NOT NULL AND deleted_by = 'mbr_AAAAAAAAMmA4' FROM public.lesson_comments WHERE id = 'cmnt_AAAAAAAAMm05'),
  'an admin deletes a comment once, recorded as them');
SELECT ok(
  (SELECT value = '"done"'::jsonb FROM result WHERE label = 'dana_approves')
  AND (SELECT value = '"no_change"'::jsonb FROM result WHERE label = 'dana_approves_again')
  AND (SELECT held_at IS NULL AND held_reason IS NULL FROM public.lesson_comments WHERE id = 'cmnt_AAAAAAAAMm03'),
  'an admin approves a held comment, once');
SELECT ok(
  (SELECT value = '"done"'::jsonb FROM result WHERE label = 'dana_handles')
  AND (SELECT value = '"no_change"'::jsonb FROM result WHERE label = 'dana_handles_again')
  AND (SELECT handled_at IS NOT NULL AND handled_by = 'mbr_AAAAAAAAMmA4' FROM public.lesson_comments WHERE id = 'cmnt_AAAAAAAAMm06'),
  'an admin marks a question handled, once, recorded as them');
SELECT ok(
  (SELECT value = '"done"'::jsonb FROM result WHERE label = 'dana_dismisses')
  AND (SELECT value = '"no_change"'::jsonb FROM result WHERE label = 'dana_dismisses_again')
  AND (SELECT hidden_at IS NULL AND deleted_at IS NULL FROM public.lesson_comments WHERE id = 'cmnt_AAAAAAAAMm07'),
  'an admin dismisses the reports on a comment and leaves the comment as it is');
SELECT ok(
  (SELECT value = '"not_found"'::jsonb FROM result WHERE label = 'dana_missing')
  AND (SELECT value = '"P0001"'::jsonb FROM result WHERE label = 'dana_bad_action'),
  'a missing comment is not_found and an unknown action is an error');

-- Reports settle with the comment.
SELECT ok(
  (SELECT count(*) = 0 FROM public.lesson_comment_reports WHERE comment_id = 'cmnt_AAAAAAAAMm01' AND resolved_at IS NULL)
  AND (SELECT count(*) = 2 FROM public.lesson_comment_reports WHERE comment_id = 'cmnt_AAAAAAAAMm01' AND resolved_by = 'mbr_AAAAAAAAMmA4'),
  'hiding a comment settles both reports on it, resolved by the admin');
SELECT ok(
  (SELECT count(*) = 1 FROM public.lesson_comment_reports WHERE comment_id = 'cmnt_AAAAAAAAMm07' AND resolved_at IS NOT NULL AND resolved_by = 'mbr_AAAAAAAAMmA4')
  AND (SELECT count(*) = 1 FROM public.lesson_comment_reports WHERE comment_id = 'cmnt_AAAAAAAAMm07' AND resolved_at IS NULL),
  'dismissing settles the report that was open, and the later one stays open');

-- The audit log: one entry per action, as the person, with no text.
SELECT is(
  (SELECT count(*) FROM public.audit_log WHERE entity_type = 'lesson_comment' AND entity_id = 'cmnt_AAAAAAAAMm01'),
  2::bigint,
  'hide and unhide are one entry each; the repeats that changed nothing wrote none');
SELECT ok(
  (SELECT changes = '{"visibility": {"old": "visible", "new": "hidden"}, "reports_resolved": {"old": 2, "new": 0}}'::jsonb
     AND actor_kind = 'staff' AND changed_by = '00000000-0000-4000-a000-0000000c02a4'::uuid
     AND entity_label = 'Open lesson' AND action = 'update' AND member_id IS NULL
   FROM public.audit_log WHERE entity_type = 'lesson_comment' AND entity_id = 'cmnt_AAAAAAAAMm01' ORDER BY id LIMIT 1),
  'the hide entry names the admin and the lesson, shows visible to hidden and the two reports settled');
SELECT ok(
  (SELECT changes = '{"visibility": {"old": "hidden", "new": "visible"}}'::jsonb FROM public.audit_log WHERE entity_type = 'lesson_comment' AND entity_id = 'cmnt_AAAAAAAAMm01' ORDER BY id DESC LIMIT 1)
  AND (SELECT changes = '{"visibility": {"old": "visible", "new": "deleted"}}'::jsonb FROM public.audit_log WHERE entity_type = 'lesson_comment' AND entity_id = 'cmnt_AAAAAAAAMm05')
  AND (SELECT changes = '{"visibility": {"old": "held", "new": "visible"}}'::jsonb FROM public.audit_log WHERE entity_type = 'lesson_comment' AND entity_id = 'cmnt_AAAAAAAAMm03')
  AND (SELECT changes = '{"handled": {"old": false, "new": true}}'::jsonb FROM public.audit_log WHERE entity_type = 'lesson_comment' AND entity_id = 'cmnt_AAAAAAAAMm06')
  AND (SELECT changes = '{"reports_resolved": {"old": 1, "new": 0}}'::jsonb FROM public.audit_log WHERE entity_type = 'lesson_comment' AND entity_id = 'cmnt_AAAAAAAAMm07'),
  'unhide, delete, approve, handle and dismiss each write one entry with the before and after');
SELECT is(
  (SELECT count(*) FROM public.audit_log WHERE entity_type LIKE 'lesson\_comment%' AND entity_id LIKE 'cmnt\_AAAAAAAAMm%' AND changed_by = '00000000-0000-4000-a000-0000000c02a4'::uuid),
  6::bigint,
  'six actions by the admin, six entries, and none for the comment rows or the reports they touched');
SELECT is(
  (SELECT count(*) FROM public.audit_log WHERE entity_type IN ('lesson_comment_report', 'lesson_comments', 'lesson_comment_reports')),
  0::bigint,
  'no per-row noise: the tables have no audit trigger (it would copy every comment into the log)');
SELECT is(
  (SELECT count(*) FROM public.audit_log WHERE entity_type = 'lesson_comment' AND (changes::text LIKE '%secret-body%' OR coalesce(entity_label, '') LIKE '%secret-body%' OR coalesce(comment, '') LIKE '%secret-body%')),
  0::bigint,
  'no entry carries any comment text');
SELECT ok(
  (SELECT value = '"done"'::jsonb FROM result WHERE label = 'service_hides')
  AND (SELECT actor_kind = 'system' AND changed_by IS NULL FROM public.audit_log WHERE entity_type = 'lesson_comment' AND entity_id = 'cmnt_AAAAAAAAMm02'),
  'the server (service role) may moderate, and its entry says system, not a person');

-- Grants.
SELECT ok(
  NOT has_table_privilege('anon', 'public.lesson_comment_reports', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.lesson_comment_reports', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.lesson_comment_reports', 'DELETE')
  AND has_table_privilege('authenticated', 'public.lesson_comment_reports', 'INSERT')
  AND has_table_privilege('service_role', 'public.lesson_comment_reports', 'DELETE'),
  'grants: nothing for anon, insert and select (admins, by policy) for signed-in users, no update or delete, everything for the service role');

SELECT * FROM finish(true);
ROLLBACK;
