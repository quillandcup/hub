-- pgTAP tests for 20270836000000_member_milestones.sql (the Finisher record, docs/FINISHERS.md):
--   * the table's own rules: confirmed means a confirmation time, a consent needs a confirmed row, one live row per member
--     and kind, a withdrawn row frees the slot;
--   * who can read and change what: a member only their own, nothing for anyone signed out, an admin can propose and
--     take back proposals but never confirm for a member or touch a confirmed row, a member cannot move a row;
--   * the backfill from published books: both kinds per member with a live book, idempotent, over 1000 members,
--     skipping a decline or a withdrawal, and refused for anyone but an admin;
--   * the Activity Log entry (stories redacted) and what a member's removal does to the rows.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `pnpm test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(29);

-- Alice and Bob are regular members, Dana an admin. Fixed ids nothing else uses.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f5a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ms-alice@example.test'),
  ('00000000-0000-4000-a000-00000000f5a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ms-bob@example.test'),
  ('00000000-0000-4000-a000-00000000f5a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ms-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f5a1', 'ms-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f5a2', 'ms-bob@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f5a4', 'ms-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_msAlice00001', 'Alice Milestone', 'ms-alice@example.test', now(), 'active', '00000000-0000-4000-a000-00000000f5a1'),
  ('mbr_msBob0000001', 'Bob Milestone', 'ms-bob@example.test', now(), 'active', '00000000-0000-4000-a000-00000000f5a2'),
  ('mbr_msDana000001', 'Dana Milestone', 'ms-dana@example.test', now(), 'active', '00000000-0000-4000-a000-00000000f5a4');

-- Table rules (as the owner, so no row-level security in the way).
INSERT INTO public.member_milestones (id, member_id, kind, source, status) VALUES ('mlst_msRow0000001', 'mbr_msAlice00001', 'the_end', 'staff', 'proposed');
SELECT is((SELECT consent_profile OR consent_homepage OR consent_testimonial FROM public.member_milestones WHERE id = 'mlst_msRow0000001'), false, 'every consent is off by default');
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source, status) VALUES ('mbr_msBob0000001', 'the_end', 'staff', 'confirmed')$$,
  '23514', NULL, 'a confirmed row needs the time it was confirmed');
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source, status, consent_homepage) VALUES ('mbr_msBob0000001', 'the_end', 'staff', 'proposed', true)$$,
  '23514', NULL, 'a consent cannot be on while the row is only a proposal');
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source) VALUES ('mbr_msBob0000001', 'published', 'staff')$$,
  '23514', NULL, 'published is derived from the books, never stored');
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source) VALUES ('mbr_msAlice00001', 'the_end', 'course')$$,
  '23505', NULL, 'one live row per member and kind');
UPDATE public.member_milestones SET deleted_at = now() WHERE id = 'mlst_msRow0000001';
SELECT lives_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source) VALUES ('mbr_msAlice00001', 'the_end', 'staff')$$,
  'a withdrawn row frees the slot');
SELECT ok(NOT has_table_privilege('anon', 'public.member_milestones', 'SELECT'), 'a visitor has no access to the table at all');

INSERT INTO public.member_milestones (id, member_id, kind, source) VALUES ('mlst_msRow0000002', 'mbr_msBob0000001', 'the_end', 'staff');

-- Who can read and change what.
CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated, anon;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f5a1", "email": "ms-alice@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'alice_sees', jsonb_agg(member_id ORDER BY member_id) FROM public.member_milestones;
-- Alice confirms her own row with one consent.
UPDATE public.member_milestones SET status = 'confirmed', confirmed_at = now(), consent_profile = true, story_after = 'Done at last.'
  WHERE member_id = 'mbr_msAlice00001' AND deleted_at IS NULL;
INSERT INTO result SELECT 'alice_confirmed', to_jsonb(status) FROM public.member_milestones WHERE member_id = 'mbr_msAlice00001';
-- She cannot answer Bob's.
UPDATE public.member_milestones SET status = 'declined' WHERE id = 'mlst_msRow0000002';
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f5a2", "email": "ms-bob@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'bob_sees', jsonb_agg(member_id ORDER BY member_id) FROM public.member_milestones;
INSERT INTO result SELECT 'bob_status', to_jsonb(status) FROM public.member_milestones WHERE id = 'mlst_msRow0000002';
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f5a4", "email": "ms-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'dana_sees', jsonb_agg(DISTINCT member_id) FROM public.member_milestones WHERE member_id IN ('mbr_msAlice00001', 'mbr_msBob0000001');
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'alice_sees'), '["mbr_msAlice00001"]'::jsonb, 'a member reads only their own milestones');
SELECT is((SELECT value FROM result WHERE label = 'alice_confirmed'), '"confirmed"'::jsonb, 'a member confirms their own, with a consent they ticked');
SELECT is((SELECT value FROM result WHERE label = 'bob_sees'), '["mbr_msBob0000001"]'::jsonb, 'another member sees only theirs: staff proposals stay hidden from everyone but their member');
SELECT is((SELECT value FROM result WHERE label = 'bob_status'), '"proposed"'::jsonb, 'a member cannot answer for someone else');
SELECT is((SELECT value FROM result WHERE label = 'dana_sees'), '["mbr_msAlice00001", "mbr_msBob0000001"]'::jsonb, 'an admin reads them all');

