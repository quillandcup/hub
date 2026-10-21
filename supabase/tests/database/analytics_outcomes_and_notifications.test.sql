-- pgTAP tests for server outcomes and notifications in the usage log (20261126000100):
-- events without a visit (source = 'system', session_id NULL), visit counts that leave them out,
-- analytics_action_outcomes and analytics_notification_rates, and the audience filters on both.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `pnpm test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(14);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000b7a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outc-alice@example.test'),
  ('00000000-0000-4000-a000-00000000b7a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outc-bob@example.test'),
  ('00000000-0000-4000-a000-00000000b7a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outc-admin@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000b7a1', 'outc-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000b7a2', 'outc-bob@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000b7a3', 'outc-admin@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- Other tests' rows may share the DB, so every assertion looks only at this test's actions and kinds
-- (they start with "tt_").
--
-- Actions: Alice's tt_save works twice and fails once; Bob's tt_save works once; the admin's works once.
-- A sudo action by the admin is left out by default.
INSERT INTO public.analytics_events (message_id, user_id, session_id, source, event, properties, occurred_at, sudo) VALUES
  ('b7000000-0000-4000-8000-000000000001', '00000000-0000-4000-a000-00000000b7a1', 'c7000000-0000-4000-8000-000000000001', 'server', 'action_completed', '{"action": "tt_save", "ok": true}', now() - interval '3 hours', false),
  ('b7000000-0000-4000-8000-000000000002', '00000000-0000-4000-a000-00000000b7a1', 'c7000000-0000-4000-8000-000000000001', 'server', 'action_completed', '{"action": "tt_save", "ok": true}', now() - interval '2 hours', false),
  ('b7000000-0000-4000-8000-000000000003', '00000000-0000-4000-a000-00000000b7a1', 'c7000000-0000-4000-8000-000000000002', 'server', 'action_completed', '{"action": "tt_save", "ok": false}', now() - interval '1 hour', false),
  ('b7000000-0000-4000-8000-000000000004', '00000000-0000-4000-a000-00000000b7a2', 'c7000000-0000-4000-8000-000000000003', 'server', 'action_completed', '{"action": "tt_save", "ok": true}', now() - interval '1 hour', false),
  ('b7000000-0000-4000-8000-000000000005', '00000000-0000-4000-a000-00000000b7a3', 'c7000000-0000-4000-8000-000000000004', 'server', 'action_completed', '{"action": "tt_save", "ok": true}', now() - interval '1 hour', false),
  ('b7000000-0000-4000-8000-000000000006', '00000000-0000-4000-a000-00000000b7a3', 'c7000000-0000-4000-8000-000000000005', 'server', 'action_completed', '{"action": "tt_save", "ok": false}', now() - interval '1 hour', true);

-- Notifications: tt_kind went to Alice and Bob by slack and to Alice by email (system events, no visit);
-- Alice opened the slack one, and opened an in-app one that was sent to her.
INSERT INTO public.analytics_events (message_id, user_id, session_id, source, event, properties, occurred_at, sudo) VALUES
  ('b7000000-0000-4000-8000-000000000011', '00000000-0000-4000-a000-00000000b7a1', NULL, 'system', 'notification_sent', '{"kind": "tt_kind", "channel": "slack"}', now() - interval '3 hours', false),
  ('b7000000-0000-4000-8000-000000000012', '00000000-0000-4000-a000-00000000b7a2', NULL, 'system', 'notification_sent', '{"kind": "tt_kind", "channel": "slack"}', now() - interval '3 hours', false),
  ('b7000000-0000-4000-8000-000000000013', '00000000-0000-4000-a000-00000000b7a1', NULL, 'system', 'notification_sent', '{"kind": "tt_kind", "channel": "email"}', now() - interval '3 hours', false),
  ('b7000000-0000-4000-8000-000000000014', '00000000-0000-4000-a000-00000000b7a1', NULL, 'system', 'notification_sent', '{"kind": "tt_kind", "channel": "in_app"}', now() - interval '3 hours', false),
  ('b7000000-0000-4000-8000-000000000015', '00000000-0000-4000-a000-00000000b7a1', 'c7000000-0000-4000-8000-000000000001', 'client', 'notification_opened', '{"kind": "tt_kind", "channel": "slack"}', now() - interval '2 hours', false),
  ('b7000000-0000-4000-8000-000000000016', '00000000-0000-4000-a000-00000000b7a1', 'c7000000-0000-4000-8000-000000000001', 'client', 'notification_opened', '{"kind": "tt_kind", "channel": "in_app"}', now() - interval '2 hours', false),
  ('b7000000-0000-4000-8000-000000000017', '00000000-0000-4000-a000-00000000b7a3', NULL, 'system', 'notification_sent', '{"kind": "tt_kind", "channel": "slack"}', now() - interval '3 hours', false);
-- A visit with a page view, and a system event in the same window, for the visit counts.
INSERT INTO public.analytics_events (message_id, user_id, session_id, event, properties, occurred_at) VALUES
  ('b7000000-0000-4000-8000-000000000021', '00000000-0000-4000-a000-00000000b7a1', 'c7000000-0000-4000-8000-000000000001', 'tt_visit_event', '{}', now() - interval '3 hours');
INSERT INTO public.analytics_events (message_id, user_id, session_id, source, event, properties, occurred_at) VALUES
  ('b7000000-0000-4000-8000-000000000022', '00000000-0000-4000-a000-00000000b7a1', NULL, 'system', 'tt_visit_event', '{}', now() - interval '3 hours');

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000b7a3", "role": "authenticated"}', true);

INSERT INTO result VALUES ('actions_default', (SELECT to_jsonb(a) - 'last_seen' FROM public.analytics_action_outcomes(now() - interval '1 day') a WHERE a.action = 'tt_save'));
INSERT INTO result VALUES ('actions_ignore_staff', (SELECT to_jsonb(a) - 'last_seen' FROM public.analytics_action_outcomes(now() - interval '1 day', true) a WHERE a.action = 'tt_save'));
INSERT INTO result VALUES ('actions_with_sudo', (SELECT to_jsonb(a) - 'last_seen' FROM public.analytics_action_outcomes(now() - interval '1 day', false, false) a WHERE a.action = 'tt_save'));
INSERT INTO result VALUES ('notif_default', (
  SELECT jsonb_agg(to_jsonb(n) ORDER BY n.channel) FROM public.analytics_notification_rates(now() - interval '1 day') n WHERE n.kind = 'tt_kind'));
INSERT INTO result VALUES ('notif_ignore_staff', (
  SELECT jsonb_agg(to_jsonb(n) ORDER BY n.channel) FROM public.analytics_notification_rates(now() - interval '1 day', true) n WHERE n.kind = 'tt_kind' AND n.channel = 'slack'));
INSERT INTO result VALUES ('summary_visits', (
  SELECT jsonb_build_object('events', events, 'sessions', sessions) FROM public.analytics_event_summary(now() - interval '1 day') WHERE event = 'tt_visit_event'));

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000b7a2", "role": "authenticated"}', true);
INSERT INTO result VALUES ('bob_actions', (SELECT to_jsonb(a) - 'last_seen' FROM public.analytics_action_outcomes(now() - interval '1 day') a WHERE a.action = 'tt_save'));

RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'actions_default'),
  '{"action": "tt_save", "attempts": 5, "succeeded": 4, "failed": 1, "members": 3}'::jsonb,
  'outcomes count attempts, successes, failures and members; sudo is left out by default');
SELECT is((SELECT value FROM result WHERE label = 'actions_ignore_staff'),
  '{"action": "tt_save", "attempts": 4, "succeeded": 3, "failed": 1, "members": 2}'::jsonb,
  'ignore_staff leaves out the admin''s own action');
SELECT is((SELECT value FROM result WHERE label = 'actions_with_sudo'),
  '{"action": "tt_save", "attempts": 6, "succeeded": 4, "failed": 2, "members": 3}'::jsonb,
  'ignore_sudo = false adds the sudo action');
SELECT is((SELECT value FROM result WHERE label = 'notif_default'),
  '[{"kind": "tt_kind", "channel": "email", "sent": 1, "sent_members": 1, "opened": 0, "opened_members": 0},
    {"kind": "tt_kind", "channel": "in_app", "sent": 1, "sent_members": 1, "opened": 1, "opened_members": 1},
    {"kind": "tt_kind", "channel": "slack", "sent": 3, "sent_members": 3, "opened": 1, "opened_members": 1}]'::jsonb,
  'notification rates count sends and opens per kind and channel, and a sent notification nobody opened still shows');
SELECT is((SELECT value FROM result WHERE label = 'notif_ignore_staff'),
  '[{"kind": "tt_kind", "channel": "slack", "sent": 2, "sent_members": 2, "opened": 1, "opened_members": 1}]'::jsonb,
  'ignore_staff leaves out notifications sent to staff');
SELECT is((SELECT value FROM result WHERE label = 'summary_visits'), '{"events": 2, "sessions": 1}'::jsonb,
  'an event with no visit counts as an event but not as a visit');
SELECT is((SELECT value FROM result WHERE label = 'bob_actions'),
  '{"action": "tt_save", "attempts": 1, "succeeded": 1, "failed": 0, "members": 1}'::jsonb,
  'a member only sees their own outcomes (RLS)');
SELECT is((SELECT source FROM public.analytics_events WHERE message_id = 'b7000000-0000-4000-8000-000000000021'), 'client', 'source defaults to client');
SELECT is((SELECT source FROM public.analytics_events WHERE message_id = 'b7000000-0000-4000-8000-000000000011'), 'system', 'a system event keeps its source');
SELECT is((SELECT session_id FROM public.analytics_events WHERE message_id = 'b7000000-0000-4000-8000-000000000011'), NULL::uuid, 'a system event has no visit');
SELECT throws_ok(
  $$INSERT INTO public.analytics_events (message_id, user_id, session_id, source, event, occurred_at) VALUES (gen_random_uuid(), '00000000-0000-4000-a000-00000000b7a1', NULL, 'browser', 'x', now())$$,
  '23514', NULL, 'an unknown source is refused');
SELECT is(has_function_privilege('anon', 'public.analytics_action_outcomes(timestamptz, boolean, boolean)', 'EXECUTE'), false, 'anonymous callers cannot run the outcomes report');
SELECT is(has_function_privilege('anon', 'public.analytics_notification_rates(timestamptz, boolean, boolean)', 'EXECUTE'), false, 'anonymous callers cannot run the notification report');
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN ('analytics_action_outcomes', 'analytics_notification_rates', 'analytics_event_summary', 'analytics_property_breakdown', 'analytics_top_clicks') AND p.prosecdef),
  0, 'none of them is SECURITY DEFINER: RLS still decides what a caller sees');

SELECT * FROM finish(true);
ROLLBACK;
