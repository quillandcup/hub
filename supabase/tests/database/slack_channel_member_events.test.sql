-- pgTAP tests for 20261008021700_slack_channel_member_events.sql: the membership event log is
-- admin-readable metadata that only the service role writes, each source is idempotent, and the
-- periods view turns events from several sources into one row per stretch a person spent in a
-- conversation. Rolled back; run with `npm run test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(16);

SELECT ok(NOT has_table_privilege('anon', 'bronze.slack_channel_member_events', 'SELECT'), 'anon cannot read membership events');
SELECT ok(NOT has_table_privilege('authenticated', 'bronze.slack_channel_member_events', 'INSERT'), 'authenticated cannot write membership events');
SELECT ok(NOT has_table_privilege('anon', 'bronze.slack_channel_membership_periods', 'SELECT'), 'anon cannot read membership periods');

-- Fern is a member, Bramble an admin. Fixed ids nothing else uses.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000d1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'events-fern@example.test'),
  ('00000000-0000-4000-a000-00000000d1a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'events-bramble@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000d1a1', 'events-fern@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000d1a4', 'events-bramble@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO bronze.slack_channel_member_events (channel_id, user_id, event, occurred_at, source, inviter_user_id) VALUES
  -- U_REJOIN: joined (notice + the webhook a moment later), left, came back. Two periods.
  ('PGTAP_EV', 'U_REJOIN', 'joined', '2098-01-01T10:00:00Z', 'history_notice', 'U_INVITER'),
  ('PGTAP_EV', 'U_REJOIN', 'joined', '2098-01-01T10:00:00.4Z', 'webhook', NULL),
  ('PGTAP_EV', 'U_REJOIN', 'left',   '2098-01-05T09:00:00Z', 'history_notice', NULL),
  ('PGTAP_EV', 'U_REJOIN', 'left',   '2098-01-06T02:45:00Z', 'member_list', NULL),
  ('PGTAP_EV', 'U_REJOIN', 'joined', '2098-02-01T12:00:00Z', 'webhook', NULL),
  -- U_BASELINE: only ever seen in the member list.
  ('PGTAP_EV', 'U_BASELINE', 'joined', '2098-01-02T02:45:00Z', 'member_list', NULL),
  -- U_EARLY: was already in when records begin, then left.
  ('PGTAP_EV', 'U_EARLY', 'left', '2098-01-03T08:00:00Z', 'history_notice', NULL),
  -- Same time from an exact and an inferred source: the exact one is kept.
  ('PGTAP_EV', 'U_TIE', 'joined', '2098-01-04T00:00:00Z', 'member_list', NULL),
  ('PGTAP_EV', 'U_TIE', 'joined', '2098-01-04T00:00:00Z', 'webhook', NULL),
  -- Another conversation is kept apart.
  ('PGTAP_OTHER', 'U_REJOIN', 'joined', '2098-01-10T00:00:00Z', 'webhook', NULL);

-- Each source is idempotent.
INSERT INTO bronze.slack_channel_member_events (channel_id, user_id, event, occurred_at, source)
VALUES ('PGTAP_EV', 'U_REJOIN', 'joined', '2098-01-01T10:00:00Z', 'history_notice')
ON CONFLICT (channel_id, user_id, event, occurred_at, source) DO NOTHING;
SELECT is(
  (SELECT count(*)::int FROM bronze.slack_channel_member_events WHERE channel_id = 'PGTAP_EV' AND user_id = 'U_REJOIN'),
  5,
  'recording the same notice again adds nothing'
);

SELECT is(
  (SELECT count(*)::int FROM bronze.slack_channel_membership_periods WHERE channel_id = 'PGTAP_EV' AND user_id = 'U_REJOIN'),
  2,
  'a leave and a rejoin give two periods, not one overwritten row'
);
SELECT is(
  (SELECT joined_at::text || ' ' || joined_source || ' ' || inviter_user_id || ' -> ' || left_at::text || ' ' || left_source
     FROM bronze.slack_channel_membership_periods
    WHERE channel_id = 'PGTAP_EV' AND user_id = 'U_REJOIN' ORDER BY joined_at LIMIT 1),
  '2098-01-01 10:00:00+00 history_notice U_INVITER -> 2098-01-05 09:00:00+00 history_notice',
  'the same change from two sources collapses to the earliest report, keeping who invited them'
);
SELECT is(
  (SELECT joined_at::text || ' ' || joined_source || ' ' || COALESCE(left_at::text, 'still in')
     FROM bronze.slack_channel_membership_periods
    WHERE channel_id = 'PGTAP_EV' AND user_id = 'U_REJOIN' ORDER BY joined_at DESC LIMIT 1),
  '2098-02-01 12:00:00+00 webhook still in',
  'the current period has no left_at'
);
SELECT is(
  (SELECT joined_source || ' ' || COALESCE(left_at::text, 'still in')
     FROM bronze.slack_channel_membership_periods WHERE channel_id = 'PGTAP_EV' AND user_id = 'U_BASELINE'),
  'member_list still in',
  'someone only ever seen in the member list gets an open period marked as inferred'
);
SELECT is(
  (SELECT COALESCE(joined_at::text, 'before records') || ' -> ' || left_at::text
     FROM bronze.slack_channel_membership_periods WHERE channel_id = 'PGTAP_EV' AND user_id = 'U_EARLY'),
  'before records -> 2098-01-03 08:00:00+00',
  'a leave with no recorded join is a period that began before our records'
);
SELECT is(
  (SELECT joined_source FROM bronze.slack_channel_membership_periods WHERE channel_id = 'PGTAP_EV' AND user_id = 'U_TIE'),
  'webhook',
  'at the same instant an exact source wins over an inferred one'
);
SELECT is(
  (SELECT count(*)::int FROM bronze.slack_channel_membership_periods WHERE channel_id = 'PGTAP_OTHER' AND user_id = 'U_REJOIN'),
  1,
  'periods are per conversation'
);

-- Who can read it.
CREATE TEMP TABLE result(label text, value int) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000d1a1", "email": "events-fern@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'member_events', count(*) FROM bronze.slack_channel_member_events WHERE channel_id = 'PGTAP_EV';
INSERT INTO result SELECT 'member_periods', count(*) FROM bronze.slack_channel_membership_periods WHERE channel_id = 'PGTAP_EV';
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000d1a4", "email": "events-bramble@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'admin_events', count(*) FROM bronze.slack_channel_member_events WHERE channel_id = 'PGTAP_EV';
INSERT INTO result SELECT 'admin_periods', count(*) FROM bronze.slack_channel_membership_periods WHERE channel_id = 'PGTAP_EV';
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'member_events'), 0, 'a member cannot read membership events');
SELECT is((SELECT value FROM result WHERE label = 'member_periods'), 0, 'a member cannot read membership periods (the view runs as the caller)');
SELECT is((SELECT value FROM result WHERE label = 'admin_events'), 9, 'an admin can read membership events');
SELECT is((SELECT value FROM result WHERE label = 'admin_periods'), 5, 'an admin can read membership periods');

-- The check constraints hold the vocabulary.
SELECT throws_ok(
  $$INSERT INTO bronze.slack_channel_member_events (channel_id, user_id, event, occurred_at, source) VALUES ('PGTAP_EV', 'U_X', 'kicked', now(), 'webhook')$$,
  '23514', NULL, 'an unknown event is rejected'
);

SELECT * FROM finish(true);
ROLLBACK;
