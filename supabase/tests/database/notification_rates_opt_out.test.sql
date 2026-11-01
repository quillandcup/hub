-- pgTAP tests for 20270310000000_notification_rates_opt_out.sql: the notification report leaves out the sends to
-- members who chose "leave me out of statistics" (their opens are never recorded, so their sends would drag the
-- open rate down), and still counts everyone else's.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `pnpm test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(4);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f8a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rates-in@example.test'),
  ('00000000-0000-4000-a000-00000000f8a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rates-out@example.test'),
  ('00000000-0000-4000-a000-00000000f8a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rates-admin@example.test');
INSERT INTO public.user_profiles (id, email, role, analytics_opt_out_at) VALUES
  ('00000000-0000-4000-a000-00000000f8a1', 'rates-in@example.test', 'member', NULL),
  ('00000000-0000-4000-a000-00000000f8a2', 'rates-out@example.test', 'member', now()),
  ('00000000-0000-4000-a000-00000000f8a3', 'rates-admin@example.test', 'admin', NULL)
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, analytics_opt_out_at = EXCLUDED.analytics_opt_out_at;

-- Both members were sent the same notification; only the member who stayed in opened it.
INSERT INTO public.analytics_events (message_id, user_id, session_id, source, event, properties, occurred_at, sudo) VALUES
  ('f8000000-0000-4000-8000-000000000001', '00000000-0000-4000-a000-00000000f8a1', NULL, 'system', 'notification_sent', '{"kind": "oo_kind", "channel": "slack"}', now() - interval '1 hour', false),
  ('f8000000-0000-4000-8000-000000000002', '00000000-0000-4000-a000-00000000f8a2', NULL, 'system', 'notification_sent', '{"kind": "oo_kind", "channel": "slack"}', now() - interval '1 hour', false),
  ('f8000000-0000-4000-8000-000000000003', '00000000-0000-4000-a000-00000000f8a1', 'f8000000-0000-4000-8000-0000000000a1', 'client', 'notification_opened', '{"kind": "oo_kind", "channel": "slack"}', now() - interval '30 minutes', false);

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f8a3", "role": "authenticated"}', true);
INSERT INTO result VALUES ('rates', (SELECT to_jsonb(r) FROM public.analytics_notification_rates(now() - interval '1 day') r WHERE r.kind = 'oo_kind'));
RESET ROLE;

SELECT is((SELECT (value ->> 'sent')::int FROM result WHERE label = 'rates'), 1, 'the send to the member who left is not counted');
SELECT is((SELECT (value ->> 'sent_members')::int FROM result WHERE label = 'rates'), 1, 'nor is that member');
SELECT is((SELECT (value ->> 'opened')::int FROM result WHERE label = 'rates'), 1, 'the open of the member who stayed in is');
-- The send itself is still on record: it is the app's own record of what it did.
SELECT is((SELECT count(*)::int FROM public.analytics_events WHERE message_id = 'f8000000-0000-4000-8000-000000000002'), 1, 'the send to the member who left is still recorded');

SELECT * FROM finish(true);
ROLLBACK;
