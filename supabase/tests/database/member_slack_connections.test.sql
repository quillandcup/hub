-- pgTAP tests for 20261021000000_member_slack_connections.sql: tokens live in Vault (never in the
-- table), come back through slack_connection_tokens, are replaced on reconnect, updated on
-- refresh and deleted on revoke, and nobody but the service role can touch any of it.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(13);

SELECT ok(
  NOT has_table_privilege('authenticated', 'member_slack_connections', 'SELECT')
    AND NOT has_table_privilege('anon', 'member_slack_connections', 'SELECT'),
  'members cannot read the table'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'slack_connection_tokens(text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'slack_connection_save(text, text, text, text[], text, text, timestamptz)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'slack_connection_revoke(text)', 'EXECUTE'),
  'nor call any of the functions'
);
SELECT ok(has_function_privilege('service_role', 'slack_connection_tokens(text)', 'EXECUTE'), 'the service role can');

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_AAAAAAAAfaA1', 'Conn Fern', 'conn-fern@example.test', now(), 'active');

SELECT slack_connection_save('mbr_AAAAAAAAfaA1', 'U_FERN', 'T_TEAM', ARRAY['chat:write', 'reactions:write'], 'xoxp-first', 'xoxe-refresh-1', '2030-01-01');
SELECT is(
  (SELECT concat_ws('|', slack_user_id, access_token, refresh_token, expires_at::date::text) FROM slack_connection_tokens('mbr_AAAAAAAAfaA1')),
  'U_FERN|xoxp-first|xoxe-refresh-1|2030-01-01',
  'a saved connection''s tokens come back decrypted'
);
SELECT is(
  (SELECT count(*) FROM member_slack_connections WHERE to_jsonb(member_slack_connections)::text LIKE '%xox%'),
  0::bigint,
  'the tokens are not in the table'
);
SELECT is(
  (SELECT count(*) FROM vault.secrets WHERE id IN (SELECT access_secret_id FROM member_slack_connections UNION SELECT refresh_secret_id FROM member_slack_connections)),
  2::bigint,
  'they are in Vault'
);

-- Reconnecting replaces the secrets instead of leaving the old ones behind.
SELECT slack_connection_save('mbr_AAAAAAAAfaA1', 'U_FERN', 'T_TEAM', ARRAY['chat:write'], 'xoxp-second', NULL, NULL);
SELECT is(
  (SELECT concat_ws('|', access_token, coalesce(refresh_token, 'none')) FROM slack_connection_tokens('mbr_AAAAAAAAfaA1')),
  'xoxp-second|none',
  'reconnecting replaces the tokens'
);
SELECT is(
  (SELECT count(*) FROM vault.secrets WHERE description LIKE '%mbr_AAAAAAAAfaA1'),
  1::bigint,
  'and the old secrets are gone'
);

SELECT slack_connection_update_tokens('mbr_AAAAAAAAfaA1', 'xoxp-third', 'xoxe-refresh-3', '2031-01-01');
SELECT is(
  (SELECT concat_ws('|', access_token, refresh_token, expires_at::date::text) FROM slack_connection_tokens('mbr_AAAAAAAAfaA1')),
  'xoxp-third|xoxe-refresh-3|2031-01-01',
  'a refresh stores the new tokens, adding a refresh token if there was none'
);

SELECT slack_connection_revoke('mbr_AAAAAAAAfaA1');
SELECT is(
  (SELECT count(*) FROM slack_connection_tokens('mbr_AAAAAAAAfaA1')),
  0::bigint,
  'a revoked connection has no tokens'
);
SELECT is(
  (SELECT count(*) FROM vault.secrets WHERE description LIKE '%mbr_AAAAAAAAfaA1'),
  0::bigint,
  'and its secrets are deleted'
);
SELECT ok(
  (SELECT revoked_at IS NOT NULL AND access_secret_id IS NULL FROM member_slack_connections WHERE member_id = 'mbr_AAAAAAAAfaA1'),
  'the row stays, marked revoked'
);

-- A Slack account belongs to one member, even after the first one disconnected (the row stays).
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000fa02', 'Conn Moss', 'conn-moss@example.test', now(), 'active');
SELECT throws_ok(
  $$SELECT slack_connection_save('00000000-0000-4000-a000-00000000fa02', 'U_FERN', 'T_TEAM', ARRAY['chat:write'], 'xoxp-x', NULL, NULL)$$,
  '23505',
  NULL,
  'a second member cannot hold a Slack account already connected'
);

SELECT * FROM finish(true);
ROLLBACK;
