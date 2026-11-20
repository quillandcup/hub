-- pgTAP tests for writers' public pages (20270826000000_writer_profiles.sql): the handle rules and their history, who can
-- read and change what, the pen names that may be shown, and the audit entries.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `pnpm test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(42);

-- Alice and Bob are regular members, Dana an admin. Fixed ids nothing else uses.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f3a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wprof-alice@example.test'),
  ('00000000-0000-4000-a000-00000000f3a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wprof-bob@example.test'),
  ('00000000-0000-4000-a000-00000000f3a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wprof-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f3a1', 'wprof-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f3a2', 'wprof-bob@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f3a4', 'wprof-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_wprofAlice01', 'Alice Writerpage', 'wprof-alice@example.test', now(), 'active', '00000000-0000-4000-a000-00000000f3a1'),
  ('mbr_wprofBob0001', 'Bob Writerpage', 'wprof-bob@example.test', now(), 'active', '00000000-0000-4000-a000-00000000f3a2'),
  ('mbr_wprofDana001', 'Dana Writerpage', 'wprof-dana@example.test', now(), 'active', '00000000-0000-4000-a000-00000000f3a4');

-- Names: Alice has a pen name she added and a Zoom name staff matched; Bob has a pen name he added.
INSERT INTO public.member_name_aliases (id, member_id, alias, source) VALUES
  ('00000000-0000-4000-a000-00000000a101', 'mbr_wprofAlice01', 'A. W. Pen', 'member'),
  ('00000000-0000-4000-a000-00000000a102', 'mbr_wprofAlice01', 'Alice On Zoom', 'zoom'),
  ('00000000-0000-4000-a000-00000000b101', 'mbr_wprofBob0001', 'B. W. Pen', 'member');

-- The database refuses a Zoom or Slack name as a public name, whoever asks, and takes a name the member added.
SELECT throws_ok(
  $$UPDATE public.member_name_aliases SET is_public = true WHERE id = '00000000-0000-4000-a000-00000000a102'$$,
  '23514', NULL, 'a name matched from Zoom cannot be marked public'
);
SELECT lives_ok(
  $$UPDATE public.member_name_aliases SET is_public = true WHERE id = '00000000-0000-4000-a000-00000000a101'$$,
  'a name the member added can be marked public'
);
SELECT is(
  (SELECT is_public FROM public.member_name_aliases WHERE id = '00000000-0000-4000-a000-00000000b101'), false,
  'a name is private until marked: the default is false'
);

-- Handles: shape and case-insensitive uniqueness, through the one function that writes them.
SET LOCAL ROLE service_role;
SELECT is(public.set_writer_handle('mbr_wprofAlice01', 'alice-writes', 90, '2027-03-01T12:00:00Z'), 'created', 'a first handle creates the page');
SELECT is(public.set_writer_handle('mbr_wprofAlice01', 'alice-writes', 90, '2027-03-01T12:00:00Z'), 'unchanged', 'their own handle again changes nothing');
SELECT is(public.set_writer_handle('mbr_wprofBob0001', 'alice-writes', 90, '2027-03-01T12:00:00Z'), 'taken', 'another member cannot take a handle in use');
SELECT throws_ok(
  $$SELECT public.set_writer_handle('mbr_wprofBob0001', 'Bob-Writes', 90, '2027-03-01T12:00:00Z')$$,
  '22023', 'invalid_handle', 'a handle with capitals is refused by the function'
);
SELECT throws_ok(
  $$SELECT public.set_writer_handle('mbr_wprofBob0001', 'bob--writes', 90, '2027-03-01T12:00:00Z')$$,
  '22023', 'invalid_handle', 'two hyphens in a row are refused'
);
RESET ROLE;

SELECT throws_ok(
  $$INSERT INTO public.writer_profiles (member_id, handle) VALUES ('mbr_wprofBob0001', 'Alice-Writes')$$,
  '23514', NULL, 'the table refuses a handle with capitals, so uniqueness cannot be got around by case'
);
SELECT throws_ok(
  $$INSERT INTO public.writer_profiles (member_id, handle) VALUES ('mbr_wprofBob0001', 'alice-writes')$$,
  '23505', NULL, 'the table refuses the same handle for two live pages'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'writer_profiles' AND indexdef ILIKE '%lower(handle)%' AND indexdef ILIKE '%UNIQUE%'),
  'handles are unique on their lowercased value'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'writer_profile_handles' AND indexdef ILIKE '%lower(handle)%' AND indexdef ILIKE '%UNIQUE%'),
  'old handles are unique on their lowercased value too'
);
SELECT is(
  (SELECT is_public FROM public.writer_profiles WHERE member_id = 'mbr_wprofAlice01'), false,
  'a new page is off: nothing is public until the member turns it on'
);

-- A rename keeps the old handle for the previous owner, and it redirects to the new one.
SET LOCAL ROLE service_role;
SELECT is(public.set_writer_handle('mbr_wprofAlice01', 'alice-new', 90, '2027-03-01T12:00:00Z'), 'changed', 'a rename moves the page');
RESET ROLE;
SELECT is(
  (SELECT handle FROM public.writer_profiles WHERE member_id = 'mbr_wprofAlice01'), 'alice-new',
  'the page has the new handle'
);
SELECT is(
  (SELECT reserved_until FROM public.writer_profile_handles WHERE handle = 'alice-writes' AND member_id = 'mbr_wprofAlice01'),
  '2027-03-01T12:00:00Z'::timestamptz + interval '90 days',
  'the old handle is held for the number of days the caller gave'
);

SET LOCAL ROLE service_role;
SELECT is(public.set_writer_handle('mbr_wprofBob0001', 'alice-writes', 90, '2027-03-02T12:00:00Z'), 'reserved', 'someone else cannot take it during the hold');
SELECT is(public.set_writer_handle('mbr_wprofBob0001', 'alice-writes', 90, '2027-05-29T11:59:59Z'), 'reserved', 'still held just before the period ends');
SELECT is(public.set_writer_handle('mbr_wprofAlice01', 'alice-writes', 90, '2027-03-05T12:00:00Z'), 'changed', 'the previous owner can take it back at any time');
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.writer_profile_handles WHERE handle = 'alice-writes'), 0,
  'taking it back ends its redirect'
);
SELECT is(
  (SELECT count(*)::int FROM public.writer_profile_handles WHERE handle = 'alice-new' AND member_id = 'mbr_wprofAlice01'), 1,
  'the one they left is held for them now'
);

SET LOCAL ROLE service_role;
SELECT is(public.set_writer_handle('mbr_wprofBob0001', 'alice-new', 90, '2027-03-06T12:00:00Z'), 'reserved', 'every handle given up is held, not just one');
SELECT is(public.set_writer_handle('mbr_wprofBob0001', 'alice-new', 90, '2027-06-04T12:00:01Z'), 'created', 'after the hold, someone else can have it');
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.writer_profile_handles WHERE handle = 'alice-new'), 0,
  'and the old redirect is gone'
);

-- Soft delete frees the address.
UPDATE public.writer_profiles SET deleted_at = now() WHERE member_id = 'mbr_wprofBob0001';
SET LOCAL ROLE service_role;
SELECT is(public.set_writer_handle('mbr_wprofDana001', 'alice-new', 90, '2027-06-05T12:00:00Z'), 'created', 'a deleted page gives its handle up');
RESET ROLE;

-- Who can read and change what.
CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated, anon;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f3a1", "email": "wprof-alice@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'alice_sees', jsonb_agg(member_id ORDER BY member_id) FROM public.writer_profiles;
UPDATE public.writer_profiles SET is_public = true, public_bio = 'I write cozy mysteries.' WHERE member_id = 'mbr_wprofAlice01';
INSERT INTO result SELECT 'alice_own_update', to_jsonb(is_public) FROM public.writer_profiles WHERE member_id = 'mbr_wprofAlice01';
UPDATE public.writer_profiles SET is_public = true WHERE member_id = 'mbr_wprofDana001';
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f3a4", "email": "wprof-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'dana_sees', jsonb_agg(member_id ORDER BY member_id) FROM public.writer_profiles;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f3a1", "email": "wprof-alice@example.test", "role": "authenticated"}', true);
RESET ROLE;

SELECT is(
  (SELECT value FROM result WHERE label = 'alice_sees'), '["mbr_wprofAlice01"]'::jsonb,
  'a member sees only their own page'
);
SELECT is(
  (SELECT value FROM result WHERE label = 'dana_sees'), '["mbr_wprofAlice01", "mbr_wprofBob0001", "mbr_wprofDana001"]'::jsonb,
  'an admin sees every page, including one that was removed'
);
SELECT is((SELECT value FROM result WHERE label = 'alice_own_update'), 'true'::jsonb, 'a member can turn on their own page');
SELECT is(
  (SELECT is_public FROM public.writer_profiles WHERE member_id = 'mbr_wprofDana001'), false,
  'a member cannot change another member''s page (no row matched)'
);
SELECT ok(
  (SELECT published_at IS NOT NULL FROM public.writer_profiles WHERE member_id = 'mbr_wprofAlice01'),
  'the first time it goes public is remembered'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f3a1", "email": "wprof-alice@example.test", "role": "authenticated"}', true);
SELECT throws_ok(
  $$UPDATE public.writer_profiles SET handle = 'steal-this' WHERE member_id = 'mbr_wprofAlice01'$$,
  '42501', NULL, 'a member cannot write the handle: only set_writer_handle does, with the service role'
);
SELECT throws_ok(
  $$INSERT INTO public.writer_profiles (member_id, handle) VALUES ('mbr_wprofAlice01', 'another-one')$$,
  '42501', NULL, 'a member cannot create a page row directly'
);
SELECT throws_ok(
  $$UPDATE public.writer_profiles SET deleted_at = NULL WHERE member_id = 'mbr_wprofAlice01'$$,
  '42501', NULL, 'a member cannot touch the removal mark'
);
SELECT throws_ok(
  $$SELECT public.set_writer_handle('mbr_wprofAlice01', 'sneaky', 90, now())$$,
  '42501', NULL, 'a member cannot call the handle function'
);
-- The name shown: their own public pen name, never a matching-only name or someone else's.
SELECT lives_ok(
  $$UPDATE public.writer_profiles SET public_name_alias_id = '00000000-0000-4000-a000-00000000a101' WHERE member_id = 'mbr_wprofAlice01'$$,
  'a page can show a pen name the member marked for it'
);
SELECT throws_ok(
  $$UPDATE public.writer_profiles SET public_name_alias_id = '00000000-0000-4000-a000-00000000a102' WHERE member_id = 'mbr_wprofAlice01'$$,
  '23514', 'public_name_not_allowed', 'a page cannot show a name matched from Zoom'
);
SELECT throws_ok(
  $$UPDATE public.writer_profiles SET public_name_alias_id = '00000000-0000-4000-a000-00000000b101' WHERE member_id = 'mbr_wprofAlice01'$$,
  '23514', 'public_name_not_allowed', 'a page cannot show another member''s pen name'
);
RESET ROLE;

-- No anonymous access to either table.
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.writer_profiles$$, '42501', NULL, 'a visitor with no sign-in cannot read pages from the database');
SELECT throws_ok($$SELECT * FROM public.writer_profile_handles$$, '42501', NULL, 'nor the old handles');
RESET ROLE;

-- Audit: the switch and the bio are entries as the member, the bio's text never is, and a handle change writes none.
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'writer_profile' AND entity_id = (SELECT id FROM public.writer_profiles WHERE member_id = 'mbr_wprofAlice01')
     AND actor_kind = 'member' AND (changes -> 'is_public' ->> 'new') = 'true'),
  1, 'turning the page on is one entry, as the member'
);
SELECT is(
  (SELECT changes -> 'public_bio' ->> 'new' FROM public.audit_log WHERE entity_type = 'writer_profile' AND entity_id = (SELECT id FROM public.writer_profiles WHERE member_id = 'mbr_wprofAlice01') AND changes ? 'public_bio'),
  '[redacted]', 'the bio is logged as changed, never with its text'
);
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'writer_profile' AND changes ? 'handle'), 0,
  'a handle change is not an audit row (the server records it as the member''s own activity)'
);

SELECT * FROM finish();
ROLLBACK;
