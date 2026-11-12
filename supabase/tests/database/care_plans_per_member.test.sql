-- pgTAP tests for 20270707000000_care_plans_per_member.sql: a care plan belongs to the member, not to a channel. One open
-- plan per member whatever the channel (and whether or not the insert names one), a closed or soft deleted plan does not
-- count, the old (member, channel) index is gone, and the code still deployed, which writes `channel`, keeps working while
-- the new code leaves it to its default (the column is dropped in a later step). Renewing no longer carries a channel.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(19);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000ce01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ce-manager@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000ce01', 'ce-manager@example.test', 'community_manager')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_CarePerMem1', 'Ada Example', 'ce-ada@example.test', now(), 'active'),
  ('mbr_CarePerMem2', 'Bea Example', 'ce-bea@example.test', now(), 'active'),
  ('mbr_CarePerMem3', 'Cy Example', 'ce-cy@example.test', now(), 'active');

-- The shape: the new index is there, the old one is not, and the column the old code writes is still there with a default.
SELECT has_index('public', 'care_engagements', 'care_engagements_one_open_per_member', 'the one-open-plan-per-member index exists');
SELECT hasnt_index('public', 'care_engagements', 'care_engagements_one_open_per_member_channel', 'the per-member-and-channel index is gone');
SELECT is(
  (SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'care_engagements' AND column_name = 'channel'),
  '''other''::text', 'channel has a default, so an insert that leaves it out still works');
SELECT has_function('public', 'renew_care_engagement', ARRAY['text', 'date', 'uuid', 'timestamp with time zone', 'text'], 'renewing keeps its signature');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ce01", "email": "ce-manager@example.test", "role": "authenticated"}', true);

-- The new code: no channel in the insert.
SELECT lives_ok(
  $$INSERT INTO public.care_engagements (id, member_id, opened_by, owned_by, reason, period_ends_on)
    VALUES ('care_CarePerMem01', 'mbr_CarePerMem1', '00000000-0000-4000-a000-00000000ce01', '00000000-0000-4000-a000-00000000ce01', 'check_in', current_date + 30)$$,
  'a plan is started without a channel');
SELECT is((SELECT channel FROM public.care_engagements WHERE id = 'care_CarePerMem01'), 'other', 'and the unused column takes its default');

-- The code still live while this deploys: it names a channel.
SELECT lives_ok(
  $$INSERT INTO public.care_engagements (id, member_id, opened_by, owned_by, reason, channel, period_ends_on)
    VALUES ('care_CarePerMem02', 'mbr_CarePerMem2', '00000000-0000-4000-a000-00000000ce01', '00000000-0000-4000-a000-00000000ce01', 'welcome', 'slack_dm', current_date + 30)$$,
  'the previous code, which writes a channel, still starts a plan');

-- One open plan per member, whatever the channel.
SELECT throws_ok(
  $$INSERT INTO public.care_engagements (member_id, opened_by, reason, period_ends_on)
    VALUES ('mbr_CarePerMem1', '00000000-0000-4000-a000-00000000ce01', 'welcome', current_date + 30)$$,
  '23505', NULL, 'a second open plan for the member is refused');
SELECT throws_ok(
  $$INSERT INTO public.care_engagements (member_id, opened_by, reason, channel, period_ends_on)
    VALUES ('mbr_CarePerMem2', '00000000-0000-4000-a000-00000000ce01', 'welcome', 'email', current_date + 30)$$,
  '23505', NULL, 'and so is one that names a different channel');
SELECT throws_ok(
  $$INSERT INTO public.care_engagements (member_id, opened_by, reason, channel, period_ends_on)
    VALUES ('mbr_CarePerMem2', '00000000-0000-4000-a000-00000000ce01', 'welcome', 'slack_dm', current_date + 30)$$,
  '23505', NULL, 'and one on the same channel, as before');
SELECT lives_ok(
  $$INSERT INTO public.care_engagements (member_id, opened_by, reason, period_ends_on)
    VALUES ('mbr_CarePerMem3', '00000000-0000-4000-a000-00000000ce01', 'welcome', current_date + 30)$$,
  'another member can have one while these are open');

-- Closing frees the member for a new one.
SELECT lives_ok(
  $$UPDATE public.care_engagements SET closed_at = now(), ended_how = 'ran_its_course' WHERE id = 'care_CarePerMem01'$$,
  'closing a plan');
SELECT lives_ok(
  $$INSERT INTO public.care_engagements (id, member_id, opened_by, reason, period_ends_on)
    VALUES ('care_CarePerMem03', 'mbr_CarePerMem1', '00000000-0000-4000-a000-00000000ce01', 'check_in', current_date + 30)$$,
  'a closed plan does not count: the member can have a new one');

-- A soft deleted plan does not count either.
SELECT lives_ok(
  $$UPDATE public.care_engagements SET deleted_at = now() WHERE id = 'care_CarePerMem03'$$,
  'removing a plan');
SELECT lives_ok(
  $$INSERT INTO public.care_engagements (id, member_id, opened_by, reason, period_ends_on)
    VALUES ('care_CarePerMem04', 'mbr_CarePerMem1', '00000000-0000-4000-a000-00000000ce01', 'check_in', current_date + 30)$$,
  'a removed plan does not count: the member can have a new one');

-- Renewing: closes the plan and opens the next, which keeps the reason and the owner and leaves the channel to its default.
SELECT is(
  (SELECT count(*)::int FROM public.renew_care_engagement('care_CarePerMem02', current_date + 60, '00000000-0000-4000-a000-00000000ce01', now(), 'a plan')),
  1, 'renewing a plan that was started on a channel answers the next one');
SELECT is(
  (SELECT count(*)::int FROM public.care_engagements WHERE renewed_from = 'care_CarePerMem02' AND member_id = 'mbr_CarePerMem2' AND reason = 'welcome' AND channel = 'other' AND closed_at IS NULL),
  1, 'which has the same member and reason, and no channel of its own');
SELECT is(
  (SELECT count(*)::int FROM public.care_engagements WHERE member_id = 'mbr_CarePerMem2' AND closed_at IS NULL AND deleted_at IS NULL),
  1, 'so the member still has exactly one open plan');

RESET ROLE;
SELECT * FROM finish(true);
ROLLBACK;
