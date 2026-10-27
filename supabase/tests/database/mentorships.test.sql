-- pgTAP tests for the Big Sister program (20261101000000): only admins can read or write
-- mentorships (they name trial members and hold outcome notes), any signed-in member can get the
-- badge counts through mentorship_counts() without seeing who was mentored, a trial member has
-- one active big sister, and changes are audited. Runs in one transaction that is rolled back.
-- Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(25);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000b1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bs-member@example.test'),
  ('00000000-0000-4000-a000-00000000b1a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bs-admin@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000b1a1', 'bs-member@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000b1a4', 'bs-admin@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000b101', 'Big Sister One', 'bs-one@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000b102', 'Trial One', 'bs-t1@example.test', now(), 'lead'),
  ('00000000-0000-4000-a000-00000000b103', 'Trial Two', 'bs-t2@example.test', now(), 'lead'),
  ('00000000-0000-4000-a000-00000000b104', 'Trial Three', 'bs-t3@example.test', now(), 'lead');

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

-- The admin records three matches: one started, one reassigned, one still in the future.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000b1a4", "email": "bs-admin@example.test", "role": "authenticated"}', true);
INSERT INTO public.mentorships (mentor_member_id, new_member_id, started_on, status) VALUES
  ('00000000-0000-4000-a000-00000000b101', '00000000-0000-4000-a000-00000000b102', current_date - 40, 'matched'),
  ('00000000-0000-4000-a000-00000000b101', '00000000-0000-4000-a000-00000000b103', current_date - 30, 'reassigned'),
  ('00000000-0000-4000-a000-00000000b101', '00000000-0000-4000-a000-00000000b104', current_date + 10, 'matched');
INSERT INTO result SELECT 'admin_reads', to_jsonb(count(*)) FROM public.mentorships
  WHERE mentor_member_id = '00000000-0000-4000-a000-00000000b101';
INSERT INTO result SELECT 'admin_counts', to_jsonb(c) FROM public.mentorship_counts() c
  WHERE c.member_id = '00000000-0000-4000-a000-00000000b101';

-- A member can't read the table, but can get the badge counts.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000b1a1", "email": "bs-member@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'member_reads', to_jsonb(count(*)) FROM public.mentorships;
INSERT INTO result SELECT 'member_counts', to_jsonb(c.mentored_count) FROM public.mentorship_counts() c
  WHERE c.member_id = '00000000-0000-4000-a000-00000000b101';
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'admin_reads'), '3'::jsonb, 'an admin reads every match');
SELECT is((SELECT value FROM result WHERE label = 'member_reads'), '0'::jsonb, 'a member sees no matches');
SELECT is(
  (SELECT value ->> 'mentored_count' FROM result WHERE label = 'admin_counts'),
  '1',
  'the badge count includes only started, non-reassigned matches'
);
SELECT is(
  (SELECT value FROM result WHERE label = 'member_counts'),
  '1'::jsonb,
  'a member can get badge counts through mentorship_counts()'
);

-- A member can't write either.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000b1a1", "email": "bs-member@example.test", "role": "authenticated"}', true);
SELECT throws_ok(
  $$INSERT INTO public.mentorships (mentor_member_id, new_member_id, started_on)
    VALUES ('00000000-0000-4000-a000-00000000b101', '00000000-0000-4000-a000-00000000b103', current_date)$$,
  '42501', NULL, 'a member cannot create a match'
);
RESET ROLE;

-- One active big sister per arrival; a reassigned match doesn't block a new one, and a member who
-- arrives again later (a rejoin) is matched afresh.
SELECT throws_ok(
  $$INSERT INTO public.mentorships (mentor_member_id, new_member_id, started_on)
    VALUES ('00000000-0000-4000-a000-00000000b101', '00000000-0000-4000-a000-00000000b102', current_date - 40)$$,
  '23505', NULL, 'a new member cannot have two active big sisters for one arrival'
);
SELECT lives_ok(
  $$INSERT INTO public.mentorships (mentor_member_id, new_member_id, started_on)
    VALUES ('00000000-0000-4000-a000-00000000b101', '00000000-0000-4000-a000-00000000b102', current_date - 400)$$,
  'a member who arrives again later gets a new match'
);
SELECT lives_ok(
  $$INSERT INTO public.mentorships (mentor_member_id, new_member_id, started_on)
    VALUES ('00000000-0000-4000-a000-00000000b101', '00000000-0000-4000-a000-00000000b103', current_date)$$,
  'a trial member whose earlier match was reassigned can be matched again'
);
SELECT throws_ok(
  $$INSERT INTO public.mentorships (mentor_member_id, new_member_id, started_on)
    VALUES ('00000000-0000-4000-a000-00000000b101', '00000000-0000-4000-a000-00000000b101', current_date)$$,
  '23514', NULL, 'a member cannot be their own big sister'
);

SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'mentorship' AND action = 'insert'
     AND changed_by = '00000000-0000-4000-a000-00000000b1a4'),
  3,
  'the admin''s inserts are audited with them as the actor'
);

-- my_mentorships(): a member sees only their own matches, from their own side, and no outcome.
UPDATE public.members SET user_id = '00000000-0000-4000-a000-00000000b1a1'
  WHERE id = '00000000-0000-4000-a000-00000000b102';
CREATE TEMP TABLE mine(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON mine TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000b1a1", "email": "bs-member@example.test", "role": "authenticated"}', true);
INSERT INTO mine SELECT 'own', to_jsonb(r) FROM public.my_mentorships('00000000-0000-4000-a000-00000000b102') r;
INSERT INTO mine SELECT 'other', to_jsonb(r) FROM public.my_mentorships('00000000-0000-4000-a000-00000000b101') r;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000b1a4", "email": "bs-admin@example.test", "role": "authenticated"}', true);
INSERT INTO mine SELECT 'admin_for_big_sister', to_jsonb(r) FROM public.my_mentorships('00000000-0000-4000-a000-00000000b101') r;
RESET ROLE;

SELECT is(
  (SELECT value ->> 'viewer_role' || ':' || (value ->> 'other_name') FROM mine WHERE label = 'own'
    ORDER BY value ->> 'started_on' DESC LIMIT 1),
  'new_member:Big Sister One',
  'a trial member sees their big sister'
);
SELECT is((SELECT count(*)::int FROM mine WHERE label = 'other'), 0, 'a member cannot ask for someone else''s matches');
SELECT is(
  (SELECT count(*)::int FROM mine WHERE label = 'admin_for_big_sister'),
  (SELECT count(*)::int FROM public.mentorships WHERE mentor_member_id = '00000000-0000-4000-a000-00000000b101' AND status = 'matched'),
  'an admin can ask for any member''s matches (sudo)'
);
SELECT ok(
  (SELECT bool_and(NOT (value ? 'outcome_note') OR value -> 'outcome_note' = 'null'::jsonb) FROM mine WHERE label = 'own'),
  'the outcome note is never returned'
);

-- set_mentorship_note: the match's own big sister can write the reason, nobody else can.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000b1a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bs-mentor@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000b1a2', 'bs-mentor@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
UPDATE public.members SET user_id = '00000000-0000-4000-a000-00000000b1a2' WHERE id = '00000000-0000-4000-a000-00000000b101';
CREATE TEMP TABLE note(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON note TO authenticated;
-- The id is looked up here, as the superuser: mentorships is admin-only, so the members below
-- couldn't select it themselves.
CREATE TEMP TABLE the_match ON COMMIT DROP AS
  SELECT id FROM public.mentorships
   WHERE new_member_id = '00000000-0000-4000-a000-00000000b102' AND started_on = current_date - 40;
GRANT SELECT ON the_match TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000b1a1", "email": "bs-member@example.test", "role": "authenticated"}', true);
INSERT INTO note SELECT 'someone_else', to_jsonb(public.set_mentorship_note(
  (SELECT id FROM the_match),
  'not mine to write'));
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000b1a2", "email": "bs-mentor@example.test", "role": "authenticated"}', true);
INSERT INTO note SELECT 'mine', to_jsonb(public.set_mentorship_note(
  (SELECT id FROM the_match),
  'too expensive'));
RESET ROLE;

SELECT is((SELECT value FROM note WHERE label = 'mine'), 'true'::jsonb, 'a big sister writes the note on their own match');
SELECT is((SELECT value FROM note WHERE label = 'someone_else'), 'false'::jsonb, 'nobody else can write it');
SELECT is(
  (SELECT outcome_note FROM public.mentorships WHERE new_member_id = '00000000-0000-4000-a000-00000000b102' AND started_on = current_date - 40),
  'too expensive',
  'the note is the big sister''s, untouched by the other attempt'
);

-- Volunteer pool: a member manages their own row, can't touch anyone else's, and the pool isn't a
-- public list (a member reads only their own row; an admin reads all).
UPDATE public.members SET user_id = '00000000-0000-4000-a000-00000000b1a4'
  WHERE id = '00000000-0000-4000-a000-00000000b103';
CREATE TEMP TABLE vol(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON vol TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000b1a1", "email": "bs-member@example.test", "role": "authenticated"}', true);
INSERT INTO public.big_sister_volunteers (member_id, note) VALUES ('00000000-0000-4000-a000-00000000b102', 'mornings');
UPDATE public.big_sister_volunteers SET deleted_at = now() WHERE member_id = '00000000-0000-4000-a000-00000000b102';
INSERT INTO vol SELECT 'own_after_withdraw', to_jsonb(v) FROM public.big_sister_volunteers v;
RESET ROLE;

SELECT is((SELECT value ->> 'note' FROM vol WHERE label = 'own_after_withdraw'), 'mornings', 'a member volunteers and withdraws themselves');
SELECT isnt((SELECT value ->> 'deleted_at' FROM vol WHERE label = 'own_after_withdraw'), NULL, 'withdrawing keeps the row, soft deleted');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000b1a1", "email": "bs-member@example.test", "role": "authenticated"}', true);
SELECT throws_ok(
  $$INSERT INTO public.big_sister_volunteers (member_id) VALUES ('00000000-0000-4000-a000-00000000b101')$$,
  '42501', NULL, 'a member cannot volunteer someone else'
);
RESET ROLE;

INSERT INTO public.big_sister_volunteers (member_id) VALUES ('00000000-0000-4000-a000-00000000b101');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000b1a1", "email": "bs-member@example.test", "role": "authenticated"}', true);
INSERT INTO vol SELECT 'member_sees', to_jsonb(count(*)) FROM public.big_sister_volunteers;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000b1a4", "email": "bs-admin@example.test", "role": "authenticated"}', true);
INSERT INTO vol SELECT 'admin_sees', to_jsonb(count(*)) FROM public.big_sister_volunteers
  WHERE member_id IN ('00000000-0000-4000-a000-00000000b101', '00000000-0000-4000-a000-00000000b102');
RESET ROLE;
SELECT is((SELECT value FROM vol WHERE label = 'member_sees'), '1'::jsonb, 'a member reads only their own volunteer row');
SELECT is((SELECT value FROM vol WHERE label = 'admin_sees'), '2'::jsonb, 'an admin reads the whole pool');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'big_sister_volunteer'
     AND entity_id = '00000000-0000-4000-a000-00000000b102'),
  1,
  'a volunteer''s own changes are audited (net effect of the transaction)'
);

SELECT diag('DIAG role=' || current_user || ' badge_types=' || (SELECT count(*) FROM public.badge_types) || ' keys=' || coalesce((SELECT string_agg(key, ',' ORDER BY key) FROM public.badge_types), '') || ' levels=' || (SELECT count(*) FROM public.badge_levels) || ' events=' || (SELECT count(*) FROM public.events) || ' member_badges=' || (SELECT count(*) FROM public.member_badges) || ' bronze_calendar=' || (SELECT count(*) FROM bronze.calendar_events));
-- The Hedgie Mentor badge is computed now and has the higher tiers.
SELECT is(
  (SELECT is_automatic FROM public.badge_types WHERE key = 'hedgie_mentor'),
  true,
  'the mentor badge is computed from matches'
);
SELECT is(
  (SELECT string_agg(l.threshold::text, ',' ORDER BY l.level) FROM public.badge_levels l
     JOIN public.badge_types b ON b.id = l.badge_type_id WHERE b.key = 'hedgie_mentor'),
  '1,2,5,10,25',
  'the mentor badge has tiers at 1, 2, 5, 10 and 25'
);

SELECT * FROM finish(true);
ROLLBACK;
