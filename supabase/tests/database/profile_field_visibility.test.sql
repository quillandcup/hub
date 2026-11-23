-- pgTAP tests for who can see each profile item (20270844000000_profile_field_visibility.sql): a private item is left out of
-- the member directory for every member and admin, a private "Ask me about" list is hidden from others, the levels are
-- checked, only the owner (or an admin acting for them) changes them, and a change is one audit entry without any text.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `pnpm test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(28);

-- Alice and Bob are regular members, Dana an admin. Fixed ids nothing else uses.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f5a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pvis-alice@example.test'),
  ('00000000-0000-4000-a000-00000000f5a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pvis-bob@example.test'),
  ('00000000-0000-4000-a000-00000000f5a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pvis-dana@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-00000000f5a1', 'pvis-alice@example.test'),
  ('00000000-0000-4000-a000-00000000f5a2', 'pvis-bob@example.test'),
  ('00000000-0000-4000-a000-00000000f5a4', 'pvis-dana@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-a000-00000000f5a4', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.members (id, name, email, joined_at, status, user_id, bio, instagram_url, photo_url) VALUES
  ('mbr_pvisAlice001', 'Alice Visible', 'pvis-alice@example.test', now(), 'active', '00000000-0000-4000-a000-00000000f5a1', 'Alice writes cozy mysteries.', 'https://instagram.com/alice', 'https://photos.example.com/alice.png'),
  ('mbr_pvisBob0001', 'Bob Visible', 'pvis-bob@example.test', now(), 'active', '00000000-0000-4000-a000-00000000f5a2', 'Bob writes poems.', NULL, NULL),
  ('mbr_pvisDana0001', 'Dana Visible', 'pvis-dana@example.test', now(), 'active', '00000000-0000-4000-a000-00000000f5a4', NULL, NULL, NULL);

-- Defaults: every item is shared with members, as it always was.
INSERT INTO public.member_profile_overrides (member_id) VALUES ('mbr_pvisBob0001');
SELECT is(
  (SELECT (bio_visibility, photo_visibility, instagram_visibility, facebook_visibility, twitter_visibility)::text FROM public.member_profile_overrides WHERE member_id = 'mbr_pvisBob0001'),
  '(community,community,community,community,community)', 'a row that only exists for another reason starts every item at community'
);
SELECT is(
  (SELECT bio FROM public.member_directory WHERE id = 'mbr_pvisAlice001'), 'Alice writes cozy mysteries.',
  'with no levels set, the directory shows the bio'
);

-- The database refuses a level that does not exist, and the globe on the topics.
SELECT throws_ok(
  $$INSERT INTO public.member_profile_overrides (member_id, bio_visibility) VALUES ('mbr_pvisDana0001', 'everyone')$$,
  '23514', NULL, 'a level that is not private, community or public is refused'
);
INSERT INTO public.member_ask_me_about (member_id, topics) VALUES ('mbr_pvisAlice001', ARRAY['Plotting', 'Poetry']);
SELECT throws_ok(
  $$UPDATE public.member_ask_me_about SET visibility = 'public' WHERE member_id = 'mbr_pvisAlice001'$$,
  '23514', NULL, 'the topics cannot be opened to the internet: the writer profile does not show them'
);
SELECT is(
  (SELECT visibility FROM public.member_ask_me_about WHERE member_id = 'mbr_pvisAlice001'), 'community',
  'the topics are shared with members until the member says otherwise'
);

-- Alice makes her bio and photo private (as herself), and her topics too.
CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated, anon;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f5a1", "email": "pvis-alice@example.test", "role": "authenticated"}', true);
INSERT INTO public.member_profile_overrides (member_id, bio, facebook_url, bio_visibility, photo_visibility)
  VALUES ('mbr_pvisAlice001', 'My override words', 'https://facebook.com/secret-alice', 'private', 'private');
UPDATE public.member_ask_me_about SET visibility = 'private' WHERE member_id = 'mbr_pvisAlice001';
INSERT INTO result SELECT 'alice_topics_own', to_jsonb(public.member_ask_me_about_shown('mbr_pvisAlice001'));
INSERT INTO result SELECT 'alice_topics_table', to_jsonb(count(*)) FROM public.member_ask_me_about WHERE member_id = 'mbr_pvisAlice001';
INSERT INTO result SELECT 'alice_directory', to_jsonb(d) FROM public.member_directory d WHERE d.id = 'mbr_pvisAlice001';

-- Bob, another member, sees none of it.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f5a2", "email": "pvis-bob@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'bob_sees_directory', to_jsonb(d) FROM public.member_directory d WHERE d.id = 'mbr_pvisAlice001';
INSERT INTO result SELECT 'bob_sees_listing', to_jsonb(g) FROM public.get_member_directory() g WHERE g.id = 'mbr_pvisAlice001';
INSERT INTO result SELECT 'bob_topics_table', to_jsonb(count(*)) FROM public.member_ask_me_about WHERE member_id = 'mbr_pvisAlice001';
INSERT INTO result SELECT 'bob_topics_function', to_jsonb(public.member_ask_me_about_shown('mbr_pvisAlice001'));
-- Bob cannot change Alice's levels.
UPDATE public.member_profile_overrides SET bio_visibility = 'public' WHERE member_id = 'mbr_pvisAlice001';

-- Dana, an admin, sees none of it through the member-facing paths either.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f5a4", "email": "pvis-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'dana_sees_directory', to_jsonb(d) FROM public.member_directory d WHERE d.id = 'mbr_pvisAlice001';
INSERT INTO result SELECT 'dana_sees_listing', to_jsonb(g) FROM public.get_member_directory() g WHERE g.id = 'mbr_pvisAlice001';
INSERT INTO result SELECT 'dana_topics_function', to_jsonb(public.member_ask_me_about_shown('mbr_pvisAlice001'));
-- An admin can still act for the member (sudo): the level is theirs to change on the member's behalf.
UPDATE public.member_profile_overrides SET instagram_visibility = 'private' WHERE member_id = 'mbr_pvisAlice001';
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'alice_topics_own'), '["Plotting", "Poetry"]'::jsonb, 'the owner still reads their own private topics');
SELECT is((SELECT value FROM result WHERE label = 'alice_topics_table'), '1'::jsonb, 'and the row');
SELECT is((SELECT value ->> 'bio' FROM result WHERE label = 'alice_directory'), NULL, 'a private bio is not in the directory, not even for its owner (the owner reads it from Settings)');
SELECT is((SELECT value ->> 'photo_url' FROM result WHERE label = 'bob_sees_directory'), NULL, 'another member does not see a private photo');
SELECT is((SELECT value ->> 'bio' FROM result WHERE label = 'bob_sees_directory'), NULL, 'another member does not see a private bio');
SELECT is((SELECT value ->> 'instagram_url' FROM result WHERE label = 'bob_sees_directory'), 'https://instagram.com/alice', 'an item left at community is still shown');
SELECT is((SELECT value ->> 'bio' FROM result WHERE label = 'bob_sees_listing'), NULL, 'the Members page listing leaves out a private bio');
SELECT is((SELECT value ->> 'photo_url' FROM result WHERE label = 'bob_sees_listing'), NULL, 'and a private photo');
SELECT is((SELECT value FROM result WHERE label = 'bob_sees_listing' ) -> 'topics', '[]'::jsonb, 'and a private list of topics');
SELECT is((SELECT value FROM result WHERE label = 'bob_topics_table'), '0'::jsonb, 'another member cannot read a private topics row from the table');
SELECT is((SELECT value FROM result WHERE label = 'bob_topics_function'), '[]'::jsonb, 'nor through the function member-facing pages use');
SELECT is((SELECT bio_visibility FROM public.member_profile_overrides WHERE member_id = 'mbr_pvisAlice001'), 'private', 'another member cannot change someone else''s levels');
SELECT is((SELECT value ->> 'bio' FROM result WHERE label = 'dana_sees_directory'), NULL, 'an admin does not see a private bio through the directory');
SELECT is((SELECT value ->> 'photo_url' FROM result WHERE label = 'dana_sees_listing'), NULL, 'nor a private photo on the Members page');
SELECT is((SELECT value FROM result WHERE label = 'dana_topics_function'), '[]'::jsonb, 'nor a private list of topics through the member-facing function');
SELECT is(
  (SELECT instagram_visibility FROM public.member_profile_overrides WHERE member_id = 'mbr_pvisAlice001'), 'private',
  'an admin acting for the member can change a level'
);
SELECT is(
  (SELECT instagram_url FROM public.member_directory WHERE id = 'mbr_pvisAlice001'), NULL,
  'and the directory follows that at once'
);

-- Sharing again brings the item back.
UPDATE public.member_profile_overrides SET bio_visibility = 'community', photo_visibility = 'community', instagram_visibility = 'community' WHERE member_id = 'mbr_pvisAlice001';
SELECT is(
  (SELECT (bio, photo_url, instagram_url)::text FROM public.member_directory WHERE id = 'mbr_pvisAlice001'),
  '("Alice writes cozy mysteries.",https://photos.example.com/alice.png,https://instagram.com/alice)',
  'the directory shows them again when the member shares them'
);

-- A change of the member's own text keeps respecting the level (the members trigger uses the same function).
UPDATE public.member_profile_overrides SET bio_visibility = 'private' WHERE member_id = 'mbr_pvisAlice001';
UPDATE public.members SET bio = 'A new bio.' WHERE id = 'mbr_pvisAlice001';
SELECT is(
  (SELECT bio FROM public.member_directory WHERE id = 'mbr_pvisAlice001'), NULL,
  'a new bio from member processing stays out of the directory while the level is private'
);
UPDATE public.member_profile_overrides SET bio_visibility = 'public' WHERE member_id = 'mbr_pvisAlice001';
SELECT is(
  (SELECT bio FROM public.member_directory WHERE id = 'mbr_pvisAlice001'), 'A new bio.',
  'the globe also shows it to members: public is a level above community'
);

-- Audit: a change of level is an entry, with the text redacted; a change of the text alone is not.
SELECT ok(
  EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'member_profile_visibility' AND entity_id = 'mbr_pvisAlice001' AND actor_kind = 'member' AND changes ? 'bio_visibility'),
  'a change of level by the member is an audit entry as the member'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'member_profile_visibility' AND (changes::text ILIKE '%My override words%' OR changes::text ILIKE '%secret-alice%')),
  'no text of a bio or a link ever reaches the log'
);
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'member_profile_visibility' AND entity_id = 'mbr_pvisBob0001'), 0,
  'a row created for another reason, with nothing changed from the default, writes no entry'
);

SELECT * FROM finish();
ROLLBACK;
