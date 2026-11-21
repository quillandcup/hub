-- pgTAP tests for csp_rollout_activity() (20270854): per user and user agent, the requests and page views in a
-- window, the requests only scripts make (API calls except the image routes, and three pages in one second), the
-- page views with the _ga cookie, and the cookie history before the window; bounds half-open; service role only.
-- Rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(7);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-0000000c0c01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'csp-ann@example.test'),
  ('00000000-0000-4000-a000-0000000c0c02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'csp-bea@example.test');

INSERT INTO public.access_events (user_id, path, is_page, user_agent, ga_client_id, created_at) VALUES
  -- Ann, in the window: one API call, three pages in the same second, one lone page fetch, an image route, two page views.
  ('00000000-0000-4000-a000-0000000c0c01', '/api/live-room',          false, 'ua-a', NULL,       '2026-11-20 10:00:00+00'),
  ('00000000-0000-4000-a000-0000000c0c01', '/dashboard',              false, 'ua-a', NULL,       '2026-11-20 10:00:01.1+00'),
  ('00000000-0000-4000-a000-0000000c0c01', '/courses',                false, 'ua-a', NULL,       '2026-11-20 10:00:01.2+00'),
  ('00000000-0000-4000-a000-0000000c0c01', '/chat',                   false, 'ua-a', NULL,       '2026-11-20 10:00:01.3+00'),
  ('00000000-0000-4000-a000-0000000c0c01', '/dashboard',              false, 'ua-a', NULL,       '2026-11-20 10:05:00+00'),
  ('00000000-0000-4000-a000-0000000c0c01', '/api/media/med_1/card',   false, 'ua-a', NULL,       '2026-11-20 11:00:00+00'),
  ('00000000-0000-4000-a000-0000000c0c01', '/dashboard',              true,  'ua-a', 'GA1.1.1.1', '2026-11-20 10:06:00+00'),
  ('00000000-0000-4000-a000-0000000c0c01', '/courses',                true,  'ua-a', NULL,       '2026-11-20 10:07:00+00'),
  -- Ann's history: one page view with the cookie inside the history window, one before it, one after the window.
  ('00000000-0000-4000-a000-0000000c0c01', '/dashboard',              true,  'ua-a', 'GA1.1.1.1', '2026-11-01 10:00:00+00'),
  ('00000000-0000-4000-a000-0000000c0c01', '/dashboard',              true,  'ua-a', 'GA1.1.1.1', '2026-09-01 10:00:00+00'),
  ('00000000-0000-4000-a000-0000000c0c01', '/dashboard',              true,  'ua-a', 'GA1.1.1.1', '2026-11-20 16:00:00+00'),
  -- Bea: one request at the start of the window (included), one exactly at its end (excluded), no user agent.
  ('00000000-0000-4000-a000-0000000c0c02', '/dashboard',              false, NULL,   NULL,       '2026-11-19 15:00:00+00'),
  ('00000000-0000-4000-a000-0000000c0c02', '/dashboard',              false, NULL,   NULL,       '2026-11-20 15:00:00+00');

CREATE TEMP TABLE csp_rows ON COMMIT DROP AS
SELECT * FROM public.csp_rollout_activity('2026-11-19 15:00:00+00', '2026-11-20 15:00:00+00', '2026-10-20 15:00:00+00')
WHERE user_id IN ('00000000-0000-4000-a000-0000000c0c01', '00000000-0000-4000-a000-0000000c0c02');

SELECT is((SELECT count(*)::int FROM csp_rows), 2, 'one row per user and user agent');
SELECT is(
  (SELECT row(requests, script_requests, page_views, page_views_with_ga, history_page_views_with_ga)::text
   FROM csp_rows WHERE user_id = '00000000-0000-4000-a000-0000000c0c01'),
  '(6,4,2,1,1)', 'requests, script requests (the API call and the burst of three, not the image route), page views, with the cookie, history');
SELECT is(
  (SELECT row(requests, script_requests, page_views, page_views_with_ga, history_page_views_with_ga)::text
   FROM csp_rows WHERE user_id = '00000000-0000-4000-a000-0000000c0c02'),
  '(1,0,0,0,0)', 'the window includes its start and excludes its end');
SELECT is((SELECT user_agent FROM csp_rows WHERE user_id = '00000000-0000-4000-a000-0000000c0c02'), NULL, 'a missing user agent is its own row');

SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT * FROM public.csp_rollout_activity(now() - interval '1 day', now(), now() - interval '30 days')$$, '42501', NULL, 'a signed-in user cannot call it');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT lives_ok($$SELECT * FROM public.csp_rollout_activity(now() - interval '1 day', now(), now() - interval '30 days')$$, 'the service role can');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.csp_rollout_activity('2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00', '2025-12-01 00:00:00+00')), 0, 'an empty window returns nothing');

SELECT * FROM finish(true);
ROLLBACK;
