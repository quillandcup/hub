-- pgTAP tests for member_email_aliases pointing at members.id
-- (20260929000200_email_aliases_point_at_member_id.sql):
--   * member_id is the identity; canonical_email is a trigger-kept copy of members.email.
--   * legacy writes by canonical_email still resolve to a member, or fail.
--   * RLS ownership follows member_id, including after the member's email changes.
--   * reprocess_members_atomic writes member_id and keeps aliases through email changes.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `npm run test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(30);

-- Alice and Bob are members with logins, Dana an admin. Fixed ids nothing else uses.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000e1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alias-alice-login@example.test'),
  ('00000000-0000-4000-a000-00000000e1a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alias-bob@example.test'),
  ('00000000-0000-4000-a000-00000000e1a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alias-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000e1a1', 'alias-alice-login@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000e1a2', 'alias-bob@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000e1a4', 'alias-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.members (id, name, email, joined_at, status, user_id, kajabi_id) VALUES
  ('00000000-0000-4000-a000-00000000e101', 'Alias Alice', 'alias-alice@example.test', now(), 'active',
   '00000000-0000-4000-a000-00000000e1a1', 'alias-test-k-alice'),
  ('00000000-0000-4000-a000-00000000e102', 'Alias Bob', 'alias-bob@example.test', now(), 'active',
   '00000000-0000-4000-a000-00000000e1a2', 'alias-test-k-bob'),
  ('00000000-0000-4000-a000-00000000e104', 'Alias Dana', 'alias-dana@example.test', now(), 'active',
   '00000000-0000-4000-a000-00000000e1a4', NULL);

-- 1-3: insert by member_id fills canonical_email and lowercases the alias.
INSERT INTO public.member_email_aliases (member_id, alias_email, source)
VALUES ('00000000-0000-4000-a000-00000000e101', 'Alice-Books@Example.TEST', 'manual');
SELECT is(
  (SELECT canonical_email FROM public.member_email_aliases WHERE alias_email = 'alice-books@example.test'),
  'alias-alice@example.test',
  'insert by member_id fills canonical_email from members.email'
);
SELECT is(
  (SELECT count(*)::int FROM public.member_email_aliases WHERE alias_email = 'Alice-Books@Example.TEST'),
  0,
  'alias_email is stored lowercased'
);
SELECT is(
  (SELECT member_id FROM public.member_email_aliases WHERE alias_email = 'alice-books@example.test'),
  '00000000-0000-4000-a000-00000000e101'::uuid,
  'member_id is kept as given'
);

-- 4: a canonical_email passed alongside member_id is ignored (member_id wins).
INSERT INTO public.member_email_aliases (member_id, canonical_email, alias_email, source)
VALUES ('00000000-0000-4000-a000-00000000e101', 'alias-bob@example.test', 'alice-mismatch@example.test', 'manual');
SELECT is(
  (SELECT canonical_email FROM public.member_email_aliases WHERE alias_email = 'alice-mismatch@example.test'),
  'alias-alice@example.test',
  'member_id wins over a mismatched canonical_email on insert'
);

-- 5-6: legacy insert by canonical_email only resolves member_id (case-insensitively).
INSERT INTO public.member_email_aliases (canonical_email, alias_email, source)
VALUES ('ALIAS-BOB@example.test', 'bob-old@example.test', 'manual');
SELECT is(
  (SELECT member_id FROM public.member_email_aliases WHERE alias_email = 'bob-old@example.test'),
  '00000000-0000-4000-a000-00000000e102'::uuid,
  'insert by canonical_email only resolves member_id'
);
SELECT is(
  (SELECT canonical_email FROM public.member_email_aliases WHERE alias_email = 'bob-old@example.test'),
  'alias-bob@example.test',
  'canonical_email is normalized to the member''s stored email'
);

-- 7-8: an alias for an email or member that doesn't exist is rejected.
SELECT throws_ok(
  $$INSERT INTO public.member_email_aliases (canonical_email, alias_email, source)
    VALUES ('nobody@example.test', 'nobody-alias@example.test', 'manual')$$,
  '23503',
  NULL,
  'insert by an email no member has is rejected'
);
SELECT throws_ok(
  $$INSERT INTO public.member_email_aliases (member_id, alias_email, source)
    VALUES ('00000000-0000-4000-a000-00000000eeee', 'ghost-alias@example.test', 'manual')$$,
  '23503',
  NULL,
  'insert for a member id that does not exist is rejected'
);

-- 9-10: when the member's email changes, canonical_email follows and member_id stays.
UPDATE public.members SET email = 'alias-alice-new@example.test' WHERE id = '00000000-0000-4000-a000-00000000e101';
SELECT is(
  (SELECT array_agg(DISTINCT canonical_email) FROM public.member_email_aliases
    WHERE member_id = '00000000-0000-4000-a000-00000000e101'),
  ARRAY['alias-alice-new@example.test'],
  'every alias''s canonical_email follows the member''s email change'
);
SELECT is(
  (SELECT count(*)::int FROM public.member_email_aliases WHERE member_id = '00000000-0000-4000-a000-00000000e101'),
  2,
  'aliases stay with the member through an email change'
);

-- 11: updating an unrelated member column leaves aliases alone.
UPDATE public.members SET name = 'Alias Alice Renamed' WHERE id = '00000000-0000-4000-a000-00000000e101';
SELECT is(
  (SELECT canonical_email FROM public.member_email_aliases WHERE alias_email = 'alice-books@example.test'),
  'alias-alice-new@example.test',
  'non-email member updates do not disturb aliases'
);

-- 12: a legacy UPDATE of canonical_email moves the alias to that member.
UPDATE public.member_email_aliases SET canonical_email = 'alias-bob@example.test'
WHERE alias_email = 'alice-mismatch@example.test';
SELECT is(
  (SELECT member_id FROM public.member_email_aliases WHERE alias_email = 'alice-mismatch@example.test'),
  '00000000-0000-4000-a000-00000000e102'::uuid,
  'updating canonical_email alone moves the alias to the member with that email'
);

-- 13: a legacy UPDATE to an email nobody has is rejected.
SELECT throws_ok(
  $$UPDATE public.member_email_aliases SET canonical_email = 'nobody@example.test'
    WHERE alias_email = 'alice-mismatch@example.test'$$,
  '23503',
  NULL,
  'updating canonical_email to an email no member has is rejected'
);

-- 14-15: updating member_id moves the alias and refreshes canonical_email.
UPDATE public.member_email_aliases SET member_id = '00000000-0000-4000-a000-00000000e101'
WHERE alias_email = 'alice-mismatch@example.test';
SELECT is(
  (SELECT member_id FROM public.member_email_aliases WHERE alias_email = 'alice-mismatch@example.test'),
  '00000000-0000-4000-a000-00000000e101'::uuid,
  'updating member_id moves the alias'
);
SELECT is(
  (SELECT canonical_email FROM public.member_email_aliases WHERE alias_email = 'alice-mismatch@example.test'),
  'alias-alice-new@example.test',
  'updating member_id refreshes canonical_email'
);

-- 16: toggling active keeps member and canonical as they are.
UPDATE public.member_email_aliases SET active = false WHERE alias_email = 'alice-mismatch@example.test';
SELECT is(
  (SELECT (member_id, canonical_email, active)::text FROM public.member_email_aliases WHERE alias_email = 'alice-mismatch@example.test'),
  '(00000000-0000-4000-a000-00000000e101,alias-alice-new@example.test,f)',
  'deactivating an alias changes only active'
);

-- 17: member_id is required once canonical_email can't be resolved either.
SELECT col_not_null('public', 'member_email_aliases', 'member_id', 'member_id is NOT NULL');

-- RLS. Alice's login email differs from her member email on purpose: ownership
-- goes through current_member_id() (members.user_id), then member_id.
CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000e1a1", "email": "alias-alice-login@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'alice_sees', jsonb_agg(alias_email ORDER BY alias_email) FROM public.member_email_aliases
  WHERE alias_email LIKE '%@example.test' AND alias_email LIKE ANY (ARRAY['alice-%', 'bob-%']);
INSERT INTO public.member_email_aliases (member_id, alias_email, source)
VALUES ('00000000-0000-4000-a000-00000000e101', 'alice-self-service@example.test', 'manual');
UPDATE public.member_email_aliases SET active = false WHERE alias_email = 'bob-old@example.test';

SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000e1a4", "email": "alias-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'admin_sees', to_jsonb(count(*)) FROM public.member_email_aliases
  WHERE member_id IN ('00000000-0000-4000-a000-00000000e101', '00000000-0000-4000-a000-00000000e102');
INSERT INTO public.member_email_aliases (member_id, alias_email, source)
VALUES ('00000000-0000-4000-a000-00000000e102', 'bob-by-admin@example.test', 'manual');
RESET ROLE;

-- 18-22
SELECT is(
  (SELECT value FROM result WHERE label = 'alice_sees'),
  '["alice-books@example.test", "alice-mismatch@example.test"]'::jsonb,
  'a member sees their own aliases (after their email changed) and not other members'''
);
SELECT is(
  (SELECT member_id FROM public.member_email_aliases WHERE alias_email = 'alice-self-service@example.test'),
  '00000000-0000-4000-a000-00000000e101'::uuid,
  'a member can add an alias to themselves'
);
SELECT is(
  (SELECT active FROM public.member_email_aliases WHERE alias_email = 'bob-old@example.test'),
  true,
  'a member cannot deactivate another member''s alias'
);
SELECT is((SELECT value FROM result WHERE label = 'admin_sees'), '4'::jsonb, 'an admin sees every member''s aliases');
SELECT is(
  (SELECT member_id FROM public.member_email_aliases WHERE alias_email = 'bob-by-admin@example.test'),
  '00000000-0000-4000-a000-00000000e102'::uuid,
  'an admin can add an alias to any member'
);

-- 23
SELECT throws_ok(
  $$SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e1a1", "email": "alias-alice-login@example.test", "role": "authenticated"}', true);
    INSERT INTO public.member_email_aliases (member_id, alias_email, source)
    VALUES ('00000000-0000-4000-a000-00000000e102', 'alice-forges-bob@example.test', 'manual')$$,
  NULL,
  NULL,
  'a member cannot add an alias to another member'
);
-- (Rejected by the canonical_email trigger before RLS gets to it: the trigger
-- runs as the caller, who can't see other members' rows. Kept that way so a
-- member can't probe which emails belong to members.)
RESET ROLE;

-- 24: deleting a member deletes their aliases.
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000e105', 'Alias Eve', 'alias-eve@example.test', now(), 'lead');
INSERT INTO public.member_email_aliases (member_id, alias_email, source)
VALUES ('00000000-0000-4000-a000-00000000e105', 'eve-old@example.test', 'manual');
DELETE FROM public.members WHERE id = '00000000-0000-4000-a000-00000000e105';
SELECT is(
  (SELECT count(*)::int FROM public.member_email_aliases WHERE alias_email = 'eve-old@example.test'),
  0,
  'deleting a member deletes their aliases'
);

-- reprocess_members_atomic.
-- 25-27: an email change auto-aliases the old email by member_id, and existing aliases follow.
SELECT reprocess_members_atomic(jsonb_build_array(jsonb_build_object(
  'email', 'alias-bob-new@example.test', 'name', 'Alias Bob', 'joined_at', '2024-01-01',
  'status', 'active', 'source', 'kajabi', 'kajabi_id', 'alias-test-k-bob'
)));
SELECT is(
  (SELECT (member_id, canonical_email, source)::text FROM public.member_email_aliases WHERE alias_email = 'alias-bob@example.test'),
  '(00000000-0000-4000-a000-00000000e102,alias-bob-new@example.test,auto_detected)',
  'reprocess auto-aliases the old email to the member, with the new canonical email'
);
SELECT is(
  (SELECT array_agg(DISTINCT canonical_email) FROM public.member_email_aliases
    WHERE member_id = '00000000-0000-4000-a000-00000000e102'),
  ARRAY['alias-bob-new@example.test'],
  'reprocess: the member''s existing aliases now show the new email'
);
SELECT is(
  (SELECT email FROM public.members WHERE id = '00000000-0000-4000-a000-00000000e102'),
  'alias-bob-new@example.test',
  'reprocess updated the member''s email'
);

-- 28: an old email that was someone else's alias moves to this member.
INSERT INTO public.members (id, name, email, joined_at, status, kajabi_id) VALUES
  ('00000000-0000-4000-a000-00000000e106', 'Alias Fay', 'alias-fay@example.test', now(), 'lead', 'alias-test-k-fay');
INSERT INTO public.member_email_aliases (member_id, alias_email, source)
VALUES ('00000000-0000-4000-a000-00000000e101', 'alias-fay@example.test', 'manual');
SELECT reprocess_members_atomic(jsonb_build_array(jsonb_build_object(
  'email', 'alias-fay-new@example.test', 'name', 'Alias Fay', 'joined_at', '2024-01-01',
  'status', 'lead', 'source', 'kajabi', 'kajabi_id', 'alias-test-k-fay'
)));
SELECT is(
  (SELECT member_id FROM public.member_email_aliases WHERE alias_email = 'alias-fay@example.test'),
  '00000000-0000-4000-a000-00000000e106'::uuid,
  'reprocess: a member''s own old email becomes their alias even if it was aliased elsewhere'
);

-- 29-30: a stale duplicate (same kajabi_id, new email) hands its aliases to the original before it's deleted.
INSERT INTO public.members (id, name, email, joined_at, status, kajabi_id) VALUES
  ('00000000-0000-4000-a000-00000000e107', 'Alias Gus', 'alias-gus-old@example.test', now(), 'lead', 'alias-test-k-gus'),
  ('00000000-0000-4000-a000-00000000e108', 'Alias Gus', 'alias-gus-new@example.test', now(), 'lead', 'alias-test-k-gus');
INSERT INTO public.member_email_aliases (member_id, alias_email, source)
VALUES ('00000000-0000-4000-a000-00000000e108', 'gus-on-dup@example.test', 'manual');
SELECT reprocess_members_atomic(jsonb_build_array(jsonb_build_object(
  'email', 'alias-gus-new@example.test', 'name', 'Alias Gus', 'joined_at', '2024-01-01',
  'status', 'lead', 'source', 'kajabi', 'kajabi_id', 'alias-test-k-gus'
)));
SELECT is(
  (SELECT count(*)::int FROM public.members WHERE id = '00000000-0000-4000-a000-00000000e108'),
  0,
  'reprocess deletes the stale duplicate'
);
SELECT is(
  (SELECT (member_id, canonical_email)::text FROM public.member_email_aliases WHERE alias_email = 'gus-on-dup@example.test'),
  '(00000000-0000-4000-a000-00000000e107,alias-gus-new@example.test)',
  'reprocess moves the stale duplicate''s aliases to the original member'
);

SELECT * FROM finish(true);
ROLLBACK;
