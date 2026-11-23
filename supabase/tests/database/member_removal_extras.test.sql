-- pgTAP tests for 20270727000100_member_removal_extras.sql: the dry run of what a removal does outside the catalog.
--   * it names the sign-in rows, stored files, free text to clear and audit entries, with counts and short labels;
--   * labels carry no storage path or note text;
--   * it changes nothing, refuses an unknown member, and only the service role may run it.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(14);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000e201', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'extras-ada@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-00000000e201', 'extras-ada@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_EXTAAAAAAAA1', 'Ada Example', 'extras-ada@example.test', now(), 'active', '00000000-0000-4000-a000-00000000e201'),
  ('mbr_EXTAAAAAAAA2', 'Cy Example', 'extras-cy@example.test', now(), 'active', NULL);

INSERT INTO public.user_feature_previews (user_id, feature_key) VALUES ('00000000-0000-4000-a000-00000000e201', 'extras_demo');
INSERT INTO public.member_hiatus_history (member_id, start_date, notes, reason) VALUES ('mbr_EXTAAAAAAAA1', '2026-03-01', 'secret hiatus words', NULL);
INSERT INTO public.mentorships (mentor_member_id, new_member_id, kind, started_on, status, outcome_note) VALUES
  ('mbr_EXTAAAAAAAA2', 'mbr_EXTAAAAAAAA1', 'trial', '2026-04-01', 'matched', 'secret mentorship words');
INSERT INTO public.feedback (user_id, member_id, page_url, feedback_type, message, user_agent, screenshot_path) VALUES
  ('00000000-0000-4000-a000-00000000e201', 'mbr_EXTAAAAAAAA1', '/dashboard', 'idea', 'Dark mode please', 'Mozilla/5.0 (Example)', 'private/path/shot.png');
-- The inserts above fired audit triggers; start the audit log from just the two entries this test makes.
DELETE FROM public.audit_log WHERE entity_id LIKE 'mbr_EXTA%' OR member_id LIKE 'mbr_EXTA%' OR changes::text LIKE '%Ada Example%';
INSERT INTO public.audit_log (actor_kind, entity_type, entity_id, action, changes, entity_label) VALUES
  ('staff', 'prickle_type', 'extras-pt', 'update', '{"notes": {"old": null, "new": "Ada Example asked"}}', 'Ada Example''s favourite'),
  ('staff', 'member', 'mbr_EXTAAAAAAAA1', 'update', '{"bio": {"old": null, "new": "hi"}}', NULL);

CREATE TEMP TABLE ex ON COMMIT DROP AS SELECT * FROM public.member_removal_extras('mbr_EXTAAAAAAAA1');

SELECT is((SELECT row_count FROM ex WHERE item = 'auth_user'), 1::bigint, 'a member with a sign-in account has one to delete');
SELECT is((SELECT row_count FROM ex WHERE item = 'user_profiles'), 1::bigint, 'and a profile row');
SELECT is((SELECT samples FROM ex WHERE item = 'user_feature_previews'), ARRAY['Preview turned on: extras_demo'], 'feature previews are named');
SELECT is((SELECT action || '|' || row_count || '|' || samples[1] FROM ex WHERE item = 'hiatus_notes'), 'clear|1|Hiatus from 01 Mar 2026 (note)', 'a hiatus note is named by its date and kind');
SELECT is((SELECT samples[1] FROM ex WHERE item = 'mentorship_notes'), 'Outcome note, mentorship started 01 Apr 2026', 'a mentorship note is named by its start');
SELECT is((SELECT row_count FROM ex WHERE item = 'feedback_screenshots'), 1::bigint, 'a feedback screenshot is counted');
SELECT is((SELECT samples[1] FROM ex WHERE item = 'feedback_screenshots') !~ 'private/path', true, 'without its storage path');
SELECT ok((SELECT row_count >= 1 FROM ex WHERE item = 'audit_entries'), 'entries about them are counted');
SELECT ok((SELECT 'member (1)' = ANY (samples) FROM ex WHERE item = 'audit_entries'), 'by kind');
SELECT ok((SELECT 'prickle_type (1)' = ANY (samples) FROM ex WHERE item = 'audit_mentions'), 'other entries that name them are counted by kind');
SELECT is((SELECT string_agg(samples::text, ' ') !~ 'secret' FROM ex), true, 'no note text appears in any label');

SELECT is((SELECT notes FROM public.member_hiatus_history WHERE member_id = 'mbr_EXTAAAAAAAA1'), 'secret hiatus words', 'it changes nothing');
SELECT throws_ok($$SELECT * FROM public.member_removal_extras('mbr_NOSUCHMEMBER')$$, 'no member mbr_NOSUCHMEMBER', 'an unknown member is refused');
SELECT is((has_function_privilege('authenticated', 'public.member_removal_extras(text)', 'EXECUTE'), has_function_privilege('service_role', 'public.member_removal_extras(text)', 'EXECUTE')),
  (false, true), 'only the service role can run it');

SELECT * FROM finish(true);
ROLLBACK;
