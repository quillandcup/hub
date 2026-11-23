-- pgTAP tests for 20271024000000_member_milestone_snoozes.sql (docs/product/FINISHERS.md, "The project-stage prompt"):
--   * a member snoozes a prompt ("not yet") for their own live project, one row per project and kind, with a stage group;
--   * they can move the group, and only the group, forward in place; nobody else reads or writes it;
--   * not while an admin views as the member (sudo), not for another member's or a deleted project, not for a visitor;
--   * a snooze is not a milestone: member_milestones is untouched, so it is never counted as declined and does not stop the
--     staff backfill (propose_milestones_for_books) from proposing for the work;
--   * it goes with the member on removal, and with the project.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(24);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000faa1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sn-uma@example.test'),
  ('00000000-0000-4000-a000-00000000faa2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sn-vic@example.test'),
  ('00000000-0000-4000-a000-00000000faa4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sn-wes@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-00000000faa1', 'sn-uma@example.test'),
  ('00000000-0000-4000-a000-00000000faa2', 'sn-vic@example.test'),
  ('00000000-0000-4000-a000-00000000faa4', 'sn-wes@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-a000-00000000faa4', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_snUma0000001', 'Uma Snooze', 'sn-uma@example.test', now(), 'active', '00000000-0000-4000-a000-00000000faa1'),
  ('mbr_snVic0000001', 'Vic Snooze', 'sn-vic@example.test', now(), 'active', '00000000-0000-4000-a000-00000000faa2'),
  ('mbr_snWesAdminAB', 'Wes Snooze', 'sn-wes@example.test', now(), 'active', '00000000-0000-4000-a000-00000000faa4');
INSERT INTO public.writing_projects (id, member_id, title) VALUES
  ('prj_snUma0000001', 'mbr_snUma0000001', 'Uma Fake Novel'),
  ('prj_snUma0000002', 'mbr_snUma0000001', 'Uma Second Fake Novel'),
  ('prj_snVic0000001', 'mbr_snVic0000001', 'Vic Fake Novel'),
  ('prj_snWes0000001', 'mbr_snWesAdminAB', 'Wes Fake Novel');
INSERT INTO public.writing_projects (id, member_id, title, deleted_at) VALUES
  ('prj_snUmaGone001', 'mbr_snUma0000001', 'Uma Deleted Novel', now());
INSERT INTO public.member_books (id, member_id, title, cover_url, published_date, project_id) VALUES
  ('book_snUma00001', 'mbr_snUma0000001', 'Uma Fake Book', 'https://example.test/c.png', '2026-01-01', 'prj_snUma0000001');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000faa1", "email": "sn-uma@example.test", "role": "authenticated"}', true);

-- A member snoozes the prompt for their own live project.
SELECT lives_ok(
  $$INSERT INTO public.member_milestone_snoozes (member_id, project_id, kind, stage_group) VALUES ('mbr_snUma0000001', 'prj_snUma0000001', 'the_end', 1)$$,
  'a member says "not yet" for their own project');
SELECT lives_ok(
  $$INSERT INTO public.member_milestone_snoozes (member_id, project_id, kind, stage_group) VALUES ('mbr_snUma0000001', 'prj_snUma0000001', 'publish_ready', 2)$$,
  'the other kind is its own question');
SELECT lives_ok(
  $$INSERT INTO public.member_milestone_snoozes (member_id, project_id, kind, stage_group) VALUES ('mbr_snUma0000001', 'prj_snUma0000002', 'the_end', 0)$$,
  'and so is another project');
SELECT is((SELECT id LIKE 'msnz\_%' FROM public.member_milestone_snoozes WHERE project_id = 'prj_snUma0000002'), true, 'the id has its own prefix');

-- One per project and kind; a group must be a real one; a kind must be a milestone.
SELECT throws_ok(
  $$INSERT INTO public.member_milestone_snoozes (member_id, project_id, kind, stage_group) VALUES ('mbr_snUma0000001', 'prj_snUma0000001', 'the_end', 2)$$,
  '23505', NULL, 'a second snooze for the same project and kind is refused (the repository moves the first one forward)');
SELECT throws_ok(
  $$INSERT INTO public.member_milestone_snoozes (member_id, project_id, kind, stage_group) VALUES ('mbr_snUma0000001', 'prj_snUma0000002', 'publish_ready', 9)$$,
  '23514', NULL, 'a stage group outside 0 to 3 is refused');
SELECT throws_ok(
  $$INSERT INTO public.member_milestone_snoozes (member_id, project_id, kind, stage_group) VALUES ('mbr_snUma0000001', 'prj_snUma0000002', 'published', 1)$$,
  '23514', NULL, 'and so is a kind that is not a stored milestone');

-- Nothing for someone else's project, a deleted one, or in someone else's name.
SELECT throws_ok(
  $$INSERT INTO public.member_milestone_snoozes (member_id, project_id, kind, stage_group) VALUES ('mbr_snUma0000001', 'prj_snVic0000001', 'the_end', 1)$$,
  '42501', NULL, 'a member cannot snooze another member''s project');
SELECT throws_ok(
  $$INSERT INTO public.member_milestone_snoozes (member_id, project_id, kind, stage_group) VALUES ('mbr_snUma0000001', 'prj_snUmaGone001', 'the_end', 1)$$,
  '42501', NULL, 'nor a deleted one');
SELECT throws_ok(
  $$INSERT INTO public.member_milestone_snoozes (member_id, project_id, kind, stage_group) VALUES ('mbr_snVic0000001', 'prj_snVic0000001', 'the_end', 1)$$,
  '42501', NULL, 'nor in another member''s name');

-- The group moves in place; nothing else about the row can change.
UPDATE public.member_milestone_snoozes SET stage_group = 2, updated_at = now() WHERE project_id = 'prj_snUma0000001' AND kind = 'the_end';
SELECT is((SELECT stage_group::int FROM public.member_milestone_snoozes WHERE project_id = 'prj_snUma0000001' AND kind = 'the_end'), 2, 'the member moves the stage group forward');
SELECT throws_ok(
  $$UPDATE public.member_milestone_snoozes SET project_id = 'prj_snUma0000002' WHERE project_id = 'prj_snUma0000001' AND kind = 'the_end'$$,
  '42501', NULL, 'but cannot move a snooze to another project');
SELECT throws_ok(
  $$UPDATE public.member_milestone_snoozes SET member_id = 'mbr_snVic0000001' WHERE project_id = 'prj_snUma0000001' AND kind = 'the_end'$$,
  '42501', NULL, 'or hand it to another member');
RESET ROLE;

-- Another member sees and changes nothing of it.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000faa2", "email": "sn-vic@example.test", "role": "authenticated"}', true);
SELECT is((SELECT count(*)::int FROM public.member_milestone_snoozes), 0, 'another member reads none of it');
UPDATE public.member_milestone_snoozes SET stage_group = 3 WHERE project_id = 'prj_snUma0000001';
RESET ROLE;
SELECT is((SELECT max(stage_group)::int FROM public.member_milestone_snoozes WHERE project_id = 'prj_snUma0000001'), 2, 'and changes none of it');

-- While an admin views as the member (sudo), the prompt is not theirs to answer.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000faa4", "email": "sn-wes@example.test", "role": "authenticated"}', true);
SELECT set_config('request.headers', '{"x-acting-as": "00000000-0000-4000-a000-00000000faa4:mbr_snWesAdminAB"}', true);
SELECT is(public.current_acting_as_member_id()::text, 'mbr_snWesAdminAB', 'the sudo header is honored for this admin (so the next refusal is the sudo rule)');
SELECT throws_ok(
  $$INSERT INTO public.member_milestone_snoozes (member_id, project_id, kind, stage_group) VALUES ('mbr_snWesAdminAB', 'prj_snWes0000001', 'the_end', 1)$$,
  '42501', NULL, 'while viewing as a member (sudo), nothing is snoozed in their name');
SELECT set_config('request.headers', '{}', true);
SELECT lives_ok(
  $$INSERT INTO public.member_milestone_snoozes (member_id, project_id, kind, stage_group) VALUES ('mbr_snWesAdminAB', 'prj_snWes0000001', 'the_end', 1)$$,
  'the same insert outside sudo is allowed for the member themselves');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT count(*) FROM public.member_milestone_snoozes$$, '42501', NULL, 'a visitor has no access');
RESET ROLE;

-- A snooze is not a milestone: no row in member_milestones, so no count of declined and no stop for the staff backfill.
SELECT is((SELECT count(*)::int FROM public.member_milestones WHERE member_id = 'mbr_snUma0000001'), 0, 'a snooze writes no milestone row');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000faa4", "email": "sn-wes@example.test", "role": "authenticated"}', true);
SELECT is((SELECT proposals FROM public.propose_milestones_for_books()), 2, 'the staff backfill still proposes both kinds for a work whose prompt was snoozed');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.member_milestones WHERE member_id = 'mbr_snUma0000001' AND status = 'declined'), 0, 'and nothing is declined');

-- It goes with the project, and with the member on a removal request.
DELETE FROM public.writing_projects WHERE id = 'prj_snUma0000002';
SELECT is((SELECT count(*)::int FROM public.member_milestone_snoozes WHERE project_id = 'prj_snUma0000002'), 0, 'it goes with its project');
SELECT is((SELECT action FROM public.member_data_handling WHERE table_name = 'member_milestone_snoozes' AND column_name = 'member_id'), 'delete', 'and is deleted with the member on a removal request');

SELECT * FROM finish(true);
ROLLBACK;
