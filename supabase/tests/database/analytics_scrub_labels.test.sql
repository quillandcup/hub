-- pgTAP tests for analytics_scrub_labels (20261113000300): click labels that can identify a person
-- are removed, everything else about the event and every other label is left alone, and only the
-- owner can run it.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `npm run test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(9);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000b4a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'scrub-fern@example.test'),
  ('00000000-0000-4000-a000-00000000b4a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'scrub-admin@example.test');
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('00000000-0000-4000-a000-00000000b4b1', 'Scrubfern Quillsby', 'scrub-fern@example.test', now(), 'active', '00000000-0000-4000-a000-00000000b4a1');

INSERT INTO public.analytics_events (message_id, user_id, session_id, event, properties, occurred_at, sudo) VALUES
  -- The user menu showing a member's name (initial + name), and a label that merely mentions it.
  ('b4000000-0000-4000-8000-000000000001', '00000000-0000-4000-a000-00000000b4a1', 'c4000000-0000-4000-8000-000000000001', 'element_clicked', '{"element": "button", "route": "/dashboard", "name": "user-menu", "text": "SScrubfern Quillsby"}', now(), false),
  ('b4000000-0000-4000-8000-000000000002', '00000000-0000-4000-a000-00000000b4a1', 'c4000000-0000-4000-8000-000000000001', 'element_clicked', '{"element": "button", "route": "/dashboard", "text": "Message scrubfern quillsby"}', now(), false),
  -- The user menu showing an admin's email.
  ('b4000000-0000-4000-8000-000000000003', '00000000-0000-4000-a000-00000000b4a2', 'c4000000-0000-4000-8000-000000000002', 'element_clicked', '{"element": "button", "route": "/dashboard", "text": "Cscrub-admin@example.test"}', now(), false),
  -- Admin pages, and an admin viewing as a member.
  ('b4000000-0000-4000-8000-000000000004', '00000000-0000-4000-a000-00000000b4a2', 'c4000000-0000-4000-8000-000000000002', 'element_clicked', '{"element": "button", "route": "/admin/members", "text": "Someone Else"}', now(), false),
  ('b4000000-0000-4000-8000-000000000005', '00000000-0000-4000-a000-00000000b4a2', 'c4000000-0000-4000-8000-000000000002', 'element_clicked', '{"element": "button", "route": "/dashboard", "text": "Another Person"}', now(), true),
  -- Labels that must stay: ordinary UI text, on a member page, by a member whose name it doesn't contain.
  ('b4000000-0000-4000-8000-000000000006', '00000000-0000-4000-a000-00000000b4a1', 'c4000000-0000-4000-8000-000000000001', 'element_clicked', '{"element": "button", "route": "/dashboard", "name": "save-goal", "text": "Save goal"}', now(), false),
  -- Not a click, even though it has a "text" property: untouched.
  ('b4000000-0000-4000-8000-000000000007', '00000000-0000-4000-a000-00000000b4a1', 'c4000000-0000-4000-8000-000000000001', 'page_viewed', '{"route": "/dashboard", "text": "SScrubfern Quillsby"}', now(), false);

CREATE TEMP TABLE scrubbed(n bigint) ON COMMIT DROP;
INSERT INTO scrubbed SELECT public.analytics_scrub_labels();

-- At least ours: other tests' rows in a shared database may be scrubbed too.
SELECT cmp_ok((SELECT n FROM scrubbed), '>=', 5::bigint, 'it reports how many rows it changed');
SELECT ok(NOT (SELECT properties ? 'text' FROM public.analytics_events WHERE message_id = 'b4000000-0000-4000-8000-000000000001'),
  'a label that is the member''s name is removed');
SELECT ok(NOT (SELECT properties ? 'text' FROM public.analytics_events WHERE message_id = 'b4000000-0000-4000-8000-000000000002'),
  'a label that contains the member''s name is removed, whatever the case');
SELECT ok(NOT (SELECT properties ? 'text' FROM public.analytics_events WHERE message_id = 'b4000000-0000-4000-8000-000000000003'),
  'a label that looks like an email is removed');
SELECT is(
  (SELECT count(*)::int FROM public.analytics_events
   WHERE message_id IN ('b4000000-0000-4000-8000-000000000004', 'b4000000-0000-4000-8000-000000000005') AND properties ? 'text'),
  0, 'labels on admin pages and during sudo are removed');
SELECT is(
  (SELECT properties FROM public.analytics_events WHERE message_id = 'b4000000-0000-4000-8000-000000000001'),
  '{"element": "button", "route": "/dashboard", "name": "user-menu"}'::jsonb,
  'the click itself (kind, name, route) stays');
SELECT is(
  (SELECT properties FROM public.analytics_events WHERE message_id = 'b4000000-0000-4000-8000-000000000006'),
  '{"element": "button", "route": "/dashboard", "name": "save-goal", "text": "Save goal"}'::jsonb,
  'an ordinary label stays');
SELECT is(
  (SELECT properties ->> 'text' FROM public.analytics_events WHERE message_id = 'b4000000-0000-4000-8000-000000000007'),
  'SScrubfern Quillsby',
  'events that are not clicks are untouched');
SELECT is(
  has_function_privilege('authenticated', 'public.analytics_scrub_labels()', 'EXECUTE'),
  false, 'members cannot run it');

SELECT * FROM finish(true);
ROLLBACK;