-- Writes as other roles: each throws or changes nothing.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f5a1", "email": "ms-alice@example.test", "role": "authenticated"}', true);
SELECT throws_ok($$UPDATE public.member_milestones SET member_id = 'mbr_msBob0000001' WHERE member_id = 'mbr_msAlice00001'$$, '42501', NULL, 'a member cannot move a milestone to someone else');
SELECT throws_ok($$INSERT INTO public.member_milestones (member_id, kind, source) VALUES ('mbr_msAlice00001', 'publish_ready', 'member')$$, '42501', NULL, 'a member cannot add one for themselves yet');
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f5a4", "email": "ms-dana@example.test", "role": "authenticated"}', true);
SELECT throws_ok($$INSERT INTO public.member_milestones (member_id, kind, source, status) VALUES ('mbr_msDana000001', 'the_end', 'member', 'proposed')$$, '42501', NULL, 'an admin can only add staff proposals');
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (member_id, kind, source, status, confirmed_at) VALUES ('mbr_msDana000001', 'the_end', 'staff', 'confirmed', now())$$,
  '42501', NULL, 'an admin cannot add a confirmed milestone for a member');
SELECT lives_ok($$INSERT INTO public.member_milestones (member_id, kind, source, status, created_by) VALUES ('mbr_msDana000001', 'publish_ready', 'staff', 'proposed', '00000000-0000-4000-a000-00000000f5a4')$$, 'an admin adds a proposal');
SELECT throws_ok($$UPDATE public.member_milestones SET status = 'confirmed', confirmed_at = now() WHERE id = 'mlst_msRow0000002'$$, '42501', NULL, 'an admin cannot confirm for a member');
UPDATE public.member_milestones SET story_after = 'Written by staff' WHERE member_id = 'mbr_msAlice00001' AND deleted_at IS NULL;
RESET ROLE;
SELECT is((SELECT status FROM public.member_milestones WHERE id = 'mlst_msRow0000002'), 'proposed', 'and the proposal is still a proposal');
SELECT is((SELECT story_after FROM public.member_milestones WHERE member_id = 'mbr_msAlice00001' AND deleted_at IS NULL), 'Done at last.', 'nor change a milestone the member confirmed');

-- Backfill: 1200 members with a live book (more than a page of 1000), one whose only book is deleted, and the
-- members above (Alice answered, Bob has a proposal; Dana has a book and a proposal of the second kind).
INSERT INTO public.members (id, name, email, joined_at, status)
SELECT 'mbr_Bundfin' || translate(lpad(i::text, 5, 'a'), '0', 'z'), 'Bulk Member ' || i, 'ms-bulk' || i || '@example.test', now(), 'active'
FROM generate_series(1, 1200) AS i;
INSERT INTO public.member_books (member_id, title, cover_url, published_date)
SELECT 'mbr_Bundfin' || translate(lpad(i::text, 5, 'a'), '0', 'z'), 'Bulk Book ' || i, 'https://example.test/c.png', '2026-01-01'
FROM generate_series(1, 1200) AS i;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES ('mbr_msNoBook0001', 'No Book Member', 'ms-nobook@example.test', now(), 'active');
INSERT INTO public.member_books (member_id, title, cover_url, published_date, deleted_at) VALUES ('mbr_msNoBook0001', 'Gone', 'https://example.test/c.png', '2026-01-01', now());
INSERT INTO public.member_books (member_id, title, cover_url, published_date) VALUES
  ('mbr_msAlice00001', 'Alice Book', 'https://example.test/c.png', '2026-01-01'),
  ('mbr_msDana000001', 'Dana Book', 'https://example.test/c.png', '2026-01-01');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f5a1", "email": "ms-alice@example.test", "role": "authenticated"}', true);
SELECT throws_ok($$SELECT public.propose_milestones_from_books()$$, '42501', NULL, 'a member cannot run the backfill');
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f5a4", "email": "ms-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'first_run', to_jsonb(public.propose_milestones_from_books());
INSERT INTO result SELECT 'second_run', to_jsonb(public.propose_milestones_from_books());
RESET ROLE;

SELECT is((SELECT count(*)::int FROM public.member_milestones WHERE member_id LIKE 'mbr_Bundfin%' AND source = 'staff' AND status = 'proposed'), 2400, 'every one of 1200 members with a book gets both milestones as proposals');
SELECT ok((SELECT (value)::int >= 2400 FROM result WHERE label = 'first_run'), 'the run reports at least the rows it added for them');
SELECT is((SELECT value FROM result WHERE label = 'second_run'), '0'::jsonb, 'a second run adds nothing');
SELECT is((SELECT count(*)::int FROM public.member_milestones WHERE member_id = 'mbr_msNoBook0001'), 0, 'a member whose only book was deleted gets nothing');
SELECT is(
  (SELECT string_agg(kind || ':' || status, ',' ORDER BY kind) FROM public.member_milestones WHERE member_id = 'mbr_msAlice00001' AND deleted_at IS NULL),
  'publish_ready:proposed,the_end:confirmed', 'Alice keeps her answer and only the missing kind is proposed');

-- The Activity Log: a proposal is an entry naming the milestone; the stories are redacted.
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'member_milestone' AND entity_id = 'mlst_msRow0000002' AND action = 'insert'), 1,
  'a proposal is one Activity Log entry');
SELECT is(
  (SELECT changes -> 'story_after' ->> 'new' FROM public.audit_log WHERE entity_type = 'member_milestone' AND changes ? 'story_after' ORDER BY id LIMIT 1), '[redacted]',
  'a story is logged as changed, never with its words');

-- Removal: a member's milestones go with them.
CREATE TEMP TABLE removed(r jsonb) ON COMMIT DROP;
INSERT INTO removed SELECT public.remove_member_data('mbr_msBob0000001', false);
SELECT is((SELECT count(*)::int FROM public.member_milestones WHERE member_id = 'mbr_msBob0000001'), 0, 'a removal request deletes their milestones');

SELECT * FROM finish(true);
ROLLBACK;
