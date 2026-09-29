-- pgTAP test for Slack sign-in storage (20260929000300_create_slack_sign_in.sql) and the rate
-- limiter (20260929000400_create_rate_limit_counters.sql): only the service role may touch them,
-- and rate_limit_hit() counts per bucket and window. Rolled back; run with `npm run test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(15);

-- Locked away from API roles.
SELECT ok(NOT has_table_privilege('anon', 'public.slack_identities', 'SELECT'), 'anon cannot read slack_identities');
SELECT ok(NOT has_table_privilege('authenticated', 'public.slack_identities', 'SELECT'), 'authenticated cannot read slack_identities');
SELECT ok(NOT has_table_privilege('authenticated', 'public.slack_identities', 'INSERT'), 'authenticated cannot bind a Slack id');
SELECT ok(NOT has_table_privilege('anon', 'public.slack_sign_in_tokens', 'SELECT'), 'anon cannot read slack_sign_in_tokens');
SELECT ok(NOT has_table_privilege('authenticated', 'public.slack_sign_in_tokens', 'SELECT'), 'authenticated cannot read slack_sign_in_tokens');
SELECT ok(NOT has_table_privilege('authenticated', 'public.rate_limit_counters', 'SELECT'), 'authenticated cannot read rate_limit_counters');
SELECT ok(NOT has_function_privilege('anon', 'public.rate_limit_hit(text, integer, integer)', 'EXECUTE'), 'anon cannot call rate_limit_hit');
SELECT ok(NOT has_function_privilege('authenticated', 'public.rate_limit_hit(text, integer, integer)', 'EXECUTE'), 'authenticated cannot call rate_limit_hit');
SELECT ok(has_function_privilege('service_role', 'public.rate_limit_hit(text, integer, integer)', 'EXECUTE'), 'service_role can call rate_limit_hit');

-- Counting: allowed up to the limit, refused after, buckets independent.
SELECT ok(rate_limit_hit('pgtap:a', 3600, 2), 'first hit allowed');
SELECT ok(rate_limit_hit('pgtap:a', 3600, 2), 'second hit allowed');
SELECT ok(NOT rate_limit_hit('pgtap:a', 3600, 2), 'third hit refused');
SELECT ok(rate_limit_hit('pgtap:b', 3600, 2), 'another bucket is unaffected');

-- Earlier windows are cleared when the bucket is hit again.
INSERT INTO rate_limit_counters (bucket, window_start, hits) VALUES ('pgtap:a', now() - interval '2 days', 99);
SELECT ok(NOT rate_limit_hit('pgtap:a', 3600, 2), 'still refused within the current window');
SELECT is(
  (SELECT count(*)::int FROM rate_limit_counters WHERE bucket = 'pgtap:a' AND window_start < now() - interval '1 day'),
  0,
  'old windows are cleared'
);

SELECT * FROM finish(true);
ROLLBACK;
