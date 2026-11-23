-- pgTAP tests for 20270916000000_member_milestones_project_stage.sql (the project-stage prompt, docs/product/FINISHERS.md):
--   * a member can record their own answer to the question asked when a project moved forward: "yes" (confirmed) or "not yet"
--     (declined), source 'project_stage', for one of their own live projects, and nothing else;
--   * a "not yet" is private with no consent (the table's CHECKs), keeps the slot (one live row per member, kind and project),
--     can be answered later ("Actually, it is me"), and can be taken back;
--   * refused for another member's or a deleted project, a book, a title, no project, a proposal, another source, another
--     member, an admin, while viewing as a member (sudo), and a visitor;
--   * the answer is an Activity Log row that holds no story.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(27);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f7a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ps-ivy@example.test'),
  ('00000000-0000-4000-a000-00000000f7a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ps-jo@example.test'),
  ('00000000-0000-4000-a000-00000000f7a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ps-kit@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-00000000f7a1', 'ps-ivy@example.test'),
  ('00000000-0000-4000-a000-00000000f7a2', 'ps-jo@example.test'),
  ('00000000-0000-4000-a000-00000000f7a4', 'ps-kit@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-a000-00000000f7a4', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_psIvy0000001', 'Ivy Stage', 'ps-ivy@example.test', now(), 'active', '00000000-0000-4000-a000-00000000f7a1'),
  ('mbr_psJo00000001', 'Jo Stage', 'ps-jo@example.test', now(), 'active', '00000000-0000-4000-a000-00000000f7a2'),
  ('mbr_psKitAdmin11', 'Kit Stage', 'ps-kit@example.test', now(), 'active', '00000000-0000-4000-a000-00000000f7a4');
INSERT INTO public.writing_projects (id, member_id, title) VALUES
  ('prj_psIvy0000001', 'mbr_psIvy0000001', 'Ivy Fake Novel'),
  ('prj_psIvy0000002', 'mbr_psIvy0000001', 'Ivy Second Fake Novel'),
  ('prj_psIvy0000003', 'mbr_psIvy0000001', 'Ivy Third Fake Novel'),
  ('prj_psJo00000001', 'mbr_psJo00000001', 'Jo Fake Novel');
INSERT INTO public.writing_projects (id, member_id, title, deleted_at) VALUES
  ('prj_psIvyGone001', 'mbr_psIvy0000001', 'Ivy Deleted Novel', now());
INSERT INTO public.member_books (id, member_id, title, cover_url, published_date) VALUES
  ('book_psIvy00001', 'mbr_psIvy0000001', 'Ivy Fake Book', 'https://example.test/c.png', '2026-01-01');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f7a1", "email": "ps-ivy@example.test", "role": "authenticated"}', true);

-- "Yes" and "not yet", for the member's own live projects.
SELECT lives_ok(
  $$INSERT INTO public.member_milestones (id, member_id, kind, source, status, confirmed_at, achieved_on, story_after, project_id, created_by, visibility)
    VALUES ('mlst_psYes0000001', 'mbr_psIvy0000001', 'the_end', 'project_stage', 'confirmed', now(), '2026-05-01', 'Ivy story words', 'prj_psIvy0000001', '00000000-0000-4000-a000-00000000f7a1', 'community')$$,
  'a member records "yes" to the question asked when their project moved forward');
SELECT lives_ok(
  $$INSERT INTO public.member_milestones (id, member_id, kind, source, status, project_id, created_by)
    VALUES ('mlst_psNotYet0001', 'mbr_psIvy0000001', 'publish_ready', 'project_stage', 'declined', 'prj_psIvy0000001', '00000000-0000-4000-a000-00000000f7a1')$$,
  'and "not yet", as a declined row for the project');
SELECT lives_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source, status, project_id) VALUES ('mbr_psIvy0000001', 'the_end', 'project_stage', 'declined', 'prj_psIvy0000002')$$,
  'for another of their projects, the same kind is its own question');

