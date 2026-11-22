-- A conversion specialist (marketing) edits landing pages and runs outreach, and reads nothing of the members
-- area: not a current member's row, not the staff notes, billing or Slack tables, not the audit log. Rolled back;
-- run with `pnpm test:pgtap`. src/lib/permissions.ts decides what the app offers; this proves what the database allows.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(31);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000cd01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cs-specialist@example.test'),
  ('00000000-0000-4000-a000-00000000cd02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cs-plain@example.test'),
  ('00000000-0000-4000-a000-00000000cd03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cs-admin@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000cd01', 'cs-specialist@example.test', 'conversion_specialist'),
  ('00000000-0000-4000-a000-00000000cd02', 'cs-plain@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000cd03', 'cs-admin@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_CSpecAAAAAA1', 'Specialist Self', 'cs-specialist@example.test', now(), 'active', '00000000-0000-4000-a000-00000000cd01'),
  ('mbr_CSpecAAAAAA2', 'Active Member', 'cs-active@example.test', now(), 'active', NULL),
  ('mbr_CSpecAAAAAA3', 'On Hiatus Member', 'cs-hiatus@example.test', now(), 'on_hiatus', NULL),
  ('mbr_CSpecAAAAAA4', 'Lead Person', 'cs-lead@example.test', now(), 'lead', NULL),
  ('mbr_CSpecAAAAAA5', 'Former Member', 'cs-former@example.test', now(), 'cancelled', NULL);
INSERT INTO public.member_admin_notes (id, member_id, body) VALUES
  ('mnote_CSpecAAAAA1', 'mbr_CSpecAAAAAA2', 'about an active member');
INSERT INTO public.landing_pages (id, slug, title) VALUES
  ('lpg_CSpecAAAAAA1', 'cs-existing-page', 'Existing page');

-- 1. Who the role is -------------------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000cd01", "email": "cs-specialist@example.test", "role": "authenticated"}', true);

SELECT ok(public.is_conversion_specialist(), 'is_conversion_specialist() is true for the specialist');
SELECT ok(NOT public.is_admin(), 'the specialist is not an admin');
SELECT ok(NOT public.is_community_manager(), 'the specialist is not a community manager');

-- 2. Landing pages: read, create, change; no delete ------------------------------------------------------------
SELECT is((SELECT title FROM public.landing_pages WHERE id = 'lpg_CSpecAAAAAA1'), 'Existing page', 'reads a landing page');
SELECT lives_ok(
  $$INSERT INTO public.landing_pages (id, slug, title) VALUES ('lpg_CSpecAAAAAA2', 'cs-new-page', 'New page')$$,
  'creates a landing page');
UPDATE public.landing_pages SET title = 'Renamed page' WHERE id = 'lpg_CSpecAAAAAA2';
SELECT is((SELECT title FROM public.landing_pages WHERE id = 'lpg_CSpecAAAAAA2'), 'Renamed page', 'changes a landing page');
SELECT lives_ok(
  $$INSERT INTO public.landing_page_versions (page_id, title, data) VALUES ('lpg_CSpecAAAAAA2', 'Renamed page', '{"content": [], "root": {}}'::jsonb)$$,
  'adds a landing page version');
SELECT is((SELECT count(*) FROM public.landing_page_versions WHERE page_id = 'lpg_CSpecAAAAAA2'), 1::bigint, 'reads the versions');
SELECT is_empty($$DELETE FROM public.landing_pages WHERE id = 'lpg_CSpecAAAAAA2' RETURNING 1$$, 'cannot hard-delete a landing page (pages are deleted softly)');

-- 3. The site header and footer --------------------------------------------------------------------------------
SELECT lives_ok(
  $$INSERT INTO public.landing_site_template (draft_data) VALUES ('{"header": []}'::jsonb) ON CONFLICT (singleton) DO UPDATE SET draft_data = EXCLUDED.draft_data$$,
  'saves the site header and footer draft');
SELECT is((SELECT count(*) FROM public.landing_site_template), 1::bigint, 'reads the site header and footer');

