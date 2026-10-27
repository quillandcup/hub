-- pgTAP tests for 20270202000000_slack_bot_token.sql: the bot's rotating credentials live in Vault (never
-- in the table), come back through slack_bot_token_get, are updated in place on refresh, and nobody but the
-- service role can touch any of it; the refresh lease is handed out one holder at a time.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(13);

SELECT ok(
  NOT has_table_privilege('authenticated', 'slack_bot_token', 'SELECT')
    AND NOT has_table_privilege('anon', 'slack_bot_token', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'slack_token_refresh_leases', 'SELECT')
    AND NOT has_table_privilege('anon', 'slack_token_refresh_leases', 'SELECT'),
  'members cannot read either table'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'slack_bot_token_get()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'slack_bot_token_save(text, text, timestamptz)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'slack_token_refresh_claim(text, integer)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'slack_token_refresh_release(text)', 'EXECUTE'),
  'nor call any of the functions'
);
SELECT ok(
  has_function_privilege('service_role', 'slack_bot_token_get()', 'EXECUTE')
    AND has_function_privilege('service_role', 'slack_token_refresh_claim(text, integer)', 'EXECUTE'),
  'the service role can'
);

SELECT is((SELECT count(*) FROM slack_bot_token_get()), 0::bigint, 'nothing is stored at first');

SELECT slack_bot_token_save('xoxe.xoxb-first', 'xoxe-refresh-1', '2030-01-01');
SELECT is(
  (SELECT concat_ws('|', access_token, refresh_token, expires_at::date::text) FROM slack_bot_token_get()),
  'xoxe.xoxb-first|xoxe-refresh-1|2030-01-01',
  'a saved credential comes back decrypted'
);
SELECT is(
  (SELECT count(*) FROM slack_bot_token WHERE to_jsonb(slack_bot_token)::text LIKE '%xox%'),
  0::bigint,
  'the tokens are not in the table'
);
SELECT is(
  (SELECT count(*) FROM vault.secrets WHERE id IN (SELECT access_secret_id FROM slack_bot_token UNION SELECT refresh_secret_id FROM slack_bot_token)),
  2::bigint,
  'they are in Vault'
);

-- A refresh updates the same row and the same secrets instead of leaving the spent ones behind.
SELECT slack_bot_token_save('xoxe.xoxb-second', 'xoxe-refresh-2', '2031-01-01');
SELECT is(
  (SELECT concat_ws('|', access_token, refresh_token, expires_at::date::text) FROM slack_bot_token_get()),
  'xoxe.xoxb-second|xoxe-refresh-2|2031-01-01',
  'a refresh replaces the credential'
);
SELECT is(
  (SELECT (SELECT count(*) FROM slack_bot_token) || '|' || (SELECT count(*) FROM vault.secrets WHERE description LIKE 'Slack bot %')),
  '1|2',
  'in place: still one row and two secrets'
);

-- The lease: one holder at a time, and saving a new credential gives the bot's lease back.
SELECT is(slack_token_refresh_claim('bot', 60), true, 'the first request gets the lease');
SELECT is(slack_token_refresh_claim('bot', 60), false, 'the next is refused while it is held');
SELECT slack_bot_token_save('xoxe.xoxb-third', 'xoxe-refresh-3', '2032-01-01');
SELECT is(slack_token_refresh_claim('bot', 60), true, 'saving a refreshed credential released it');
UPDATE slack_token_refresh_leases SET held_until = now() - interval '1 second' WHERE lease_key = 'bot';
SELECT is(slack_token_refresh_claim('bot', 60), true, 'a holder that ran out of time loses it to the next request');

SELECT * FROM finish(true);
ROLLBACK;
