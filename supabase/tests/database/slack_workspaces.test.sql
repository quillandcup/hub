-- pgTAP tests for 20270722000000_slack_workspaces.sql: the Slack workspaces table (one primary, readable by staff only,
-- written by the service role), the per-workspace bot token functions (service role only; the primary's stays in
-- slack_bot_token), workspace_id on every Bronze Slack table (defaulting to the primary workspace, so code that does not
-- name one keeps working), the workspace-aware unique indexes, and the privacy of the new column.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(32);

-- The seed: exactly one live primary workspace, with no Slack team id yet (the app records it).
SELECT is((SELECT count(*)::int FROM public.slack_workspaces WHERE is_primary AND deleted_at IS NULL), 1, 'one live primary workspace is seeded');
SELECT is((SELECT id FROM public.slack_workspaces WHERE is_primary), public.primary_slack_workspace_id(), 'primary_slack_workspace_id() is that workspace');
SELECT ok((SELECT id FROM public.slack_workspaces WHERE is_primary) LIKE 'slws\_%', 'its id carries the slws_ prefix');
SELECT throws_ok(
  $$INSERT INTO public.slack_workspaces (name, is_primary) VALUES ('Another primary', true)$$,
  '23505', NULL, 'a second live primary workspace is refused'
);
INSERT INTO public.slack_workspaces (id, team_id, name) VALUES ('slws_PGTAPSECOND1', 'T_PGTAP_SECOND', 'Second program');
SELECT throws_ok(
  $$INSERT INTO public.slack_workspaces (team_id, name) VALUES ('T_PGTAP_SECOND', 'Same team again')$$,
  '23505', NULL, 'a Slack team is registered once'
);

