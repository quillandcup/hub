-- pgTAP tests for 20261009000000_slack_content_privacy.sql: admins can't read Slack message
-- content or raw payloads from Bronze, only the metadata view; restricting a channel is
-- admin-only, audited, clears text already copied into member_activities and keeps it out of
-- rebuilds; and the activity feed can narrow to those privacy changes.
-- Rolled back; run with `npm run test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(26);

-- Grants: content tables are closed to API roles.
SELECT ok(NOT has_table_privilege('authenticated', 'bronze.slack_messages', 'SELECT'), 'authenticated cannot read slack_messages');
SELECT ok(NOT has_table_privilege('authenticated', 'bronze.slack_messages', 'INSERT'), 'authenticated cannot write slack_messages');
SELECT ok(NOT has_any_column_privilege('authenticated', 'bronze.slack_messages', 'SELECT'), 'not even one column of slack_messages');
SELECT ok(NOT has_table_privilege('anon', 'bronze.slack_messages_meta', 'SELECT'), 'anon cannot read slack_messages_meta');
SELECT ok(NOT has_any_column_privilege('authenticated', 'bronze.slack_files', 'SELECT'), 'authenticated cannot read slack_files');
SELECT is(
  (SELECT count(*)::int FROM information_schema.columns
    WHERE table_schema = 'bronze' AND table_name = 'slack_messages_meta'
      AND column_name IN ('text', 'files', 'raw_payload')),
  0,
  'slack_messages_meta has no content columns'
);

-- raw_payload is hidden on the metadata tables; every other column stays readable. A column
-- added later without its own GRANT SELECT (col) ... TO authenticated fails here.
SELECT is(
  (SELECT count(*)::int FROM information_schema.columns
    WHERE table_schema = 'bronze'
      AND table_name IN ('slack_users', 'slack_channels', 'slack_reactions', 'slack_channel_member_events')
      AND column_name = 'raw_payload'
      AND has_column_privilege('authenticated', format('%I.%I', table_schema, table_name), column_name, 'SELECT')),
  0,
  'authenticated cannot read raw_payload on any Slack metadata table'
);
SELECT is(
  (SELECT string_agg(table_name || '.' || column_name, ', ') FROM information_schema.columns
    WHERE table_schema = 'bronze'
      AND table_name IN ('slack_users', 'slack_channels', 'slack_reactions', 'slack_channel_member_events')
      AND column_name <> 'raw_payload'
      AND NOT has_column_privilege('authenticated', format('%I.%I', table_schema, table_name), column_name, 'SELECT')),
  NULL,
  'every other column of those tables is granted to authenticated'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'reprocess_slack_activities_atomic(timestamptz, timestamptz, jsonb, boolean)', 'EXECUTE'),
  'authenticated cannot run the Slack activity rebuild (it reads message content)'
);

-- Fern is a member, Bramble an admin. Fixed ids nothing else uses.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000d1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'privacy-fern@example.test'),
  ('00000000-0000-4000-a000-00000000d1a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'privacy-bramble@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000d1a1', 'privacy-fern@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000d1a4', 'privacy-bramble@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000d101', 'Privacy Fern', 'privacy-fern@example.test', now(), 'active');

-- 2099 keeps the rebuild window clear of real rows.
INSERT INTO bronze.slack_channels (channel_id, name, is_private, is_mpim, raw_payload) VALUES
  ('PGTAP_OPEN', 'pgtap-open', true, false, '{}'),
  ('PGTAP_QUIET', 'pgtap-quiet', true, false, '{}');
INSERT INTO bronze.slack_messages (message_ts, channel_id, channel_name, channel_type, user_id, text, occurred_at, files, raw_payload) VALUES
  ('4070908800.000100', 'PGTAP_OPEN', 'pgtap-open', 'private_channel', 'PGTAP_U1', 'hello open', '2099-01-01T00:00:00Z', NULL, '{}'),
  ('4070908801.000100', 'PGTAP_QUIET', 'pgtap-quiet', 'private_channel', 'PGTAP_U1', 'hello quiet', '2099-01-01T00:00:01Z', '[{"id": "F1"}]', '{}');

SELECT reprocess_slack_activities_atomic(
  '2099-01-01T00:00:00Z', '2099-01-01T00:01:00Z',
  '{"PGTAP_U1": "00000000-0000-4000-a000-00000000d101"}'::jsonb
);
SELECT is(
  (SELECT description FROM member_activities WHERE related_id = 'PGTAP_QUIET:4070908801.000100'),
  'hello quiet',
  'before it is restricted, a private channel''s activity carries the message text'
);

CREATE TEMP TABLE result(label text, value text) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

-- A member sees nothing and can't restrict anything.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000d1a1", "email": "privacy-fern@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'member_meta', count(*)::text FROM bronze.slack_messages_meta WHERE channel_id LIKE 'PGTAP_%';
SELECT throws_ok(
  $$INSERT INTO public.restricted_slack_channels (channel_id, name) VALUES ('PGTAP_OPEN', 'pgtap-open')$$,
  '42501', NULL, 'a member cannot restrict a channel'
);

-- An admin reads metadata, not content, and can restrict a channel.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000d1a4", "email": "privacy-bramble@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'admin_meta', count(*)::text FROM bronze.slack_messages_meta WHERE channel_id LIKE 'PGTAP_%';
INSERT INTO result SELECT 'admin_has_files', has_files::text FROM bronze.slack_messages_meta WHERE channel_id = 'PGTAP_QUIET';
INSERT INTO result SELECT 'admin_periods', count(*)::text FROM bronze.slack_channel_membership_periods WHERE channel_id = 'PGTAP_NONE';
INSERT INTO result SELECT 'admin_channels', count(*)::text FROM (SELECT channel_id, name FROM bronze.slack_channels WHERE channel_id LIKE 'PGTAP_%') c;
SELECT throws_ok($$SELECT text FROM bronze.slack_messages LIMIT 1$$, '42501', NULL, 'an admin cannot read message text from Bronze');
SELECT throws_ok($$SELECT raw_payload FROM bronze.slack_channels LIMIT 1$$, '42501', NULL, 'an admin cannot read a channel''s raw payload');
SELECT throws_ok($$SELECT raw_payload FROM bronze.slack_reactions LIMIT 1$$, '42501', NULL, 'an admin cannot read a reaction''s raw payload');
SELECT lives_ok(
  $$INSERT INTO public.restricted_slack_channels (channel_id, name) VALUES ('PGTAP_QUIET', 'pgtap-quiet')$$,
  'an admin can restrict a channel'
);
INSERT INTO result SELECT 'feed_privacy', count(*)::text
  FROM get_activity_feed(p_entity_types => ARRAY['restricted_slack_channel']) WHERE entity_id = 'PGTAP_QUIET';
INSERT INTO result SELECT 'feed_privacy_other', count(*)::text
  FROM get_activity_feed(p_entity_types => ARRAY['restricted_slack_channel']) WHERE entity_type IS DISTINCT FROM 'restricted_slack_channel';
INSERT INTO result SELECT 'count_privacy', (count_activity_feed(p_entity_types => ARRAY['restricted_slack_channel'])
  = (SELECT count(*) FROM get_activity_feed(p_entity_types => ARRAY['restricted_slack_channel'], p_limit => 100000)))::text;
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'member_meta'), '0', 'a member sees no message metadata');
SELECT is((SELECT value FROM result WHERE label = 'admin_meta'), '2', 'an admin sees message metadata');
SELECT is((SELECT value FROM result WHERE label = 'admin_has_files'), 'true', 'the view says whether a message had files');
SELECT is((SELECT value FROM result WHERE label = 'admin_periods'), '0', 'the membership periods view still works for admins');
SELECT is((SELECT value FROM result WHERE label = 'admin_channels'), '2', 'an admin still reads channel metadata');

-- Restricting is audited with the admin as actor and the channel named.
SELECT is(
  (SELECT changed_by::text || ' | ' || action || ' | ' || entity_label FROM audit_log
    WHERE entity_type = 'restricted_slack_channel' AND entity_id = 'PGTAP_QUIET'),
  '00000000-0000-4000-a000-00000000d1a4 | insert | pgtap-quiet',
  'restricting a channel writes an audit row naming the admin and the channel'
);
SELECT is((SELECT value FROM result WHERE label = 'feed_privacy'), '1', 'the feed''s entity filter finds the restriction change');
SELECT is((SELECT value FROM result WHERE label = 'feed_privacy_other'), '0', 'and returns nothing else (no member activity, no page visits)');
SELECT is((SELECT value FROM result WHERE label = 'count_privacy'), 'true', 'count_activity_feed agrees with the filtered feed');

-- Text already copied is cleared at once, and stays out of rebuilds.
SELECT is(
  (SELECT description FROM member_activities WHERE related_id = 'PGTAP_QUIET:4070908801.000100'),
  NULL,
  'restricting a channel clears the message text already in member_activities'
);
SELECT reprocess_slack_activities_atomic(
  '2099-01-01T00:00:00Z', '2099-01-01T00:01:00Z',
  '{"PGTAP_U1": "00000000-0000-4000-a000-00000000d101"}'::jsonb
);
SELECT is(
  (SELECT array_agg(title || ' | ' || COALESCE(description, '-') ORDER BY occurred_at) FROM member_activities
    WHERE member_id = '00000000-0000-4000-a000-00000000d101' AND source = 'slack'),
  ARRAY['Posted in #pgtap-open | hello open', 'Posted in #pgtap-quiet | -'],
  'a rebuild keeps text for the open channel and leaves it out for the restricted one, which still counts'
);

SELECT * FROM finish(true);
ROLLBACK;