-- 4. Outreach ---------------------------------------------------------------------------------------------------
SELECT lives_ok(
  $$INSERT INTO public.outreach_leads (member_id, status) VALUES ('mbr_CSpecAAAAAA4', 'hot')$$, 'rates a lead');
SELECT lives_ok(
  $$INSERT INTO public.outreach_touches (member_id, touched_by) VALUES ('mbr_CSpecAAAAAA4', '00000000-0000-4000-a000-00000000cd01')$$, 'logs a touch');
SELECT lives_ok(
  $$INSERT INTO public.outreach_prospects (handle) VALUES ('cs_prospect')$$, 'adds a prospect');
SELECT is((SELECT count(*) FROM public.outreach_leads), 1::bigint, 'reads the leads');
SELECT is_empty($$DELETE FROM public.outreach_leads WHERE member_id = 'mbr_CSpecAAAAAA4' RETURNING 1$$, 'cannot delete a lead rating');

-- 5. Members: only people who are not (or are no longer) members --------------------------------------------------
SELECT is(
  ARRAY(SELECT id FROM public.members WHERE id LIKE 'mbr_CSpecAAAAAA%' ORDER BY id),
  ARRAY['mbr_CSpecAAAAAA1', 'mbr_CSpecAAAAAA4', 'mbr_CSpecAAAAAA5'],
  'reads the lead and the former member and her own row (every member reads that), not the active or on-hiatus ones');
SELECT is_empty(
  $$UPDATE public.members SET name = 'Renamed' WHERE id = 'mbr_CSpecAAAAAA4' RETURNING 1$$, 'cannot update a lead');
SELECT throws_ok(
  $$INSERT INTO public.members (id, name, email, joined_at, status) VALUES ('mbr_CSpecAAAAAA9', 'Nope', 'cs-nope@example.test', now(), 'lead')$$,
  '42501', NULL, 'cannot add a member');
SELECT is_empty($$SELECT 1 FROM public.member_admin_notes$$, 'reads no staff notes');
SELECT is_empty($$SELECT 1 FROM bronze.kajabi_customers$$, 'reads no Kajabi billing rows');
SELECT is_empty($$SELECT 1 FROM bronze.slack_messages$$, 'reads no Slack messages');
SELECT is_empty($$SELECT 1 FROM public.audit_log$$, 'reads no audit log entries');
SELECT is((SELECT count(*) FROM public.user_profiles), 1::bigint, 'sees only her own profile, not the other staff accounts');

-- 6. Her edits are staff actions in the audit log --------------------------------------------------------------
RESET ROLE;
SELECT is(
  (SELECT actor_kind FROM public.audit_log WHERE entity_type = 'landing_page' AND changed_by = '00000000-0000-4000-a000-00000000cd01' ORDER BY id DESC LIMIT 1),
  'staff', 'a landing page change by the specialist is logged as a staff action');

-- 7. staff_member_ids() counts her member as staff ------------------------------------------------------------
SELECT ok('mbr_CSpecAAAAAA1' IN (SELECT public.staff_member_ids()), 'the member behind her account is staff');
SELECT ok('mbr_CSpecAAAAAA2' NOT IN (SELECT public.staff_member_ids()), 'an ordinary member is not');

-- 8. Others -------------------------------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000cd02", "email": "cs-plain@example.test", "role": "authenticated"}', true);
SELECT ok(NOT public.is_conversion_specialist(), 'a plain member is not a conversion specialist');
SELECT is_empty($$SELECT 1 FROM public.landing_pages$$, 'a plain member reads no landing pages');

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000cd03", "email": "cs-admin@example.test", "role": "authenticated"}', true);
SELECT ok(NOT public.is_conversion_specialist(), 'an admin is not a conversion specialist (the admin keeps their own policies)');
SELECT cmp_ok((SELECT count(*) FROM public.members WHERE id LIKE 'mbr_CSpecAAAAAA%'), '=', 5::bigint, 'an admin still reads every member');

RESET ROLE;
SELECT * FROM finish(true);
ROLLBACK;
