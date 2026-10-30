-- pgTAP tests for 20270309000000_retention_network_details.sql: the functions behind the nightly job that removes
-- raw IP addresses and user-agent strings after 90 days.
--   * only the service role may call them (they take no user and change other people's rows);
--   * a user agent is removed only where its device is stored, an IP regardless;
--   * recent rows are left alone; a usage event's raw string is replaced by the parsed fields.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `pnpm test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(10);

SELECT ok(NOT has_function_privilege('authenticated', 'public.retention_pending_user_agents(text, integer)', 'EXECUTE'), 'a signed-in member can''t list pending user agents');
SELECT ok(NOT has_function_privilege('authenticated', 'public.retention_set_device(text, text, jsonb, integer)', 'EXECUTE'), 'a signed-in member can''t set devices');
SELECT ok(NOT has_function_privilege('authenticated', 'public.retention_remove_raw_network(timestamptz, integer)', 'EXECUTE'), 'a signed-in member can''t remove raw network details');
SELECT ok(NOT has_function_privilege('anon', 'public.retention_remove_raw_network(timestamptz, integer)', 'EXECUTE'), 'an anonymous visitor can''t either');
SELECT ok(has_function_privilege('service_role', 'public.retention_remove_raw_network(timestamptz, integer)', 'EXECUTE'), 'the service role can');

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f7a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'retention-pgtap@example.test');

INSERT INTO public.access_events (user_id, path, is_page, created_at, ip_address, user_agent, device, city) VALUES
  ('00000000-0000-4000-a000-00000000f7a1', '/old-parsed',   true, now() - interval '100 days', '203.0.113.1', 'UA-ONE', '{"browser":"Chrome"}', 'Porto'),
  ('00000000-0000-4000-a000-00000000f7a1', '/old-unparsed', true, now() - interval '100 days', '203.0.113.2', 'UA-TWO', NULL, 'Porto'),
  ('00000000-0000-4000-a000-00000000f7a1', '/recent',       true, now() - interval '10 days',  '203.0.113.3', 'UA-ONE', '{"browser":"Chrome"}', 'Porto');

SELECT public.retention_remove_raw_network(now() - interval '90 days', 5000);

SELECT is((SELECT ip_address IS NULL AND user_agent IS NULL AND city = 'Porto' FROM public.access_events WHERE path = '/old-parsed' AND user_id = '00000000-0000-4000-a000-00000000f7a1'),
  true, 'an old row with its device stored loses the IP and the user agent and keeps the place');
SELECT is((SELECT ip_address IS NULL AND user_agent = 'UA-TWO' FROM public.access_events WHERE path = '/old-unparsed' AND user_id = '00000000-0000-4000-a000-00000000f7a1'),
  true, 'an old row without a stored device keeps its user agent (the IP still goes)');
SELECT is((SELECT ip_address::text || user_agent FROM public.access_events WHERE path = '/recent' AND user_id = '00000000-0000-4000-a000-00000000f7a1'),
  '203.0.113.3/32UA-ONE', 'a recent row is left alone');

INSERT INTO public.analytics_events (user_id, message_id, event, properties, context, occurred_at, source)
VALUES ('00000000-0000-4000-a000-00000000f7a1', '00000000-0000-4000-a000-00000000f7e1', 'page_viewed', '{"route":"/x"}', '{"route":"/x","user_agent":"UA-EV"}', now(), 'client');

SELECT is((SELECT count(*)::integer FROM public.retention_pending_user_agents('analytics_events', 50) AS ua WHERE ua = 'UA-EV'), 1, 'a usage event with a raw user agent is pending');
SELECT public.retention_set_device('analytics_events', 'UA-EV', '{"browser":"Safari","os":"iOS"}', 5000);
SELECT is((SELECT context FROM public.analytics_events WHERE message_id = '00000000-0000-4000-a000-00000000f7e1'),
  '{"route":"/x","browser":"Safari","os":"iOS"}'::jsonb, 'the parsed fields replace the raw string in its context');

SELECT * FROM finish(true);
ROLLBACK;