-- Grants and RLS: names are readable by staff, nothing is writable by API roles, tokens are service role only.
SELECT ok(NOT has_table_privilege('anon', 'public.slack_workspaces', 'SELECT'), 'anon cannot read the workspaces');
SELECT ok(has_table_privilege('authenticated', 'public.slack_workspaces', 'SELECT'), 'authenticated can read the workspaces (RLS narrows it to staff)');
SELECT ok(NOT has_table_privilege('authenticated', 'public.slack_workspaces', 'INSERT') AND NOT has_table_privilege('authenticated', 'public.slack_workspaces', 'UPDATE') AND NOT has_table_privilege('authenticated', 'public.slack_workspaces', 'DELETE'), 'authenticated cannot write them');
SELECT ok(has_table_privilege('service_role', 'public.slack_workspaces', 'INSERT'), 'the service role can');
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.slack_workspace_tokens', 'SELECT') AND NOT has_table_privilege('anon', 'public.slack_workspace_tokens', 'SELECT'),
  'members cannot read the token table'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.slack_workspace_token_get(text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.slack_workspace_token_save(text, text, text, timestamptz)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.slack_workspace_token_get(text)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.slack_workspace_token_save(text, text, text, timestamptz)', 'EXECUTE'),
  'only the service role can call the token functions'
);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000e1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ws-fern@example.test'),
  ('00000000-0000-4000-a000-00000000e1a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ws-bramble@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000e1a1', 'ws-fern@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000e1a4', 'ws-bramble@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- Tokens: the primary workspace's credentials come from the original storage, another's from its own row.
SELECT public.slack_workspace_token_save('slws_PGTAPSECOND1', 'xoxb-second', 'xoxe-second', now() + interval '12 hours');
SELECT is((SELECT access_token FROM public.slack_workspace_token_get('slws_PGTAPSECOND1')), 'xoxb-second', 'another workspace''s token is stored and read back');
SELECT is((SELECT count(*)::int FROM public.slack_workspace_tokens WHERE workspace_id = 'slws_PGTAPSECOND1'), 1, 'in its own row');
SELECT public.slack_workspace_token_save('slws_PGTAPSECOND1', 'xoxb-second-2', 'xoxe-second-2', now() + interval '12 hours');
SELECT is((SELECT access_token FROM public.slack_workspace_token_get('slws_PGTAPSECOND1')), 'xoxb-second-2', 'saving again updates it in place');
SELECT is((SELECT count(*)::int FROM public.slack_workspace_tokens WHERE workspace_id = 'slws_PGTAPSECOND1'), 1, 'without adding a row');
SELECT public.slack_workspace_token_save(public.primary_slack_workspace_id(), 'xoxb-primary', 'xoxe-primary', now() + interval '12 hours');
SELECT is((SELECT access_token FROM public.slack_bot_token_get()), 'xoxb-primary', 'the primary workspace''s token goes to the original storage');
SELECT is((SELECT access_token FROM public.slack_workspace_token_get(public.primary_slack_workspace_id())), 'xoxb-primary', 'and is read from there by workspace id');
SELECT is((SELECT access_token FROM public.slack_workspace_token_get('slws_PGTAPSECOND1')), 'xoxb-second-2', 'leaving the other workspace''s token alone');
SELECT is((SELECT count(*)::int FROM public.slack_workspace_token_get('slws_NOSUCHWORKSP')), 0, 'an unknown workspace has no token');
SELECT throws_ok($$SELECT public.slack_workspace_token_save('slws_NOSUCHWORKSP', 'x', 'y', now())$$, 'P0001', NULL, 'saving a token for an unknown workspace is refused');
SELECT is((SELECT count(*)::int FROM public.slack_token_refresh_leases WHERE lease_key = 'bot:slws_PGTAPSECOND1'), 0, 'saving releases the workspace''s refresh lease');

-- workspace_id on every table, defaulting to the primary workspace.
SELECT is(
  (SELECT count(*)::int FROM information_schema.columns
    WHERE column_name = 'workspace_id'
      AND ((table_schema = 'bronze' AND table_name IN ('slack_channels', 'slack_users', 'slack_messages', 'slack_reactions', 'slack_channel_members', 'slack_channel_member_events', 'slack_custom_emoji', 'slack_files'))
        OR (table_schema = 'public' AND table_name IN ('ignored_slack_users', 'restricted_slack_channels')))
      AND is_nullable = 'NO'),
  10,
  'all ten Slack tables have a NOT NULL workspace_id'
);
INSERT INTO bronze.slack_channels (channel_id, name, raw_payload) VALUES ('PGTAP_WS_CHAN', 'pgtap-ws', '{}');
SELECT is((SELECT workspace_id FROM bronze.slack_channels WHERE channel_id = 'PGTAP_WS_CHAN'), public.primary_slack_workspace_id(), 'a channel inserted without a workspace is in the primary one');
INSERT INTO bronze.slack_messages (message_ts, channel_id, user_id, text, occurred_at, raw_payload) VALUES ('4070908900.000100', 'PGTAP_WS_CHAN', 'PGTAP_WS_U', 'in primary', '2099-02-01T00:00:00Z', '{}');
SELECT is((SELECT workspace_id FROM bronze.slack_messages WHERE channel_id = 'PGTAP_WS_CHAN'), public.primary_slack_workspace_id(), 'and so is a message');
SELECT throws_ok(
  $$INSERT INTO bronze.slack_messages (message_ts, channel_id, user_id, text, occurred_at, raw_payload, workspace_id) VALUES ('4070908900.000200', 'PGTAP_WS_CHAN', 'PGTAP_WS_U', 'nowhere', '2099-02-01T00:00:00Z', '{}', 'slws_NOSUCHWORKSP')$$,
  '23503', NULL, 'a message in a workspace that does not exist is refused'
);
SELECT has_index('bronze', 'slack_messages', 'slack_messages_workspace_message_key', 'messages are unique per workspace, channel and timestamp');
SELECT has_index('bronze', 'slack_channels', 'slack_channels_workspace_channel_key', 'channels are unique per workspace and Slack id');

-- Privacy: the new column is metadata, so staff read it (also through the metadata view), while content stays closed.
SELECT ok(
  has_column_privilege('authenticated', 'bronze.slack_messages', 'workspace_id', 'SELECT')
    AND has_column_privilege('authenticated', 'bronze.slack_channels', 'workspace_id', 'SELECT')
    AND has_column_privilege('authenticated', 'bronze.slack_users', 'workspace_id', 'SELECT')
    AND has_column_privilege('authenticated', 'bronze.slack_reactions', 'workspace_id', 'SELECT')
    AND has_column_privilege('authenticated', 'bronze.slack_channel_member_events', 'workspace_id', 'SELECT'),
  'authenticated can read workspace_id where columns are granted one by one'
);
SELECT ok(
  NOT has_column_privilege('authenticated', 'bronze.slack_messages', 'text', 'SELECT')
    AND NOT has_column_privilege('authenticated', 'bronze.slack_messages', 'raw_payload', 'SELECT')
    AND NOT has_any_column_privilege('authenticated', 'bronze.slack_files', 'SELECT'),
  'message text, raw payloads and files are still closed'
);

CREATE TEMP TABLE result(label text, value text) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e1a1", "email": "ws-fern@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'member_workspaces', count(*)::text FROM public.slack_workspaces;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e1a4", "email": "ws-bramble@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'admin_workspaces', count(*)::text FROM public.slack_workspaces;
INSERT INTO result SELECT 'admin_meta_workspace', string_agg(workspace_id, ',') FROM bronze.slack_messages_meta WHERE channel_id = 'PGTAP_WS_CHAN';
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'member_workspaces'), '0', 'a member sees no workspaces');
SELECT cmp_ok((SELECT value::int FROM result WHERE label = 'admin_workspaces'), '>=', 2, 'an admin sees them');
SELECT is((SELECT value FROM result WHERE label = 'admin_meta_workspace'), public.primary_slack_workspace_id(), 'an admin reads a message''s workspace through the metadata view');

SELECT * FROM finish(true);
ROLLBACK;