-- Nothing else is allowed.
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source, status, project_id) VALUES ('mbr_psIvy0000001', 'the_end', 'project_stage', 'declined', 'prj_psIvy0000001')$$,
  '23505', NULL, 'a second live answer for the same kind and project is refused by the unique index (the repository reports the existing one)');
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source, status, project_id, visibility) VALUES ('mbr_psIvy0000001', 'publish_ready', 'project_stage', 'declined', 'prj_psIvy0000003', 'public')$$,
  '23514', NULL, 'a "not yet" cannot be shown to anyone: only a confirmed row has a level above private');
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source, status, project_id, consent_testimonial) VALUES ('mbr_psIvy0000001', 'publish_ready', 'project_stage', 'declined', 'prj_psIvy0000003', true)$$,
  '23514', NULL, 'nor carry a consent');
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source, status, project_id) VALUES ('mbr_psIvy0000001', 'the_end', 'project_stage', 'confirmed', 'prj_psIvy0000003')$$,
  '23514', NULL, 'a confirmed answer needs the time it was confirmed');
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source, status, project_id) VALUES ('mbr_psIvy0000001', 'the_end', 'project_stage', 'declined', 'prj_psJo00000001')$$,
  '42501', NULL, 'a member cannot answer for someone else''s project');
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source, status, project_id) VALUES ('mbr_psIvy0000001', 'the_end', 'project_stage', 'declined', 'prj_psIvyGone001')$$,
  '42501', NULL, 'or a project that was deleted');
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source, status) VALUES ('mbr_psIvy0000001', 'the_end', 'project_stage', 'declined')$$,
  '42501', NULL, 'an answer has to name a project');
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source, status, project_id, book_id) VALUES ('mbr_psIvy0000001', 'the_end', 'project_stage', 'declined', 'prj_psIvy0000003', 'book_psIvy00001')$$,
  '42501', NULL, 'and cannot link a book');
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source, status, project_id, title) VALUES ('mbr_psIvy0000001', 'the_end', 'project_stage', 'declined', 'prj_psIvy0000003', 'A Fake Title')$$,
  '42501', NULL, 'or a free-text title');
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source, status, project_id) VALUES ('mbr_psIvy0000001', 'the_end', 'project_stage', 'proposed', 'prj_psIvy0000003')$$,
  '42501', NULL, 'a member cannot make a proposal of their own through this path');
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source, status, project_id) VALUES ('mbr_psIvy0000001', 'the_end', 'course', 'declined', 'prj_psIvy0000003')$$,
  '42501', NULL, 'nor pass the answer off as a course''s or staff''s');
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source, status, project_id) VALUES ('mbr_psJo00000001', 'the_end', 'project_stage', 'declined', 'prj_psJo00000001')$$,
  '42501', NULL, 'a member cannot answer in another member''s name');
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source, status, project_id, created_by) VALUES ('mbr_psIvy0000001', 'the_end', 'project_stage', 'declined', 'prj_psIvy0000003', '00000000-0000-4000-a000-00000000f7a2')$$,
  '42501', NULL, 'nor record someone else as the one who answered');

-- The member can change their mind later, and take it back.
UPDATE public.member_milestones SET status = 'confirmed', confirmed_at = now() WHERE id = 'mlst_psNotYet0001';
RESET ROLE;
SELECT is((SELECT status || '/' || visibility FROM public.member_milestones WHERE id = 'mlst_psNotYet0001'), 'confirmed/public', 'a "not yet" can be answered later ("Actually, it is me") and then starts at the globe');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f7a2", "email": "ps-jo@example.test", "role": "authenticated"}', true);
UPDATE public.member_milestones SET deleted_at = now() WHERE id = 'mlst_psYes0000001';
RESET ROLE;
SELECT is((SELECT deleted_at IS NULL FROM public.member_milestones WHERE id = 'mlst_psYes0000001'), true, 'another member cannot take it back');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f7a1", "email": "ps-ivy@example.test", "role": "authenticated"}', true);
UPDATE public.member_milestones SET deleted_at = now() WHERE id = 'mlst_psYes0000001';
RESET ROLE;
SELECT is((SELECT deleted_at IS NOT NULL FROM public.member_milestones WHERE id = 'mlst_psYes0000001'), true, 'the member can (a soft delete)');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f7a1", "email": "ps-ivy@example.test", "role": "authenticated"}', true);
SELECT lives_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source, status, project_id) VALUES ('mbr_psIvy0000001', 'the_end', 'project_stage', 'declined', 'prj_psIvy0000001')$$,
  'a taken-back answer frees the slot (the prompt itself still counts it as asked, which the repository checks)');

-- An admin cannot answer for a member, and neither can anyone viewing as one.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f7a4", "email": "ps-kit@example.test", "role": "authenticated"}', true);
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source, status, project_id) VALUES ('mbr_psIvy0000001', 'publish_ready', 'project_stage', 'declined', 'prj_psIvy0000003')$$,
  '42501', NULL, 'an admin cannot answer in a member''s name');
RESET ROLE;

INSERT INTO public.writing_projects (id, member_id, title) VALUES ('prj_psKit0000001', 'mbr_psKitAdmin11', 'Kit Fake Novel');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f7a4", "email": "ps-kit@example.test", "role": "authenticated"}', true);
SELECT set_config('request.headers', '{"x-acting-as": "00000000-0000-4000-a000-00000000f7a4:mbr_psKitAdmin11"}', true);
SELECT is(public.current_acting_as_member_id(), 'mbr_psKitAdmin11', 'the sudo header is honored for this admin (so the next refusal is the sudo rule)');
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source, status, project_id) VALUES ('mbr_psKitAdmin11', 'the_end', 'project_stage', 'declined', 'prj_psKit0000001')$$,
  '42501', NULL, 'while viewing as a member (sudo), nothing can be answered in their name');
SELECT set_config('request.headers', '{}', true);
SELECT lives_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source, status, project_id) VALUES ('mbr_psKitAdmin11', 'the_end', 'project_stage', 'declined', 'prj_psKit0000001')$$,
  'the same insert outside sudo is allowed for the member themselves');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source, status, project_id) VALUES ('mbr_psIvy0000001', 'the_end', 'project_stage', 'declined', 'prj_psIvy0000003')$$,
  '42501', NULL, 'a visitor cannot answer');
RESET ROLE;

-- The Activity Log has the answer and never the story.
SELECT is(
  (SELECT changes -> 'source' ->> 'new' FROM public.audit_log WHERE entity_type = 'member_milestone' AND entity_id = 'mlst_psNotYet0001' AND action = 'insert'),
  'project_stage', 'the answer is an Activity Log row that says where it came from');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'member_milestone' AND changes::text LIKE '%Ivy story words%'), 0, 'and never the story');

SELECT * FROM finish(true);
ROLLBACK;
